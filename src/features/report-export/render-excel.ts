import ExcelJS from "exceljs";
import type {
  CashFlowSeriePunto,
  ResumenKpis,
} from "@/features/cash-flow/services/queries";

const CONCEPTOS_ORDEN = [
  "anticipo",
  "remuneracion",
  "finiquito",
  "reliquidacion",
  "cotizacion",
  "sence",
  "total_nomina",
] as const;
const CONCEPTO_LABEL: Record<string, string> = {
  anticipo: "Anticipo",
  remuneracion: "Remuneración",
  finiquito: "Finiquito",
  reliquidacion: "Reliquidación",
  cotizacion: "Cotización",
  sence: "Aporte SENCE",
  total_nomina: "Total Nómina",
};

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
  periodoDesde: string;
  periodoHasta: string;
  generadoEn: Date;
}): Promise<Buffer> {
  const { serie, kpis, ufPorPeriodo, periodoDesde, periodoHasta, generadoEn } =
    params;

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
  resumen.addRow(["Obras con dotación estimada", kpis.obrasConEstimacion]);
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

  for (const concepto of CONCEPTOS_ORDEN) {
    const fila: (string | number)[] = [CONCEPTO_LABEL[concepto]];
    const celdasProyectadas: number[] = [];
    periodos.forEach((p, i) => {
      const punto = valorPorConceptoYPeriodo.get(`${concepto}::${p}`);
      fila.push(punto ? punto.monto : "");
      if (punto && !punto.esReal) celdasProyectadas.push(i + 2); // +2: col 1 es "Concepto", 1-indexed
    });
    const row = detalle.addRow(fila);
    if (concepto === "total_nomina") row.font = { bold: true };
    for (const colNum of celdasProyectadas) {
      row.getCell(colNum).fill = FILL_PROYECTADO;
    }
    row.eachCell((cell, colNumber) => {
      if (colNumber > 1) cell.numFmt = "#,##0";
    });
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

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
