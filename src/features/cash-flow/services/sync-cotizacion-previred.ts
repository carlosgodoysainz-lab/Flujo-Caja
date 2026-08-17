"use server";

import { auth } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import {
  downloadFileContent,
  ensureDriveId,
  searchFiles,
  type GraphSearchHit,
} from "@/features/ingestion/graph/client";
import { parseComprobantePrevired } from "@/features/ingestion/pdf-parser/comprobante-previred-parser";
import { extractText } from "unpdf";

export interface SyncCotizacionPreviredResult {
  estado: "ok" | "parcial" | "error";
  periodo: string;
  comprobantesProcesados: number;
  montoTotal: number;
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

function rutaDe(hit: GraphSearchHit): string {
  if (hit.parentReference?.path) return hit.parentReference.path;
  try {
    return decodeURIComponent(hit.webUrl);
  } catch {
    return hit.webUrl;
  }
}

/**
 * Ingiere Cotización real desde los comprobantes oficiales de pago de
 * Previred — carpeta SharePoint "Pagos Mensuales/imposiciones/imposiciones
 * <mes> <año>/", archivos "comprobante previred <Empresa> <RG|RP>.pdf".
 * Antes NO existía ninguna fuente real automatizada para este concepto
 * (siempre fórmula, ver engine.ts) — pedido explícito del usuario
 * 17-ago-2026 tras confirmar que la carpeta real sí existe.
 *
 * Se lee el TOTAL ya calculado y confirmado por Previred en cada
 * comprobante (ver comprobante-previred-parser.ts) — NUNCA se parsea el
 * layout crudo de ~70 columnas por trabajador de los .txt de la misma
 * carpeta (riesgo real de sumar el campo equivocado en un dato
 * financiero). Se suman TODOS los comprobantes del mes (todas las
 * empresas del grupo, RG y RP) para obtener el total de la compañía.
 *
 * Misma carpeta también tiene otros PDF NO relacionados ("Planilla...")
 * y los .txt crudos Previred — se filtra estrictamente por nombre
 * "comprobante previred*.pdf".
 */
export async function syncCotizacionPrevired(
  periodo: Date,
): Promise<SyncCotizacionPreviredResult> {
  const session = await auth();
  const periodoLabel = `${periodo.getFullYear()}-${String(periodo.getMonth() + 1).padStart(2, "0")}`;
  const periodoStr = periodo.toISOString().slice(0, 10);

  if (!session?.graphAccessToken) {
    return {
      estado: "error",
      periodo: periodoLabel,
      comprobantesProcesados: 0,
      montoTotal: 0,
      errores: ["Sesión de Microsoft no disponible — vuelve a iniciar sesión."],
    };
  }

  const supabase = createServiceClient();
  const errores: string[] = [];

  try {
    const mesNombre = MESES_ES[periodo.getMonth()];
    const anio = String(periodo.getFullYear());
    const carpetaEsperada = `imposiciones ${mesNombre} ${anio}`;

    // maxResultados alto — mismo motivo ya documentado en
    // sync-pagos-mensuales.ts: la búsqueda rankea por relevancia, no por
    // fecha, y esta carpeta trae ~15-20 comprobantes por mes (2 por
    // empresa: RG y RP) mezclados con .txt/otros PDF de la misma carpeta.
    const hits = await searchFiles(
      session.graphAccessToken,
      `comprobante previred ${mesNombre} ${anio}`,
      { maxResultados: 200 },
    );

    const candidatosSinResolver = hits.filter((hit) => {
      const nombreLower = hit.name.toLowerCase();
      return (
        nombreLower.startsWith("comprobante previred") &&
        nombreLower.endsWith(".pdf") &&
        rutaDe(hit).toLowerCase().includes(carpetaEsperada.toLowerCase())
      );
    });

    if (candidatosSinResolver.length === 0) {
      return {
        estado: "error",
        periodo: periodoLabel,
        comprobantesProcesados: 0,
        montoTotal: 0,
        errores: [
          `No se encontró ningún "comprobante previred" para ${periodoLabel} en la carpeta "${carpetaEsperada}".`,
        ],
      };
    }

    const candidatos = (
      await Promise.all(
        candidatosSinResolver.map((h) =>
          ensureDriveId(session.graphAccessToken!, h),
        ),
      )
    ).filter((h) => h.parentReference?.driveId);

    let montoTotal = 0;
    let comprobantesProcesados = 0;
    const archivosVistos = new Set<string>();

    for (const archivo of candidatos) {
      // Un mismo comprobante puede aparecer 2 veces en los resultados de
      // búsqueda (ej. copia en "Nueva carpeta" y en la raíz) — no contarlo
      // 2 veces por nombre de archivo.
      if (archivosVistos.has(archivo.name)) continue;
      archivosVistos.add(archivo.name);

      const buffer = await downloadFileContent(
        session.graphAccessToken!,
        archivo.parentReference!.driveId!,
        archivo.id,
      );
      const { text } = await extractText(new Uint8Array(buffer), {
        mergePages: true,
      });
      const parseado = parseComprobantePrevired(text);

      if (parseado.estado === "error") {
        errores.push(`${archivo.name}: ${parseado.motivo}`);
        continue;
      }

      const parseadoPeriodoStr = parseado.periodo.toISOString().slice(0, 10);
      if (parseadoPeriodoStr !== periodoStr) {
        errores.push(
          `${archivo.name}: el comprobante dice período ${parseadoPeriodoStr}, se esperaba ${periodoStr} — se ignora.`,
        );
        continue;
      }

      // BUG REAL evitado (mismo patrón ya corregido en
      // sync-pagos-mensuales.ts): borrar la ingesta anterior de ESTE
      // archivo antes de insertar de nuevo, para que re-correr
      // "Actualizar reporte" nunca acumule el mismo comprobante 2 veces.
      await supabase
        .from("payroll_source_documents")
        .delete()
        .eq("periodo", periodoStr)
        .eq("nombre_archivo", archivo.name);

      const { data: sourceDoc, error: sourceDocError } = await supabase
        .from("payroll_source_documents")
        .insert({
          tipo: "cotizacion",
          periodo: periodoStr,
          nombre_archivo: archivo.name,
          graph_item_id: archivo.id,
          web_url: archivo.webUrl,
          filas_procesadas: 1,
          estado: "ok",
          ingested_by: session.user?.id ?? null,
        })
        .select("id")
        .single();

      if (sourceDocError || !sourceDoc) {
        errores.push(
          `No se pudo registrar ${archivo.name}: ${sourceDocError?.message}`,
        );
        continue;
      }

      const { error: insertError } = await supabase
        .from("payroll_line_items")
        .insert({
          source_document_id: sourceDoc.id,
          periodo: periodoStr,
          concepto: "cotizacion",
          sociedad: parseado.empresa,
          monto: parseado.montoTotal,
        });

      if (insertError) {
        errores.push(
          `Error guardando línea de ${archivo.name}: ${insertError.message}`,
        );
        continue;
      }

      montoTotal += parseado.montoTotal;
      comprobantesProcesados++;
    }

    await supabase.from("audit_log").insert({
      actor_id: session.user?.id ?? null,
      accion: "sync_cotizacion_previred",
      entidad: "payroll_line_items",
      metadata: {
        periodo: periodoLabel,
        comprobantesProcesados,
        montoTotal,
        errores: errores.length,
      },
    });

    if (comprobantesProcesados === 0) {
      return {
        estado: "error",
        periodo: periodoLabel,
        comprobantesProcesados: 0,
        montoTotal: 0,
        errores:
          errores.length > 0
            ? errores
            : [`Ningún comprobante válido para ${periodoLabel}.`],
      };
    }

    return {
      estado: errores.length > 0 ? "parcial" : "ok",
      periodo: periodoLabel,
      comprobantesProcesados,
      montoTotal,
      errores,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      estado: "error",
      periodo: periodoLabel,
      comprobantesProcesados: 0,
      montoTotal: 0,
      errores: [...errores, message],
    };
  }
}
