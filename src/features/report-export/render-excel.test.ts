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
    // Sin dotacionRgRpPorPeriodo, "Detalle" sigue con 1 columna por período.
    const detalle = wb.getWorksheet("Detalle")!;
    expect(detalle.getRow(1).getCell(2).value).toBe("2026-07");
  });

  it("con dotacionRgRpPorPeriodo, agrega columnas N° pareadas y colapsa los períodos anteriores a columnasAgrupadasHastaPeriodo", async () => {
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
      dotacionRgRpPorPeriodo: new Map([
        ["2026-06-01", { rg: 600, rp: 180 }],
        ["2026-07-01", { rg: 650, rp: 190 }],
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
  });
});
