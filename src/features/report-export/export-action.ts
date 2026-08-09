"use server";

import { auth } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import {
  getCashFlowSeries,
  getResumenKpis,
  getUfPorPeriodo,
} from "@/features/cash-flow/services/queries";
import { getDotacionTotalPorPeriodo } from "@/features/headcount/services/dotacion-total";
import { getPlanObraConDotacion } from "@/features/headcount/services/plan-obra-dotacion";
import { renderReportHtml } from "./render";
import { renderReportExcel } from "./render-excel";

export interface ExportReportResult {
  estado: "ok" | "error";
  html?: string;
  /** Excel en base64 — Server Actions no serializan Buffer/Uint8Array directo al cliente. */
  excelBase64?: string;
  nombreArchivoHtml?: string;
  nombreArchivoExcel?: string;
  errores: string[];
}

/**
 * Congela el estado actual del reporte en un .html autocontenido Y su
 * respaldo en .xlsx — ambos generados en la MISMA llamada, desde los
 * MISMOS datos (`cash_flow_monthly` vía queries.ts), para que nunca queden
 * desincronizados (pedido explícito del usuario: "ambos archivos deben
 * conversar"). Ver TECH-SPEC §3.3 y BLUEPRINT Fase 8.
 *
 * Ambos se guardan en el bucket `report-exports` para historial, y se
 * retornan también al cliente para descarga inmediata sin un segundo
 * round-trip a Storage.
 */
export async function exportReportAsHtml(
  periodoDesde: Date,
  periodoHasta: Date,
): Promise<ExportReportResult> {
  const session = await auth();
  const supabase = createServiceClient();

  try {
    const [serie, kpis] = await Promise.all([
      getCashFlowSeries(periodoDesde, periodoHasta),
      getResumenKpis(periodoDesde, periodoHasta),
    ]);
    const ufPorPeriodo = await getUfPorPeriodo([
      ...new Set(serie.map((p) => p.periodo)),
    ]);
    const dotacionPorPeriodo = await getDotacionTotalPorPeriodo(
      periodoDesde,
      periodoHasta,
    );
    // Solo para la hoja "Plan de Obra" del Excel — pedido explícito del
    // usuario, no aplica al HTML.
    const planObraDotacion = await getPlanObraConDotacion(
      periodoDesde,
      periodoHasta,
    );

    const generadoEn = new Date();
    const paramsComunes = {
      serie,
      kpis,
      ufPorPeriodo,
      dotacionPorPeriodo,
      periodoDesde: periodoDesde.toISOString().slice(0, 10),
      periodoHasta: periodoHasta.toISOString().slice(0, 10),
      generadoEn,
    };

    const html = renderReportHtml(paramsComunes);
    const excelBuffer = await renderReportExcel({
      ...paramsComunes,
      planObraDotacion,
    });

    const fechaSlug = generadoEn.toISOString().slice(0, 10);
    const nombreArchivoHtml = `flujo-caja-nomina-${fechaSlug}.html`;
    const nombreArchivoExcel = `flujo-caja-nomina-${fechaSlug}.xlsx`;
    const carpeta = `${generadoEn.getFullYear()}`;

    const errores: string[] = [];

    const { error: uploadHtmlError } = await supabase.storage
      .from("report-exports")
      .upload(`${carpeta}/${nombreArchivoHtml}`, html, {
        contentType: "text/html; charset=utf-8",
        upsert: true,
      });
    if (uploadHtmlError)
      errores.push(
        `No se pudo guardar el HTML en Storage: ${uploadHtmlError.message}`,
      );

    const { error: uploadExcelError } = await supabase.storage
      .from("report-exports")
      .upload(`${carpeta}/${nombreArchivoExcel}`, excelBuffer, {
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        upsert: true,
      });
    if (uploadExcelError)
      errores.push(
        `No se pudo guardar el Excel en Storage: ${uploadExcelError.message}`,
      );

    await supabase.from("report_snapshots").insert({
      generated_by: session?.user?.id ?? null,
      periodo_desde: periodoDesde.toISOString().slice(0, 10),
      periodo_hasta: periodoHasta.toISOString().slice(0, 10),
      estado: errores.length > 0 ? "parcial" : "ok",
      export_storage_path: uploadHtmlError
        ? null
        : `${carpeta}/${nombreArchivoHtml}`,
      exported_at: generadoEn.toISOString(),
    });

    return {
      estado: "ok",
      html,
      excelBase64: excelBuffer.toString("base64"),
      nombreArchivoHtml,
      nombreArchivoExcel,
      errores,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { estado: "error", errores: [message] };
  }
}
