import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { renderReportExcel } from "./render-excel";
import type { ResumenKpis } from "@/features/cash-flow/services/queries";
import type { PlanObraDotacionFila } from "@/features/headcount/services/plan-obra-dotacion";

const KPIS: ResumenKpis = {
  totalMesActual: 100_000_000,
  totalMesAnterior: 90_000_000,
  variacionPct: 11.1,
  totalProximosTresMeses: 300_000_000,
  totalProximosDoceMeses: 1_200_000_000,
  mesPico: { periodo: "2026-12-01", monto: 150_000_000 },
  obrasSinPlan: 3,
  mesesProyectadosEnRango: 5,
  dotacionMesActual: 850,
  dotacionMesActualEsReal: true,
};

async function leerWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  return wb;
}

describe("renderReportExcel", () => {
  it("genera un .xlsx válido con las hojas Resumen, Detalle y Metodología, sin columna N° (comportamiento previo)", async () => {
    const buffer = await renderReportExcel({
      serie: [
        {
          periodo: "2026-07-01",
          concepto: "total_nomina",
          monto: 100_000_000,
          esReal: true,
          metodoCalculo: null,
        },
      ],
      kpis: KPIS,
      ufPorPeriodo: new Map(),
      periodoDesde: "2026-07-01",
      periodoHasta: "2026-07-01",
      generadoEn: new Date(2026, 7, 4),
    });

    expect(buffer.length).toBeGreaterThan(0);
    const wb = await leerWorkbook(buffer);
    expect(wb.getWorksheet("Resumen")).toBeDefined();
    expect(wb.getWorksheet("Detalle")).toBeDefined();
    expect(wb.getWorksheet("Metodología")).toBeDefined();
    // Sin dotacionPorConceptoYPeriodo, "Detalle" sigue con 1 columna por período.
    const detalle = wb.getWorksheet("Detalle")!;
    expect(detalle.getRow(1).getCell(2).value).toBe("2026-07");
  });

  it("con dotacionPorConceptoYPeriodo, agrega columnas N° pareadas y colapsa los períodos anteriores a columnasAgrupadasHastaPeriodo", async () => {
    const buffer = await renderReportExcel({
      serie: [
        {
          periodo: "2026-06-01",
          concepto: "anticipo_rg",
          monto: 40_000_000,
          esReal: true,
          metodoCalculo: null,
        },
        {
          periodo: "2026-07-01",
          concepto: "anticipo_rg",
          monto: 50_000_000,
          esReal: true,
          metodoCalculo: null,
        },
      ],
      dotacionPorConceptoYPeriodo: new Map([
        [
          "2026-06-01",
          {
            anticipo_rg: 320,
            anticipo_rp: 90,
            remuneracion_rg: 600,
            remuneracion_rp: 180,
          },
        ],
        [
          "2026-07-01",
          {
            anticipo_rg: 340,
            anticipo_rp: 95,
            remuneracion_rg: 650,
            remuneracion_rp: 190,
          },
        ],
      ]),
      kpis: KPIS,
      ufPorPeriodo: new Map(),
      periodoDesde: "2026-06-01",
      periodoHasta: "2026-07-01",
      // Solo julio queda expandido — junio queda agrupado/colapsado.
      columnasAgrupadasHastaPeriodo: "2026-07-01",
      generadoEn: new Date(2026, 7, 4),
    });

    const wb = await leerWorkbook(buffer);
    const detalle = wb.getWorksheet("Detalle")!;
    // Header fila 1: "Concepto" + "2026-06" (col2, merge 2-3) + "2026-07" (col4, merge 4-5).
    expect(detalle.getRow(1).getCell(2).value).toBe("2026-06");
    expect(detalle.getRow(1).getCell(4).value).toBe("2026-07");
    // Header fila 2: "$"/"N°" por cada período.
    expect(detalle.getRow(2).getCell(2).value).toBe("$");
    expect(detalle.getRow(2).getCell(3).value).toBe("N°");
    // Junio (col 2-3) queda agrupado y oculto; julio (col 4-5) no.
    expect(detalle.getColumn(2).outlineLevel).toBe(1);
    expect(detalle.getColumn(2).hidden).toBe(true);
    expect(detalle.getColumn(3).outlineLevel).toBe(1);
    expect(detalle.getColumn(4).outlineLevel ?? 0).toBe(0);
    expect(detalle.getColumn(4).hidden ?? false).toBe(false);

    // Bug real corregido 17-ago-2026: el N° de Anticipo RG debe ser
    // DISTINTO al de Remuneración RG (antes se reutilizaba el mismo
    // número para ambos, pese a que mucha menos gente pide Anticipo).
    // Ambas sub-filas se llaman "RG" — se distinguen por cuál aparece
    // primero (Anticipo va antes que Remuneración, ver FILAS_DETALLE).
    const filasRg: ExcelJS.Row[] = [];
    detalle.eachRow((row) => {
      if (row.getCell(1).value === "RG") filasRg.push(row);
    });
    expect(filasRg).toHaveLength(2);
    const [filaAnticipoRg, filaRemuneracionRg] = filasRg;
    expect(filaAnticipoRg.getCell(5).value).toBe(340); // N° de julio, Anticipo RG
    expect(filaRemuneracionRg.getCell(5).value).toBe(650); // N° de julio, Remuneración RG
    expect(filaAnticipoRg.getCell(5).value).not.toBe(
      filaRemuneracionRg.getCell(5).value,
    );
  });

  it("celdas proyectadas (Anticipo/Reliquidación/Cotización/Total Nómina) llevan una fórmula real con link a otras celdas, no solo el número", async () => {
    // Pedido explícito del usuario 17-ago-2026: "me gustaría que
    // existiera un link en la fórmula en el excel... el cálculo de los
    // flujos no está considerando la dotación, ya que en caso contrario
    // hubiera saltado" — se agregan fórmulas reales para poder
    // verificarlo clickeando la celda en Excel.
    const buffer = await renderReportExcel({
      serie: [
        {
          periodo: "2026-07-01",
          concepto: "remuneracion",
          monto: 100_000_000,
          esReal: true,
          metodoCalculo: "ingesta_real",
        },
        {
          periodo: "2026-07-01",
          concepto: "anticipo",
          monto: 24_000_000,
          esReal: false,
          metodoCalculo: "formula_24pct_remuneracion",
        },
        {
          periodo: "2026-07-01",
          concepto: "reliquidacion",
          monto: 1_000_000,
          esReal: false,
          metodoCalculo: "formula_1pct_remuneracion",
        },
        {
          periodo: "2026-07-01",
          concepto: "finiquito",
          monto: 2_000_000,
          esReal: true,
          metodoCalculo: "ingesta_real",
        },
        {
          periodo: "2026-07-01",
          concepto: "cotizacion",
          monto: 37_500_000,
          esReal: false,
          metodoCalculo: "formula_30pct_anticipo_mas_remun_mas_reliq",
        },
        {
          periodo: "2026-07-01",
          concepto: "sence",
          monto: 0,
          esReal: false,
          metodoCalculo: "no_corresponde_pago_anual",
        },
        {
          periodo: "2026-07-01",
          concepto: "total_nomina",
          monto: 164_500_000,
          esReal: false,
          metodoCalculo: "suma",
        },
      ],
      kpis: KPIS,
      ufPorPeriodo: new Map(),
      periodoDesde: "2026-07-01",
      periodoHasta: "2026-07-01",
      generadoEn: new Date(2026, 7, 4),
    });

    const wb = await leerWorkbook(buffer);
    const detalle = wb.getWorksheet("Detalle")!;
    // Sin columna N° (no se pasó dotacionPorConceptoYPeriodo): header=fila1,
    // Anticipo=fila2, RG=3, RP=4, Remuneración=fila5, RG=6, RP=7,
    // Finiquito=8, Reliquidación=9, Cotización=10, SENCE=11, Total Nómina=12.
    const celdaAnticipo = detalle.getRow(2).getCell(2)
      .value as ExcelJS.CellFormulaValue;
    expect(celdaAnticipo.formula).toBe("=B5*0.24");
    expect(celdaAnticipo.result).toBe(24_000_000);

    const celdaReliquidacion = detalle.getRow(9).getCell(2)
      .value as ExcelJS.CellFormulaValue;
    expect(celdaReliquidacion.formula).toBe("=B5*0.01");

    const celdaCotizacion = detalle.getRow(10).getCell(2)
      .value as ExcelJS.CellFormulaValue;
    expect(celdaCotizacion.formula).toBe("=(B2+B5+B9)*0.3");

    const celdaTotalNomina = detalle.getRow(12).getCell(2)
      .value as ExcelJS.CellFormulaValue;
    expect(celdaTotalNomina.formula).toBe("=B2+B5+B8+B9+B10+B11");
    expect(celdaTotalNomina.result).toBe(164_500_000);

    // Remuneración es REAL este mes — se ve el número plano, sin fórmula.
    expect(detalle.getRow(5).getCell(2).value).toBe(100_000_000);
  });

  it("Remuneración proyectada por costo-por-cabeza queda linkeada SOLO a la Dotación (N°) del propio mes — el costo base ya no se encadena del mes anterior (fix 24-sep-2026)", async () => {
    const buffer = await renderReportExcel({
      serie: [
        {
          periodo: "2026-06-01",
          concepto: "remuneracion",
          monto: 100_000_000,
          esReal: true,
          metodoCalculo: "ingesta_real",
        },
        {
          periodo: "2026-07-01",
          concepto: "remuneracion",
          monto: 104_000_000,
          esReal: false,
          metodoCalculo: "costo_por_cabeza_x_dotacion",
        },
      ],
      dotacionPorPeriodo: new Map([
        ["2026-06-01", { periodo: "2026-06-01", total: 800, esReal: true }],
        ["2026-07-01", { periodo: "2026-07-01", total: 820, esReal: false }],
      ]),
      kpis: KPIS,
      ufPorPeriodo: new Map(),
      periodoDesde: "2026-06-01",
      periodoHasta: "2026-07-01",
      generadoEn: new Date(2026, 7, 4),
    });

    const wb = await leerWorkbook(buffer);
    const detalle = wb.getWorksheet("Detalle")!;
    expect(detalle.getRow(2).getCell(1).value).toBe("Dotación (N°)");
    // Fila de "Remuneración" buscada por label (FILAS_DETALLE escribe
    // TODOS los conceptos, no solo los que trae esta serie de prueba —
    // hardcodear el número de fila sería frágil).
    let filaRemuneracionNumero: number | null = null;
    detalle.eachRow((row) => {
      if (row.getCell(1).value === "Remuneración")
        filaRemuneracionNumero = row.number;
    });
    expect(filaRemuneracionNumero).not.toBeNull();
    const celdaRemunJulio = detalle.getRow(filaRemuneracionNumero!).getCell(3)
      .value as ExcelJS.CellFormulaValue;
    // C2 = Dotación julio (820). Tasa efectiva = 104.000.000 / 820.
    expect(celdaRemunJulio.formula).toBe(`=C2*${104_000_000 / 820}`);
    expect(celdaRemunJulio.result).toBe(104_000_000);
  });


  it("con planObraDotacion, genera la hoja 'Plan de Obra' con origen 'plan'/'sin_plan' (Fase 2, reemplaza al modelo estadístico)", async () => {
    const PLAN_OBRA_DOTACION: PlanObraDotacionFila[] = [
      {
        obraId: "obra-1",
        obraNombre: "Obra Alfa",
        comuna: "Ñuñoa",
        tipo: "DS19",
        cliente: "Maestra",
        unidades: 120,
        inicioObra: "2026-06-01",
        finObra: "2027-06-01",
        durObraMeses: 12,
        periodo: "2026-06-01",
        dotacionReal: 50,
        dotacionProyectada: 50,
        variacionNeta: 50,
        origenVariacion: "plan",
      },
      {
        obraId: "obra-1",
        obraNombre: "Obra Alfa",
        comuna: "Ñuñoa",
        tipo: "DS19",
        cliente: "Maestra",
        unidades: 120,
        inicioObra: "2026-06-01",
        finObra: "2027-06-01",
        durObraMeses: 12,
        periodo: "2026-07-01",
        dotacionReal: null,
        dotacionProyectada: null,
        variacionNeta: null,
        origenVariacion: "sin_plan",
      },
    ];

    const buffer = await renderReportExcel({
      serie: [],
      kpis: KPIS,
      ufPorPeriodo: new Map(),
      periodoDesde: "2026-06-01",
      periodoHasta: "2026-07-01",
      generadoEn: new Date(2026, 7, 4),
      planObraDotacion: PLAN_OBRA_DOTACION,
    });

    const wb = await leerWorkbook(buffer);
    const planObra = wb.getWorksheet("Plan de Obra");
    expect(planObra).toBeDefined();

    const header = planObra!.getRow(1).values as unknown[];
    expect(header).toContain("Origen Variación");

    const filaJunio = planObra!.getRow(2).values as unknown[];
    expect(filaJunio).toContain("Plan (usuario)");

    const filaJulio = planObra!.getRow(3).values as unknown[];
    expect(filaJulio).toContain("Sin plan");

    // Hoja horizontal (24-sep-2026): una fila por obra, una columna por
    // mes — mismo formato que el "Headcount Plan de Obra" del Excel
    // tradicional del usuario.
    const horizontal = wb.getWorksheet("Plan de Obra (Horizontal)");
    expect(horizontal).toBeDefined();
    const headerHorizontal = horizontal!.getRow(1).values as unknown[];
    expect(headerHorizontal).toContain("2026-06");
    expect(headerHorizontal).toContain("2026-07");

    const filaObraAlfa = horizontal!.getRow(2);
    expect(filaObraAlfa.getCell(1).value).toBe("Obra Alfa");
    // Columna 9 = primer período (2026-06), columna 10 = segundo (2026-07).
    expect(filaObraAlfa.getCell(9).value).toBe(50);
    expect(filaObraAlfa.getCell(10).value).toBe("");
    expect(
      (filaObraAlfa.getCell(10).fill as ExcelJS.FillPattern).fgColor,
    ).toEqual({ argb: "FFD9D9D9" });
  });

  it("sin planObraDotacion, NO genera las hojas 'Plan de Obra' ni 'Plan de Obra (Horizontal)'", async () => {
    const buffer = await renderReportExcel({
      serie: [],
      kpis: KPIS,
      ufPorPeriodo: new Map(),
      periodoDesde: "2026-06-01",
      periodoHasta: "2026-07-01",
      generadoEn: new Date(2026, 7, 4),
    });

    const wb = await leerWorkbook(buffer);
    expect(wb.getWorksheet("Plan de Obra")).toBeUndefined();
    expect(wb.getWorksheet("Plan de Obra (Horizontal)")).toBeUndefined();
  });

  it("ya no genera la hoja 'Proyección Headcount' ni la hoja técnica '_fcn_baseline' (retiradas en la Fase 3, 24-sep-2026 — reemplazadas por el Plan de Dotación en SharePoint)", async () => {
    const PLAN_OBRA_DOTACION: PlanObraDotacionFila[] = [
      {
        obraId: "obra-1",
        obraNombre: "Obra Alfa",
        comuna: null,
        tipo: null,
        cliente: null,
        unidades: null,
        inicioObra: "2026-06-01",
        finObra: null,
        durObraMeses: 12,
        periodo: "2026-06-01",
        dotacionReal: 50,
        dotacionProyectada: 50,
        variacionNeta: 50,
        origenVariacion: "plan",
      },
    ];

    const buffer = await renderReportExcel({
      serie: [],
      kpis: KPIS,
      ufPorPeriodo: new Map(),
      periodoDesde: "2026-06-01",
      periodoHasta: "2026-07-01",
      generadoEn: new Date(2026, 7, 4),
      planObraDotacion: PLAN_OBRA_DOTACION,
    });

    const wb = await leerWorkbook(buffer);
    expect(wb.getWorksheet("Proyección Headcount")).toBeUndefined();
    expect(wb.getWorksheet("_fcn_baseline")).toBeUndefined();
  });

  it("lista en 'Resumen' las obras vencidas con dotación y sin plan de cierre (mismas alertas que /dotacion)", async () => {
    const buffer = await renderReportExcel({
      serie: [],
      kpis: KPIS,
      ufPorPeriodo: new Map(),
      periodoDesde: "2026-06-01",
      periodoHasta: "2026-07-01",
      generadoEn: new Date(2026, 7, 4),
      alertasCierre: [
        {
          obraId: "obra-1",
          obraNombre: "Obra Cerrada",
          finObra: "2026-05-31",
          dotacionActual: 12,
        },
      ],
    });

    const wb = await leerWorkbook(buffer);
    const valores: unknown[] = [];
    wb.getWorksheet("Resumen")!.eachRow((row) =>
      valores.push(row.getCell(1).value, row.getCell(3).value),
    );
    expect(valores).toContain("Obra Cerrada");
    expect(valores).toContain(12);
  });

  it("no agrega la sección de alertas si no hay obras vencidas sin plan", async () => {
    const buffer = await renderReportExcel({
      serie: [],
      kpis: KPIS,
      ufPorPeriodo: new Map(),
      periodoDesde: "2026-06-01",
      periodoHasta: "2026-07-01",
      generadoEn: new Date(2026, 7, 4),
      alertasCierre: [],
    });

    const wb = await leerWorkbook(buffer);
    const textos: string[] = [];
    wb.getWorksheet("Resumen")!.eachRow((row) =>
      textos.push(String(row.getCell(1).value ?? "")),
    );
    expect(textos.some((t) => t.startsWith("Alerta:"))).toBe(false);
  });
});
