import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { renderReportExcel } from "./render-excel";
import type { ResumenKpis } from "@/features/cash-flow/services/queries";

const KPIS: ResumenKpis = {
  totalMesActual: 100_000_000,
  totalMesAnterior: 90_000_000,
  variacionPct: 11.1,
  totalProximosTresMeses: 300_000_000,
  totalProximosDoceMeses: 1_200_000_000,
  mesPico: { periodo: "2026-12-01", monto: 150_000_000 },
  obrasConEstimacion: 3,
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

  it("Remuneración proyectada por costo-por-cabeza queda linkeada a la fila Dotación (N°) del mes anterior y actual", async () => {
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
          // costo x cabeza puro sería 100M/800*820 = 102.500.000 -- el
          // real incluye 1.500.000 de Beneficios/Bonos implícitos, que
          // quedan como residual fijo sumado a la fórmula.
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
    // Bx = Remuneración junio (real, mes anterior, misma fila, col B);
    // B2 = Dotación junio; C2 = Dotación julio. Residual = 104.000.000 -
    // (100.000.000/800*820).
    expect(celdaRemunJulio.formula).toBe(
      `=B${filaRemuneracionNumero}/B2*C2+1500000`,
    );
    expect(celdaRemunJulio.result).toBe(104_000_000);
  });
});
