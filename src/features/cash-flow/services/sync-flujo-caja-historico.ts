"use server";

import { auth } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import {
  downloadFileContent,
  ensureDriveId,
  pickLatestMatch,
  searchFiles,
} from "@/features/ingestion/graph/client";
import { parseFlujoCajaHistorico } from "@/features/ingestion/excel-parser/flujo-caja-historico-parser";

export interface SyncFlujoCajaHistoricoResult {
  estado: "ok" | "error";
  archivoUsado: string | null;
  mesesImportados: number;
  errores: string[];
}

const METODO_HISTORICO = "ingesta_excel_historico";

/**
 * Importa la hoja "Detalle" del Excel MAESTRO de Flujo de Caja (carpeta
 * "Flujo de Caja" en SharePoint, SIEMPRE el archivo con
 * `lastModifiedDateTime` más reciente — nunca por nombre, ver
 * TECH-SPEC §2.2) — el registro histórico autoritativo que Finanzas
 * mantiene cerrado mes a mes. Corrige un hueco real: la ingesta mes a mes
 * de "Pagos Mensuales" (`sync-pagos-mensuales.ts`) depende de encontrar
 * cada archivo suelto en SharePoint, y para varios meses de 2025 eso
 * venía incompleto (reportado por el usuario, confirmado en producción)
 * — el Excel maestro SÍ tiene esos meses cerrados y completos.
 *
 * Se corre ANTES del recálculo mes a mes en `refresh.ts`, con prioridad
 * sobre la ingesta granular de SharePoint: escribe `es_real=true` con
 * `metodo_calculo='ingesta_excel_historico'`, y ese método se preserva
 * igual que un `manual_override` (nunca se pisa en el siguiente refresh)
 * — así el Excel maestro manda para cualquier mes que ya tenga cerrado,
 * y la ingesta granular de SharePoint solo rellena los meses recientes
 * que el Excel maestro todavía no cierra.
 */
export async function syncFlujoCajaHistorico(): Promise<SyncFlujoCajaHistoricoResult> {
  const session = await auth();
  if (!session?.graphAccessToken) {
    return {
      estado: "error",
      archivoUsado: null,
      mesesImportados: 0,
      errores: ["Sesión de Microsoft no disponible — vuelve a iniciar sesión."],
    };
  }

  const supabase = createServiceClient();

  try {
    // "Flujo Caja" (sin guion bajo) matchea AMBAS variantes de nombre de
    // archivo reales ("Flujo_Caja_23_06_26.xlsx" y
    // "Flujo Caja_30_03_26_Finanzas.xlsx") — confirmado. Hay 25+ archivos
    // históricos con este texto (una versión por corte), por eso
    // `maxResultados` más alto que el default — sin esto, el archivo más
    // reciente puede quedar fuera de los primeros 50 resultados
    // (ranking por relevancia, no por fecha — mismo bug ya confirmado en
    // Pagos Mensuales).
    const hits = await searchFiles(session.graphAccessToken, "Flujo Caja", {
      maxResultados: 200,
    });
    const encontrado = pickLatestMatch(hits, {
      folderIncludes: "Flujo de Caja",
      nameExtension: ".xlsx",
    });

    if (!encontrado) {
      return {
        estado: "error",
        archivoUsado: null,
        mesesImportados: 0,
        errores: [
          'No se encontró ningún Excel de Flujo de Caja en SharePoint (carpeta "Flujo de Caja").',
        ],
      };
    }

    const archivo = await ensureDriveId(session.graphAccessToken, encontrado);
    if (!archivo.parentReference?.driveId) {
      return {
        estado: "error",
        archivoUsado: archivo.name,
        mesesImportados: 0,
        errores: [
          `Se encontró "${archivo.name}" pero no se pudo resolver su ubicación exacta en SharePoint (driveId).`,
        ],
      };
    }

    const buffer = await downloadFileContent(
      session.graphAccessToken,
      archivo.parentReference.driveId,
      archivo.id,
    );
    const {
      lineas,
      dotacion,
      errores: erroresParseo,
    } = await parseFlujoCajaHistorico(buffer);

    if (lineas.length === 0) {
      return {
        estado: "error",
        archivoUsado: archivo.name,
        mesesImportados: 0,
        errores:
          erroresParseo.length > 0
            ? erroresParseo
            : [
                'El archivo se descargó pero no se extrajo ningún dato real de la hoja "Detalle".',
              ],
      };
    }

    // Agregar por (periodo, concepto) — anticipo_rg/rp y remuneracion_rg/rp
    // ya vienen separados del parser; acá se derivan además los totales
    // combinados 'anticipo' y 'remuneracion' que el resto del modelo usa
    // (ver engine.ts) cuando AMBAS mitades (RG y RP) son reales ese mes.
    const porPeriodoConcepto = new Map<string, number>();
    for (const l of lineas) {
      const key = `${l.periodo.toISOString().slice(0, 10)}::${l.concepto}`;
      porPeriodoConcepto.set(key, l.monto);
    }

    const periodos = [
      ...new Set(lineas.map((l) => l.periodo.toISOString().slice(0, 10))),
    ];

    const filasCashFlow: {
      periodo: string;
      concepto: string;
      monto: number;
      es_real: true;
      metodo_calculo: string;
    }[] = [];

    for (const periodo of periodos) {
      const rg = porPeriodoConcepto.get(`${periodo}::anticipo_rg`);
      const rp = porPeriodoConcepto.get(`${periodo}::anticipo_rp`);
      if (rg != null || rp != null) {
        filasCashFlow.push({
          periodo,
          concepto: "anticipo",
          monto: (rg ?? 0) + (rp ?? 0),
          es_real: true,
          metodo_calculo: METODO_HISTORICO,
        });
      }
      if (rg != null)
        filasCashFlow.push({
          periodo,
          concepto: "anticipo_rg",
          monto: rg,
          es_real: true,
          metodo_calculo: METODO_HISTORICO,
        });
      if (rp != null)
        filasCashFlow.push({
          periodo,
          concepto: "anticipo_rp",
          monto: rp,
          es_real: true,
          metodo_calculo: METODO_HISTORICO,
        });

      const remRg = porPeriodoConcepto.get(`${periodo}::remuneracion_rg`);
      const remRp = porPeriodoConcepto.get(`${periodo}::remuneracion_rp`);
      if (remRg != null || remRp != null) {
        filasCashFlow.push({
          periodo,
          concepto: "remuneracion",
          monto: (remRg ?? 0) + (remRp ?? 0),
          es_real: true,
          metodo_calculo: METODO_HISTORICO,
        });
      }
      if (remRg != null)
        filasCashFlow.push({
          periodo,
          concepto: "remuneracion_rg",
          monto: remRg,
          es_real: true,
          metodo_calculo: METODO_HISTORICO,
        });
      if (remRp != null)
        filasCashFlow.push({
          periodo,
          concepto: "remuneracion_rp",
          monto: remRp,
          es_real: true,
          metodo_calculo: METODO_HISTORICO,
        });

      for (const concepto of [
        "finiquito",
        "reliquidacion",
        "cotizacion",
        "sence",
      ] as const) {
        const monto = porPeriodoConcepto.get(`${periodo}::${concepto}`);
        if (monto != null) {
          filasCashFlow.push({
            periodo,
            concepto,
            monto,
            es_real: true,
            metodo_calculo: METODO_HISTORICO,
          });
        }
      }
    }

    const { error: cashFlowError } = await supabase
      .from("cash_flow_monthly")
      .upsert(filasCashFlow, { onConflict: "periodo,concepto" });

    const errores: string[] = [...erroresParseo];
    if (cashFlowError) {
      errores.push(
        `Error guardando cash_flow_monthly: ${cashFlowError.message}`,
      );
    }

    if (dotacion.length > 0) {
      const filasDotacion = dotacion.map((d) => ({
        periodo: d.periodo.toISOString().slice(0, 10),
        rg: d.rg,
        rp: d.rp,
        total: (d.rg ?? 0) + (d.rp ?? 0),
        origen: "excel_historico" as const,
      }));
      const { error: dotacionError } = await supabase
        .from("dotacion_mensual")
        .upsert(filasDotacion, { onConflict: "periodo" });
      if (dotacionError) {
        errores.push(
          `Error guardando dotacion_mensual: ${dotacionError.message}`,
        );
      }
    }

    await supabase.from("audit_log").insert({
      actor_id: session.user?.id ?? null,
      accion: "sync_flujo_caja_historico",
      entidad: "cash_flow_monthly",
      metadata: {
        archivo: archivo.name,
        meses: periodos.length,
        filasCashFlow: filasCashFlow.length,
        puntosDotacion: dotacion.length,
      },
    });

    return {
      estado: errores.length > 0 && filasCashFlow.length === 0 ? "error" : "ok",
      archivoUsado: archivo.name,
      mesesImportados: periodos.length,
      errores,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      estado: "error",
      archivoUsado: null,
      mesesImportados: 0,
      errores: [message],
    };
  }
}
