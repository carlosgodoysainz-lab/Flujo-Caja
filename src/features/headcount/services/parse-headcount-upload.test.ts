import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  parseHeadcountUpload,
  clasificarCeldas,
  diffContraBaseDeDatos,
} from "./parse-headcount-upload";

/**
 * Construye un buffer .xlsx en memoria con el mismo layout que
 * `renderProyeccionHeadcount` (render-excel.ts): Obra ID (col 1, oculta),
 * Obra, ..., columnas de mes con etiqueta "may-26" etc. — para probar el
 * parser sin depender de un archivo real en disco.
 *
 * `baseline`: si se provee, escribe la hoja técnica `_fcn_baseline` con
 * EXACTAMENTE el mismo contrato que `escribirHojaBaseline` en
 * render-excel.ts (marca "FCN_BASELINE", versión 1). `undefined` = no
 * escribir la hoja (simula un archivo descargado antes del fix).
 */
async function construirWorkbook(
  filas: {
    obraId: string;
    obraNombre: string;
    celdas: Record<string, unknown>; // etiqueta de mes -> valor
  }[],
  opciones?: {
    baseline?: { obraId: string; periodo: string; valor: number }[];
    versionBaseline?: number;
    generadoEn?: string;
  },
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

  if (opciones?.baseline) {
    const baselineSheet = workbook.addWorksheet("_fcn_baseline");
    baselineSheet.addRow([
      "FCN_BASELINE",
      opciones.versionBaseline ?? 1,
      opciones.generadoEn ?? "2026-09-01T12:00:00.000Z",
    ]);
    baselineSheet.addRow(["obraId", "periodo", "valor"]);
    for (const b of opciones.baseline) {
      baselineSheet.addRow([b.obraId, b.periodo, b.valor]);
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

describe("parseHeadcountUpload", () => {
  it("SIN baseline (archivo pre-fix), toda celda con valor es candidata — modo compatibilidad", async () => {
    const buffer = await construirWorkbook([
      {
        obraId: "obra-1",
        obraNombre: "Jorge Edwards",
        celdas: { "may-26": 10, "jun-26": -5 },
      },
    ]);
    const obrasConocidas = new Map([["obra-1", "Jorge Edwards"]]);
    const resultado = await parseHeadcountUpload(buffer, obrasConocidas);

    expect(resultado.baselinePresente).toBe(false);
    expect(resultado.errores).toEqual([]);
    expect(resultado.celdas).toEqual([
      { obraId: "obra-1", periodo: "2026-05-01", variacionNeta: 10 },
      { obraId: "obra-1", periodo: "2026-06-01", variacionNeta: -5 },
    ]);
  });

  it("REGRESIÓN DEL BUG: el archivo tal cual salió del export (todas las celdas = baseline) no genera NINGUNA edición", async () => {
    const buffer = await construirWorkbook(
      [
        {
          obraId: "obra-1",
          obraNombre: "Jorge Edwards",
          celdas: { "may-26": 10, "jun-26": -5, "jul-26": 3 },
        },
      ],
      {
        baseline: [
          { obraId: "obra-1", periodo: "2026-05-01", valor: 10 },
          { obraId: "obra-1", periodo: "2026-06-01", valor: -5 },
          { obraId: "obra-1", periodo: "2026-07-01", valor: 3 },
        ],
      },
    );
    const obrasConocidas = new Map([["obra-1", "Jorge Edwards"]]);
    const resultado = await parseHeadcountUpload(buffer, obrasConocidas);

    expect(resultado.baselinePresente).toBe(true);
    expect(resultado.celdas).toEqual([]);
    expect(resultado.celdasSinCambios).toBe(3);
    expect(resultado.errores).toEqual([]);
  });

  it("con baseline, solo las celdas que difieren del baseline son ediciones", async () => {
    const buffer = await construirWorkbook(
      [
        {
          obraId: "obra-1",
          obraNombre: "Jorge Edwards",
          celdas: { "may-26": 8, "jun-26": -5, "jul-26": 3 },
        },
      ],
      {
        baseline: [
          { obraId: "obra-1", periodo: "2026-05-01", valor: 10 }, // el usuario lo cambió a 8
          { obraId: "obra-1", periodo: "2026-06-01", valor: -5 }, // igual
          { obraId: "obra-1", periodo: "2026-07-01", valor: 3 }, // igual
        ],
      },
    );
    const obrasConocidas = new Map([["obra-1", "Jorge Edwards"]]);
    const resultado = await parseHeadcountUpload(buffer, obrasConocidas);

    expect(resultado.celdas).toEqual([
      { obraId: "obra-1", periodo: "2026-05-01", variacionNeta: 8 },
    ]);
    expect(resultado.celdasSinCambios).toBe(2);
  });

  it("celda con valor donde el baseline no tenía nada (export dejó vacío) cuenta como edición", async () => {
    const buffer = await construirWorkbook(
      [
        {
          obraId: "obra-1",
          obraNombre: "Jorge Edwards",
          celdas: { "may-26": 7 },
        },
      ],
      { baseline: [] }, // ninguna celda tenía dato en el export
    );
    const obrasConocidas = new Map([["obra-1", "Jorge Edwards"]]);
    const resultado = await parseHeadcountUpload(buffer, obrasConocidas);

    expect(resultado.celdas).toEqual([
      { obraId: "obra-1", periodo: "2026-05-01", variacionNeta: 7 },
    ]);
  });

  it("celda vaciada por el usuario donde el baseline tenía número: no es edición, aparece en celdasBorradas", async () => {
    const buffer = await construirWorkbook(
      [
        {
          obraId: "obra-1",
          obraNombre: "Jorge Edwards",
          celdas: { "jun-26": -5 }, // may-26 quedó vacío
        },
      ],
      {
        baseline: [
          { obraId: "obra-1", periodo: "2026-05-01", valor: 12 },
          { obraId: "obra-1", periodo: "2026-06-01", valor: -5 },
        ],
      },
    );
    const obrasConocidas = new Map([["obra-1", "Jorge Edwards"]]);
    const resultado = await parseHeadcountUpload(buffer, obrasConocidas);

    expect(resultado.celdas).toEqual([]);
    expect(resultado.celdasBorradas).toEqual([
      {
        obra: "Jorge Edwards",
        obraId: "obra-1",
        periodo: "2026-05-01",
        valorAnterior: 12,
      },
    ]);
  });

  it("hoja baseline con versión desconocida se trata como ausente (modo compatibilidad)", async () => {
    const buffer = await construirWorkbook(
      [
        {
          obraId: "obra-1",
          obraNombre: "Jorge Edwards",
          celdas: { "may-26": 10 },
        },
      ],
      {
        baseline: [{ obraId: "obra-1", periodo: "2026-05-01", valor: 10 }],
        versionBaseline: 99,
      },
    );
    const obrasConocidas = new Map([["obra-1", "Jorge Edwards"]]);
    const resultado = await parseHeadcountUpload(buffer, obrasConocidas);

    expect(resultado.baselinePresente).toBe(false);
    // Sin baseline confiable, toda celda con valor es candidata.
    expect(resultado.celdas).toEqual([
      { obraId: "obra-1", periodo: "2026-05-01", variacionNeta: 10 },
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

  it("celdas en blanco sin baseline se omiten sin generar error ni edición", async () => {
    const buffer = await construirWorkbook([
      { obraId: "obra-1", obraNombre: "Jorge Edwards", celdas: {} },
    ]);
    const obrasConocidas = new Map([["obra-1", "Jorge Edwards"]]);
    const resultado = await parseHeadcountUpload(buffer, obrasConocidas);

    expect(resultado.celdas).toEqual([]);
    expect(resultado.errores).toEqual([]);
    expect(resultado.celdasBorradas).toEqual([]);
  });
});

describe("clasificarCeldas", () => {
  it("sin baseline (null), toda celda con valor es candidata y ninguna celda vacía es 'borrada'", () => {
    const resultado = clasificarCeldas(
      [
        { obraId: "o1", periodo: "2026-05-01", valor: 10 },
        { obraId: "o1", periodo: "2026-06-01", valor: null },
      ],
      null,
    );
    expect(resultado.edicionesDetectadas).toEqual([
      { obraId: "o1", periodo: "2026-05-01", variacionNeta: 10 },
    ]);
    expect(resultado.borradas).toEqual([]);
    expect(resultado.sinCambios).toBe(0);
  });

  it("con baseline, celda con el mismo valor no es edición", () => {
    const baseline = new Map([["o1::2026-05-01", 10]]);
    const resultado = clasificarCeldas(
      [{ obraId: "o1", periodo: "2026-05-01", valor: 10 }],
      baseline,
    );
    expect(resultado.edicionesDetectadas).toEqual([]);
    expect(resultado.sinCambios).toBe(1);
  });
});

describe("diffContraBaseDeDatos", () => {
  it("descarta las candidatas cuyo valor coincide con lo ya guardado", () => {
    const candidatas = [
      { obraId: "o1", periodo: "2026-05-01", variacionNeta: 10 },
      { obraId: "o1", periodo: "2026-06-01", variacionNeta: -5 },
      { obraId: "o1", periodo: "2026-07-01", variacionNeta: 3 },
    ];
    const existente = new Map([
      ["o1::2026-05-01", 10], // igual, no es edición real
      ["o1::2026-06-01", -8], // distinto, sí es edición real
      // 2026-07-01 no existe en BD -> es edición real
    ]);
    expect(diffContraBaseDeDatos(candidatas, existente)).toEqual([
      { obraId: "o1", periodo: "2026-06-01", variacionNeta: -5 },
      { obraId: "o1", periodo: "2026-07-01", variacionNeta: 3 },
    ]);
  });
});
