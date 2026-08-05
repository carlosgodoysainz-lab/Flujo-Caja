import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseGesproWorkbook } from "./gespro-parser";

/**
 * Construye un workbook sintético que replica la estructura REAL confirmada
 * contra el archivo Gespro de producción (fila 1 vacía, encabezados en
 * fila 2, columnas de fecha/duración como fórmulas con `result`).
 * No se commitea el archivo real (es data de negocio), pero esta
 * estructura fue validada manualmente contra él — ver
 * scripts/verify-gespro-parser.ts.
 */
async function buildSyntheticWorkbook() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Plan de Obras");

  sheet.addRow([]); // fila 1: vacía, igual al archivo real
  sheet.addRow([
    "Cod",
    null,
    "Proyecto",
    "Comuna",
    "Tipo",
    "Cliente",
    "un",
    "VV",
    "Inicio Ventas",
    "Inicio Obra",
    "Dur. Obra",
    "Fin Obra",
  ]);
  sheet.addRow([
    "P999",
    null,
    "Obra Test Uno",
    "Ñuñoa",
    "Retail",
    "Maestra",
    100,
  ]);
  sheet.getRow(3).getCell(8).value = { formula: "1", result: 5 };
  sheet.getRow(3).getCell(9).value = {
    formula: "1",
    result: new Date("2023-01-01"),
  };
  sheet.getRow(3).getCell(10).value = {
    formula: "1",
    result: new Date("2024-05-13"),
  };
  sheet.getRow(3).getCell(11).value = { formula: "1", result: 22 };
  sheet.getRow(3).getCell(12).value = {
    formula: "1",
    result: new Date("2026-03-04"),
  };

  sheet.addRow([
    "P888",
    null,
    "Obra Test Dos",
    "Providencia",
    "DS19",
    "Terceros",
    50,
  ]);
  sheet.getRow(4).getCell(10).value = {
    formula: "1",
    result: new Date("2025-01-01"),
  };
  sheet.getRow(4).getCell(11).value = { formula: "1", result: 10 };
  sheet.getRow(4).getCell(12).value = {
    formula: "1",
    result: new Date("2025-11-01"),
  };

  // Fila con "Tipo" desconocido — debe normalizarse a "Otro", no fallar
  sheet.addRow([
    "P777",
    null,
    "Obra Test Tres",
    "Maipú",
    "TipoRaro",
    "Maestra",
    10,
  ]);

  // Fila sin nombre de proyecto — debe ser ignorada silenciosamente (fin de tabla)
  sheet.addRow(["", null, "", "", "", "", ""]);

  return workbook.xlsx.writeBuffer();
}

describe("parseGesproWorkbook", () => {
  it("parsea obras válidas y resuelve columnas de fórmula", async () => {
    const buffer = await buildSyntheticWorkbook();
    const result = await parseGesproWorkbook(buffer);

    expect(result.errores).toHaveLength(0);
    expect(result.obras).toHaveLength(3);

    const obra1 = result.obras[0];
    expect(obra1.codigoGespro).toBe("P999");
    expect(obra1.nombre).toBe("Obra Test Uno");
    expect(obra1.comuna).toBe("Ñuñoa");
    expect(obra1.tipo).toBe("Retail");
    expect(obra1.cliente).toBe("Maestra");
    expect(obra1.unidades).toBe(100);
    expect(obra1.inicioObra).toEqual(new Date("2024-05-13"));
    expect(obra1.finObra).toEqual(new Date("2026-03-04"));
    expect(obra1.durObraMeses).toBe(22);
  });

  it("normaliza tipos desconocidos a 'Otro' en vez de fallar", async () => {
    const buffer = await buildSyntheticWorkbook();
    const result = await parseGesproWorkbook(buffer);

    const obra3 = result.obras.find((o) => o.codigoGespro === "P777");
    expect(obra3?.tipo).toBe("Otro");
  });

  it("detiene la lectura de filas sin nombre de proyecto (fin de tabla)", async () => {
    const buffer = await buildSyntheticWorkbook();
    const result = await parseGesproWorkbook(buffer);

    // Solo las 3 filas con nombre — la fila vacía final no genera ni obra ni error
    expect(result.obras).toHaveLength(3);
    expect(result.errores).toHaveLength(0);
  });

  it("lanza error claro si la hoja 'Plan de Obras' no existe", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Otra Hoja");
    const buffer = await workbook.xlsx.writeBuffer();

    await expect(parseGesproWorkbook(buffer)).rejects.toThrow(/Plan de Obras/);
  });
});
