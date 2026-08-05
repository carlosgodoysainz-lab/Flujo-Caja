"use server";

import { auth } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import {
  downloadFileContent,
  pickLatestMatch,
  searchFiles,
  type GraphSearchHit,
} from "@/features/ingestion/graph/client";
import { parseSolicitudRequerimiento } from "@/features/ingestion/excel-parser/solicitud-requerimiento-parser";
import type { PayrollLineItemRaw } from "@/features/ingestion/excel-parser/types";

export interface SyncPagosMensualesResult {
  estado: "ok" | "parcial" | "error";
  periodo: string;
  archivosProcesados: string[];
  lineItemsIngeridos: number;
  errores: string[];
}

const MESES_ES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

function rgRpFromFileName(name: string): "RG" | "RP" | null {
  const lower = name.toLowerCase();
  const hasRg = /\brg\b/.test(lower);
  const hasRp = /\brp\b/.test(lower);
  if (hasRg && !hasRp) return "RG";
  if (hasRp && !hasRg) return "RP";
  return null; // ambiguo (ej. "RG - RP") o no indicado
}

/** Filtra resultados de búsqueda de Graph a los que mencionan el mes/año pedidos en el nombre. */
function filterByPeriod(
  hits: GraphSearchHit[],
  periodo: Date,
): GraphSearchHit[] {
  const mesNombre = MESES_ES[periodo.getMonth()];
  const anio = String(periodo.getFullYear());
  return hits.filter((hit) => {
    const lower = hit.name.toLowerCase();
    return lower.includes(mesNombre) && lower.includes(anio);
  });
}

async function descargarYParsear(
  accessToken: string,
  query: string,
  periodo: Date,
): Promise<
  {
    archivo: GraphSearchHit;
    lineItems: PayrollLineItemRaw[];
    errores: string[];
  }[]
> {
  const hits = await searchFiles(accessToken, query);
  const candidatos = filterByPeriod(hits, periodo).filter(
    (h) => h.name.toLowerCase().endsWith(".xlsx") && h.parentReference?.driveId,
  );

  const resultados = [];
  for (const archivo of candidatos) {
    const buffer = await downloadFileContent(
      accessToken,
      archivo.parentReference!.driveId!,
      archivo.id,
    );
    const rgRp = rgRpFromFileName(archivo.name);
    const { lineItems, errores } = await parseSolicitudRequerimiento(
      buffer,
      rgRp,
    );
    resultados.push({
      archivo,
      lineItems,
      errores: errores.map(
        (e) => `${archivo.name} [${e.hoja}] fila ${e.fila}: ${e.motivo}`,
      ),
    });
  }
  return resultados;
}

/**
 * Ingiere Remuneraciones + Reliquidaciones de SharePoint para un mes
 * específico y agrega los montos a `payroll_line_items`. NO calcula
 * `cash_flow_monthly` directamente — eso lo hace el refresh completo
 * (Fase 7) combinando esto con `calcularMesCashFlow` (engine.ts).
 *
 * Anticipos y Finiquitos vía PDF quedan fuera del MVP (Fase 10, ver
 * TECH-SPEC §2.3) — los finiquitos que SÍ vienen estructurados dentro de
 * los archivos de remuneración (ej. "Finiquito RP cuota X/Y") sí se
 * ingieren aquí, vía el parser genérico.
 */
export async function syncPagosMensuales(
  periodo: Date,
): Promise<SyncPagosMensualesResult> {
  const session = await auth();
  const periodoLabel = `${periodo.getFullYear()}-${String(periodo.getMonth() + 1).padStart(2, "0")}`;

  if (!session?.graphAccessToken) {
    return {
      estado: "error",
      periodo: periodoLabel,
      archivosProcesados: [],
      lineItemsIngeridos: 0,
      errores: ["Sesión de Microsoft no disponible — vuelve a iniciar sesión."],
    };
  }

  const supabase = createServiceClient();
  const errores: string[] = [];
  const archivosProcesados: string[] = [];
  let totalLineItems = 0;

  try {
    const [remuneraciones, reliquidaciones] = await Promise.all([
      descargarYParsear(
        session.graphAccessToken,
        "Solicitud de Requerimiento remuneracion",
        periodo,
      ),
      descargarYParsear(
        session.graphAccessToken,
        "Solicitud de Requerimiento reliquidacion",
        periodo,
      ),
    ]);

    for (const grupo of [...remuneraciones, ...reliquidaciones]) {
      errores.push(...grupo.errores);
      if (grupo.lineItems.length === 0) continue;

      const { data: sourceDoc, error: sourceDocError } = await supabase
        .from("payroll_source_documents")
        .insert({
          tipo: grupo.archivo.name.toLowerCase().includes("reliquidacion")
            ? "reliquidacion"
            : "remuneracion",
          periodo: periodo.toISOString().slice(0, 10),
          nombre_archivo: grupo.archivo.name,
          graph_item_id: grupo.archivo.id,
          web_url: grupo.archivo.webUrl,
          filas_procesadas: grupo.lineItems.length,
          estado: grupo.errores.length > 0 ? "parcial" : "ok",
          ingested_by: session.user?.id ?? null,
        })
        .select("id")
        .single();

      if (sourceDocError || !sourceDoc) {
        errores.push(
          `No se pudo registrar ${grupo.archivo.name}: ${sourceDocError?.message}`,
        );
        continue;
      }

      // Resolución best-effort de obra desde el texto de "Division"
      // (confirmado en archivos reales que a veces contiene "Obra X").
      const divisionesUnicas = [
        ...new Set(
          grupo.lineItems
            .map((li) => li.division)
            .filter((d): d is string => !!d),
        ),
      ];
      const obraPorDivision = new Map<string, string>();
      if (divisionesUnicas.length > 0) {
        const { data: obras } = await supabase
          .from("obras")
          .select("id, nombre");
        for (const division of divisionesUnicas) {
          const nombreBuscado = division
            .replace(/^obra\s+/i, "")
            .trim()
            .toLowerCase();
          const match = obras?.find(
            (o) =>
              o.nombre.toLowerCase().includes(nombreBuscado) ||
              nombreBuscado.includes(o.nombre.toLowerCase()),
          );
          if (match) obraPorDivision.set(division, match.id);
        }
      }

      const { error: insertError } = await supabase
        .from("payroll_line_items")
        .insert(
          grupo.lineItems.map((li) => ({
            source_document_id: sourceDoc.id,
            periodo: li.periodo.toISOString().slice(0, 10),
            concepto: li.concepto,
            sociedad: li.sociedad,
            obra_id: li.division
              ? (obraPorDivision.get(li.division) ?? null)
              : null,
            monto: li.monto,
          })),
        );

      if (insertError) {
        errores.push(
          `Error guardando line items de ${grupo.archivo.name}: ${insertError.message}`,
        );
        continue;
      }

      totalLineItems += grupo.lineItems.length;
      archivosProcesados.push(grupo.archivo.name);
    }

    await supabase.from("audit_log").insert({
      actor_id: session.user?.id ?? null,
      accion: "sync_pagos_mensuales",
      entidad: "payroll_line_items",
      metadata: {
        periodo: periodoLabel,
        archivos: archivosProcesados,
        lineItems: totalLineItems,
        errores: errores.length,
      },
    });

    if (archivosProcesados.length === 0) {
      return {
        estado: "error",
        periodo: periodoLabel,
        archivosProcesados,
        lineItemsIngeridos: 0,
        errores:
          errores.length > 0
            ? errores
            : [
                `No se encontró ningún archivo de Pagos Mensuales para ${periodoLabel}.`,
              ],
      };
    }

    return {
      estado: errores.length > 0 ? "parcial" : "ok",
      periodo: periodoLabel,
      archivosProcesados,
      lineItemsIngeridos: totalLineItems,
      errores,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      estado: "error",
      periodo: periodoLabel,
      archivosProcesados,
      lineItemsIngeridos: totalLineItems,
      errores: [...errores, message],
    };
  }
}
