import ExcelJS from "exceljs";
import type {
  CashFlowSeriePunto,
  ResumenKpis,
} from "@/features/cash-flow/services/queries";
import type { DotacionTotalPunto } from "@/features/headcount/services/dotacion-total";
import type { PlanObraDotacionFila } from "@/features/headcount/services/plan-obra-dotacion";

// Cada fila principal puede traer sub-filas RG/RP (aperturadas — mismo
// desglose que el Excel real, pedido explícito del usuario) indentadas
// justo debajo, de menor jerarquía visual.
const FILAS: {
  concepto: string;
  label: string;
  sub?: { concepto: string; label: string }[];
}[] = [
  {
    concepto: "anticipo",
    label: "Anticipo",
    sub: [
      { concepto: "anticipo_rg", label: "  RG" },
      { concepto: "anticipo_rp", label: "  RP" },
    ],
  },
  {
    concepto: "remuneracion",
    label: "Remuneración",
    sub: [
      { concepto: "remuneracion_rg", label: "  RG" },
      { concepto: "remuneracion_rp", label: "  RP" },
    ],
  },
  { concepto: "finiquito", label: "Finiquito" },
  { concepto: "reliquidacion", label: "Reliquidación" },
  { concepto: "cotizacion", label: "Cotización" },
  { concepto: "sence", label: "Aporte SENCE" },
  { concepto: "total_nomina", label: "Total Nómina" },
];

// Mismo amarillo que el Excel ORIGINAL usaba para marcar proyección — ver
// el hallazgo inicial ("lo que está en amarillo es lo que falta
// completar"). Aquí el significado es idéntico: celda calculada por
// fórmula, no dato real ingerido.
const FILL_PROYECTADO: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFFFF00" },
};
const FILL_HEADER: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF003865" },
};

/**
 * Genera el respaldo en Excel que acompaña SIEMPRE al export HTML (ver
 * export-action.ts) — mismos datos, misma fuente (`cash_flow_monthly`),
 * generados en la MISMA llamada, para que ambos archivos "conversen" y
 * nunca queden desincronizados (pedido explícito del usuario).
 */
export async function renderReportExcel(params: {
  serie: CashFlowSeriePunto[];
  kpis: ResumenKpis;
  ufPorPeriodo: Map<string, number>;
  /** Dotación total (N°) por período — ver dotacion-total.ts. Fila "Dotación" solo aparece si hay dato. */
  dotacionPorPeriodo?: Map<string, DotacionTotalPunto>;
  /** Plan de obra (Gespro) + dotación real (Buk) + flujo estimado por obra — ver plan-obra-dotacion.ts. Hoja "Plan de Obra" solo aparece si hay filas. */
  planObraDotacion?: PlanObraDotacionFila[];
  periodoDesde: string;
  periodoHasta: string;
  generadoEn: Date;
}): Promise<Buffer> {
  const {
    serie,
    kpis,
    ufPorPeriodo,
    dotacionPorPeriodo,
    planObraDotacion,
    periodoDesde,
    periodoHasta,
    generadoEn,
  } = params;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Flujo de Caja Nómina — Grupo Maestra";
  workbook.created = generadoEn;

  const periodos = [...new Set(serie.map((p) => p.periodo))].sort();
  const valorPorConceptoYPeriodo = new Map<string, CashFlowSeriePunto>();
  for (const punto of serie)
    valorPorConceptoYPeriodo.set(`${punto.concepto}::${punto.periodo}`, punto);

  // --- Hoja "Resumen" ---
  const resumen = workbook.addWorksheet("Resumen");
  resumen.addRow(["Flujo de Caja Nómina — Grupo Maestra"]).font = {
    bold: true,
    size: 14,
  };
  resumen.addRow([
    `Generado: ${generadoEn.toLocaleString("es-CL")}`,
    `Período: ${periodoDesde} a ${periodoHasta}`,
  ]);
  resumen.addRow([]);
  resumen.addRow(["KPI", "Valor"]).font = { bold: true };
  resumen.addRow(["Este mes", kpis.totalMesActual]);
  resumen.addRow(["Próximos 3 meses", kpis.totalProximosTresMeses]);
  resumen.addRow(["Próximos 12 meses", kpis.totalProximosDoceMeses]);
  resumen.addRow([
    "Variación vs. mes anterior (%)",
    kpis.variacionPct != null ? Number(kpis.variacionPct.toFixed(1)) : "—",
  ]);
  resumen.addRow([
    "Dotación total (mes actual)",
    kpis.dotacionMesActual ?? "—",
  ]);
  resumen.addRow([
    "Obras con dotación estimada por el modelo",
    kpis.obrasConEstimacion,
  ]);
  resumen.addRow([
    "Meses proyectados en el rango",
    kpis.mesesProyectadosEnRango,
  ]);
  if (kpis.mesPico)
    resumen.addRow([
      "Mes de mayor requerimiento",
      `${kpis.mesPico.periodo.slice(0, 7)} — ${kpis.mesPico.monto}`,
    ]);
  resumen.getColumn(1).width = 32;
  resumen.getColumn(2).width = 22;

  // --- Hoja "Detalle" — misma estructura que la tabla del HTML/dashboard ---
  const detalle = workbook.addWorksheet("Detalle");
  const headerRow = detalle.addRow([
    "Concepto",
    ...periodos.map((p) => p.slice(0, 7)),
  ]);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = FILL_HEADER;
  });

  // Dotación (N°) — misma fila que el "N°" del Excel original, antes de
  // los conceptos monetarios.
  if (dotacionPorPeriodo && dotacionPorPeriodo.size > 0) {
    const filaDotacion: (string | number)[] = ["Dotación (N°)"];
    const celdasProyectadas: number[] = [];
    periodos.forEach((p, i) => {
      const punto = dotacionPorPeriodo.get(p);
      filaDotacion.push(punto ? punto.total : "");
      if (punto && !punto.esReal) celdasProyectadas.push(i + 2);
    });
    const row = detalle.addRow(filaDotacion);
    row.font = { color: { argb: "FF475569" } };
    for (const colNum of celdasProyectadas)
      row.getCell(colNum).fill = FILL_PROYECTADO;
    row.eachCell((cell, colNumber) => {
      if (colNumber > 1) cell.numFmt = "#,##0";
    });
  }

  function agregarFilaConcepto(
    concepto: string,
    label: string,
    negrita: boolean,
  ) {
    const fila: (string | number)[] = [label];
    const celdasProyectadas: number[] = [];
    periodos.forEach((p, i) => {
      const punto = valorPorConceptoYPeriodo.get(`${concepto}::${p}`);
      fila.push(punto ? punto.monto : "");
      if (punto && !punto.esReal) celdasProyectadas.push(i + 2); // +2: col 1 es "Concepto", 1-indexed
    });
    const row = detalle.addRow(fila);
    if (negrita) row.font = { bold: true };
    for (const colNum of celdasProyectadas) {
      row.getCell(colNum).fill = FILL_PROYECTADO;
    }
    row.eachCell((cell, colNumber) => {
      if (colNumber > 1) cell.numFmt = "#,##0";
    });
  }

  for (const fila of FILAS) {
    agregarFilaConcepto(
      fila.concepto,
      fila.label,
      fila.concepto === "total_nomina",
    );
    for (const sub of fila.sub ?? []) {
      agregarFilaConcepto(sub.concepto, sub.label, false);
    }
  }

  // Fila UF, igual que en el HTML/dashboard
  if (ufPorPeriodo.size > 0) {
    const filaUf: (string | number)[] = ["Total Nómina (UF)"];
    periodos.forEach((p) => {
      const totalNomina = valorPorConceptoYPeriodo.get(`total_nomina::${p}`);
      const valorUf = ufPorPeriodo.get(p);
      filaUf.push(totalNomina && valorUf ? totalNomina.monto / valorUf : "");
    });
    const row = detalle.addRow(filaUf);
    row.font = { italic: true, color: { argb: "FF003865" } };
    row.eachCell((cell, colNumber) => {
      if (colNumber > 1) cell.numFmt = "#,##0.0";
    });
  }

  detalle.getColumn(1).width = 22;
  detalle.columns.forEach((col, i) => {
    if (i > 0) col.width = 14;
  });

  const legend = detalle.addRow([]);
  detalle.addRow([
    "Amarillo = proyectado (fórmula, no dato real ingerido) — mismo criterio que el Excel original.",
  ]).font = {
    italic: true,
    size: 9,
    color: { argb: "FF94A3B8" },
  };
  void legend;

  // --- Hoja "Plan de Obra" — plan de obra (Gespro) + dotación real (Buk)
  // + flujo de dotación estimada (altas−bajas del modelo de curva por
  // obra similar) — pedido explícito del usuario. Formato "tidy" (1 fila
  // por obra/mes) para poder filtrar/pivotear directo en Excel.
  const ORIGEN_LABEL: Record<string, string> = {
    manual: "Manual",
    buk_real: "Buk (real)",
    modelo_estimado: "Estimado (modelo)",
  };
  if (planObraDotacion && planObraDotacion.length > 0) {
    const planObra = workbook.addWorksheet("Plan de Obra");
    const headerPlanObra = planObra.addRow([
      "Obra",
      "Comuna",
      "Tipo",
      "Cliente",
      "Unidades",
      "Inicio Obra",
      "Fin Obra",
      "Duración (meses)",
      "Período",
      "Dotación Real (Buk)",
      "Variación Neta (Altas−Bajas)",
      "Origen Variación",
    ]);
    headerPlanObra.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = FILL_HEADER;
    });

    for (const fila of planObraDotacion) {
      const row = planObra.addRow([
        fila.obraNombre,
        fila.comuna ?? "",
        fila.tipo ?? "",
        fila.cliente ?? "",
        fila.unidades ?? "",
        fila.inicioObra ?? "",
        fila.finObra ?? "",
        fila.durObraMeses ?? "",
        fila.periodo.slice(0, 7),
        fila.dotacionReal ?? "",
        fila.variacionNeta ?? "",
        fila.origenVariacion ? ORIGEN_LABEL[fila.origenVariacion] : "Sin dato",
      ]);
      if (fila.origenVariacion === "modelo_estimado") {
        row.getCell(11).fill = FILL_PROYECTADO;
        row.getCell(12).fill = FILL_PROYECTADO;
      }
    }

    planObra.getColumn(1).width = 28;
    planObra.getColumn(2).width = 16;
    planObra.getColumn(3).width = 10;
    planObra.getColumn(4).width = 12;
    planObra.getColumn(9).width = 10;
    planObra.getColumn(12).width = 18;

    const notaPlanObra = planObra.addRow([]);
    planObra.addRow([
      "Amarillo = dotación estimada por el modelo (curva de obras similares), no dato real de Buk.",
    ]).font = { italic: true, size: 9, color: { argb: "FF94A3B8" } };
    void notaPlanObra;
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
