import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  parseHeadcountUpload,
  calcularAcumuladosDesdeSaldoInicial,
} from "./parse-headcount-upload";

/**
 * Construye un buffer .xlsx en memoria con el mismo layout que
 * `renderProyeccionHeadcount` (render-excel.ts): Obra ID (col 1, oculta),
 * Obra, ..., columnas de mes con etiqueta "may-26" etc. — para probar el
 * parser sin depender de un archivo real en disco.
 */
async function construirWorkbook(
  filas: {
    obraId: string;
    obraNombre: string;
    celdas: Record<string, unknown>; // etiqueta de mes -> valor
  }[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Proyección Headcount");
  const meses = ["may-26", "jun-26", "jul-26"];
  sheet.addRow([
    "Obra ID",
    "Obra",
    "Comuna",
    "Tipo",
    "Cliente",
    "Unidades",
    "Inicio Obra",
    "Fin Obra",
    "Duración (meses)",
    "Saldo Inicial (Buk)",
    ...meses,
  ]);
  for (const fila of filas) {
    sheet.addRow([
      fila.obraId,
      fila.obraNombre,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      ...meses.map((m) => fila.celdas[m] ?? ""),
    ]);
  }
  sheet.addRow([
    "",
    "Oficina Central",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    5,
    3,
    -2,
  ]);
  sheet.addRow(["", "Total", "", "", "", "", "", "", "", "", 5, 8, 3]);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

describe("parseHeadcountUpload", () => {
  it("parsea celdas válidas y excluye 'Oficina Central'/'Total'", async () => {
    const buffer = await construirWorkbook([
      {
        obraId: "obra-1",
        obraNombre: "Jorge Edwards",
        celdas: { "may-26": 10, "jun-26": -5 },
      },
    ]);
    const obrasConocidas = new Map([["obra-1", "Jorge Edwards"]]);
    const resultado = await parseHeadcountUpload(buffer, obrasConocidas);

    expect(resultado.errores).toEqual([]);
    expect(resultado.celdas).toEqual([
      { obraId: "obra-1", periodo: "2026-05-01", variacionNeta: 10 },
      { obraId: "obra-1", periodo: "2026-06-01", variacionNeta: -5 },
    ]);
  });

  it("una celda inválida se reporta y se omite, sin bloquear las demás celdas válidas de la misma obra", async () => {
    const buffer = await construirWorkbook([
      {
        obraId: "obra-1",
        obraNombre: "Jorge Edwards",
        celdas: { "may-26": 10, "jun-26": "no-es-numero", "jul-26": -8 },
      },
    ]);
    const obrasConocidas = new Map([["obra-1", "Jorge Edwards"]]);
    const resultado = await parseHeadcountUpload(buffer, obrasConocidas);

    expect(resultado.celdas).toEqual([
      { obraId: "obra-1", periodo: "2026-05-01", variacionNeta: 10 },
      { obraId: "obra-1", periodo: "2026-07-01", variacionNeta: -8 },
    ]);
    expect(resultado.errores).toHaveLength(1);
    expect(resultado.errores[0].periodo).toBe("2026-06-01");
  });

  it("obra_id que no corresponde a ninguna obra existente se reporta como error", async () => {
    const buffer = await construirWorkbook([
      {
        obraId: "obra-fantasma",
        obraNombre: "Obra Fantasma",
        celdas: { "may-26": 10 },
      },
    ]);
    const resultado = await parseHeadcountUpload(buffer, new Map());

    expect(resultado.celdas).toEqual([]);
    expect(resultado.errores).toHaveLength(1);
    expect(resultado.errores[0].motivo).toContain("obra-fantasma");
  });

  it("nombre visible desincronizado del 'Obra ID' se reporta como advertencia, no bloquea", async () => {
    const buffer = await construirWorkbook([
      {
        obraId: "obra-1",
        obraNombre: "Jorge Edwards (editado por error)",
        celdas: { "may-26": 10 },
      },
    ]);
    const obrasConocidas = new Map([["obra-1", "Jorge Edwards"]]);
    const resultado = await parseHeadcountUpload(buffer, obrasConocidas);

    expect(resultado.celdas).toEqual([
      { obraId: "obra-1", periodo: "2026-05-01", variacionNeta: 10 },
    ]);
    expect(resultado.advertenciasNombre).toEqual([
      {
        obraId: "obra-1",
        nombreEnArchivo: "Jorge Edwards (editado por error)",
        nombreReal: "Jorge Edwards",
      },
    ]);
  });

  it("celdas en blanco se omiten sin generar error (no editadas)", async () => {
    const buffer = await construirWorkbook([
      { obraId: "obra-1", obraNombre: "Jorge Edwards", celdas: {} },
    ]);
    const obrasConocidas = new Map([["obra-1", "Jorge Edwards"]]);
    const resultado = await parseHeadcountUpload(buffer, obrasConocidas);

    expect(resultado.celdas).toEqual([]);
    expect(resultado.errores).toEqual([]);
  });
});

describe("calcularAcumuladosDesdeSaldoInicial", () => {
  it("encadena el acumulado desde el saldo inicial, mes a mes", () => {
    const resultado = calcularAcumuladosDesdeSaldoInicial(100, [
      { periodo: "2026-05-01", variacionNeta: 10 },
      { periodo: "2026-06-01", variacionNeta: -5 },
      { periodo: "2026-07-01", variacionNeta: 20 },
    ]);
    expect([...resultado.entries()]).toEqual([
      ["2026-05-01", 110],
      ["2026-06-01", 105],
      ["2026-07-01", 125],
    ]);
  });

  it("sin ninguna celda, devuelve un mapa vacío", () => {
    expect(calcularAcumuladosDesdeSaldoInicial(100, [])).toEqual(new Map());
  });
});
