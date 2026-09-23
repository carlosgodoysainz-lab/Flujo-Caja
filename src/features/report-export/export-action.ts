"use server";

import { auth } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import {
  getCashFlowSeries,
  getResumenKpis,
  getUfPorPeriodo,
  getAguinaldoAnticipoPorPeriodo,
} from "@/features/cash-flow/services/queries";
import {
  getDotacionTotalPorPeriodo,
  getDotacionPorConceptoYPeriodo,
  getOficinaCentralHeadcountPorPeriodo,
} from "@/features/headcount/services/dotacion-total";
import {
  getPlanObraConDotacion,
  getSaldoInicialPorObra,
} from "@/features/headcount/services/plan-obra-dotacion";
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
    // Columna N° por sub-fila RG/RP de Anticipo/Remuneración — mismo
    // formato del Excel real de Finanzas, pedido explícito del usuario
    // 17-ago-2026, en los 3 formatos (app en vivo, HTML y Excel). Real
    // por concepto específico (payroll_line_items) cuando existe — bug
    // real corregido 17-ago-2026: antes se reutilizaba la misma
    // dotación para Anticipo y Remuneración, pese a que mucha menos
    // gente pide Anticipo.
    const dotacionPorConceptoYPeriodo = await getDotacionPorConceptoYPeriodo(
      periodoDesde,
      periodoHasta,
    );
    // Solo para la hoja "Plan de Obra" del Excel — pedido explícito del
    // usuario, no aplica al HTML.
    const planObraDotacion = await getPlanObraConDotacion(
      periodoDesde,
      periodoHasta,
    );
    // Solo para la fila "Oficina Central" de la hoja "Proyección
    // Headcount" — 1 mes ANTES de `periodoDesde` para poder calcular la
    // variación neta de la primera columna visible (ver render-excel.ts).
    const unMesAntesDePeriodoDesde = new Date(
      periodoDesde.getFullYear(),
      periodoDesde.getMonth() - 1,
      1,
    );
    const oficinaCentralPorPeriodo = await getOficinaCentralHeadcountPorPeriodo(
      unMesAntesDePeriodoDesde,
      periodoHasta,
    );
    // Solo para la columna "Saldo Inicial (Buk)" de la hoja "Proyección
    // Headcount" — referencia visual para la carga manual (ver
    // render-excel.ts), nunca participa en ningún cálculo.
    const saldoInicialPorObra = await getSaldoInicialPorObra();

    // El Excel trae MÁS histórico que la app en vivo/el HTML — pedido
    // explícito del usuario ("el histórico dejalo agrupado en el excel,
    // no lo elimines") tras acotar el rango en vivo a 3 meses atrás (esa
    // acotación era para el foco de Finanzas en la proyección, no para
    // perder el respaldo histórico del Excel). Se agregan 9 meses más
    // atrás (total 12 desde hoy) y quedan agrupados/colapsados en la
    // hoja "Detalle" (ver `columnasAgrupadasHastaPeriodo` en
    // render-excel.ts) — presentes pero no estorbando por default.
    const desdeExcel = new Date(
      periodoDesde.getFullYear(),
      periodoDesde.getMonth() - 9,
      1,
    );
    const [serieExcel] = await Promise.all([
      getCashFlowSeries(desdeExcel, periodoHasta),
    ]);
    const ufPorPeriodoExcel = await getUfPorPeriodo([
      ...new Set(serieExcel.map((p) => p.periodo)),
    ]);
    const dotacionPorPeriodoExcel = await getDotacionTotalPorPeriodo(
      desdeExcel,
      periodoHasta,
    );
    const dotacionPorConceptoYPeriodoExcel =
      await getDotacionPorConceptoYPeriodo(desdeExcel, periodoHasta);
    const aguinaldoAnticipoPorPeriodo = await getAguinaldoAnticipoPorPeriodo(
      desdeExcel,
      periodoHasta,
    );

    const generadoEn = new Date();
    const periodoDesdeStr = periodoDesde.toISOString().slice(0, 10);
    const periodoHastaStr = periodoHasta.toISOString().slice(0, 10);
    const paramsComunes = {
      serie,
      kpis,
      ufPorPeriodo,
      dotacionPorPeriodo,
      dotacionPorConceptoYPeriodo,
      periodoDesde: periodoDesdeStr,
      periodoHasta: periodoHastaStr,
      generadoEn,
    };

    const html = renderReportHtml(paramsComunes);
    const excelBuffer = await renderReportExcel({
      serie: serieExcel,
      kpis,
      ufPorPeriodo: ufPorPeriodoExcel,
      dotacionPorPeriodo: dotacionPorPeriodoExcel,
      dotacionPorConceptoYPeriodo: dotacionPorConceptoYPeriodoExcel,
      periodoDesde: periodoDesdeStr,
      periodoHasta: periodoHastaStr,
      // Todo lo anterior a este período queda agrupado/colapsado en
      // "Detalle" — mismo período que ve la app en vivo, el resto es
      // respaldo histórico accesible pero no estorba por default.
      columnasAgrupadasHastaPeriodo: periodoDesdeStr,
      generadoEn,
      planObraDotacion,
      oficinaCentralPorPeriodo,
      saldoInicialPorObra,
      aguinaldoAnticipoPorPeriodo,
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
