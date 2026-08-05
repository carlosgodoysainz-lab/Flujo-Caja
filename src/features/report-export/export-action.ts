"use server";

import { auth } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import {
  getCashFlowSeries,
  getResumenKpis,
} from "@/features/cash-flow/services/queries";
import { renderReportHtml } from "./render";

export interface ExportReportResult {
  estado: "ok" | "error";
  html?: string;
  nombreArchivo?: string;
  errores: string[];
}

/**
 * Congela el estado actual del reporte en un .html autocontenido — ver
 * TECH-SPEC §3.3 (Report Export) y BLUEPRINT Fase 8. Se guarda en el
 * bucket `report-exports` para historial, y se retorna también el HTML
 * crudo para que el cliente dispare la descarga inmediata sin un
 * segundo round-trip a Storage.
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

    const generadoEn = new Date();
    const html = renderReportHtml({
      serie,
      kpis,
      periodoDesde: periodoDesde.toISOString().slice(0, 10),
      periodoHasta: periodoHasta.toISOString().slice(0, 10),
      generadoEn,
    });

    const nombreArchivo = `flujo-caja-nomina-${generadoEn.toISOString().slice(0, 10)}.html`;
    const storagePath = `${generadoEn.getFullYear()}/${nombreArchivo}`;

    const { error: uploadError } = await supabase.storage
      .from("report-exports")
      .upload(storagePath, html, {
        contentType: "text/html; charset=utf-8",
        upsert: true,
      });

    const errores: string[] = [];
    if (uploadError)
      errores.push(
        `No se pudo guardar el historial en Storage: ${uploadError.message}`,
      );

    await supabase.from("report_snapshots").insert({
      generated_by: session?.user?.id ?? null,
      periodo_desde: periodoDesde.toISOString().slice(0, 10),
      periodo_hasta: periodoHasta.toISOString().slice(0, 10),
      estado: "ok",
      export_storage_path: uploadError ? null : storagePath,
      exported_at: generadoEn.toISOString(),
    });

    return { estado: "ok", html, nombreArchivo, errores };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { estado: "error", errores: [message] };
  }
}
