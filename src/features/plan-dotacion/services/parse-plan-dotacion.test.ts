import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parsePlanDotacion } from "./parse-plan-dotacion";

async function construirWorkbook(params: {
  plan?: (string | number)[][];
  eventos?: (string | number)[][];
  sinHojaEventos?: boolean;
}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheetPlan = workbook.addWorksheet("Plan");
  const plan = params.plan ?? [
    ["Obra ID", "Obra", "oct-26", "nov-26"],
    ["obra-1", "Lira Parque", 10, 15],
    ["", "Oficina Central", 1, 1],
  ];
  for (const row of plan) sheetPlan.addRow(row);

  if (!params.sinHojaEventos) {
    const sheetEventos = workbook.addWorksheet("Eventos");
    const eventos = params.eventos ?? [
      ["Mes", "Concepto", "Modo", "Monto", "Obra", "Población", "Descripción"],
      [
        "abr-27",
        "remuneracion",
        "monto_total",
        80_000_000,
        "Jorge Edwards",
        "",
        "Bono término negociación",
      ],
    ];
    for (const row of eventos) sheetEventos.addRow(row);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

const OBRAS = new Map([
  ["obra-1", "Lira Parque"],
  ["obra-2", "Jorge Edwards"],
]);

describe("parsePlanDotacion", () => {
  it("parsea filas de obra por Obra ID y la fila especial Oficina Central (obraId null)", async () => {
    const buffer = await construirWorkbook({});
    const result = await parsePlanDotacion(buffer, OBRAS);

    expect(result.errores).toEqual([]);
    expect(result.filas).toEqual([
      { obraId: "obra-1", periodo: "2026-10-01", variacionNeta: 10 },
      { obraId: "obra-1", periodo: "2026-11-01", variacionNeta: 15 },
      { obraId: null, periodo: "2026-10-01", variacionNeta: 1 },
      { obraId: null, periodo: "2026-11-01", variacionNeta: 1 },
    ]);
  });

  it("resuelve por nombre cuando falta la columna/valor Obra ID", async () => {
    const buffer = await construirWorkbook({
      plan: [
        ["Obra", "oct-26"],
        ["Jorge Edwards", 5],
      ],
    });
    const result = await parsePlanDotacion(buffer, OBRAS);
    expect(result.errores).toEqual([]);
    expect(result.filas).toEqual([
      { obraId: "obra-2", periodo: "2026-10-01", variacionNeta: 5 },
    ]);
  });

  it("reporta error si la obra no coincide con ninguna conocida", async () => {
    const buffer = await construirWorkbook({
      plan: [
        ["Obra", "oct-26"],
        ["Obra Inexistente", 5],
      ],
    });
    const result = await parsePlanDotacion(buffer, OBRAS);
    expect(result.filas).toEqual([]);
    expect(result.errores).toEqual([
      {
        hoja: "Plan",
        fila: 2,
        motivo:
          'Obra "Obra Inexistente" no coincide con ninguna obra conocida (ni por Obra ID ni por nombre).',
      },
    ]);
  });

  it("celda vacía se omite (sin plan ese mes), no se interpreta como 0", async () => {
    const buffer = await construirWorkbook({
      plan: [
        ["Obra ID", "Obra", "oct-26", "nov-26"],
        ["obra-1", "Lira Parque", 10, ""],
      ],
    });
    const result = await parsePlanDotacion(buffer, OBRAS);
    expect(result.filas).toEqual([
      { obraId: "obra-1", periodo: "2026-10-01", variacionNeta: 10 },
    ]);
  });

  it("reporta error si el valor no es un entero válido", async () => {
    const buffer = await construirWorkbook({
      plan: [
        ["Obra ID", "Obra", "oct-26"],
        ["obra-1", "Lira Parque", "diez"],
      ],
    });
    const result = await parsePlanDotacion(buffer, OBRAS);
    expect(result.filas).toEqual([]);
    expect(result.errores).toHaveLength(1);
    expect(result.errores[0].motivo).toContain("no es un número entero");
  });

  it("parsea la hoja Eventos: monto total, obra específica", async () => {
    const buffer = await construirWorkbook({});
    const result = await parsePlanDotacion(buffer, OBRAS);
    expect(result.eventos).toEqual([
      {
        periodo: "2027-04-01",
        concepto: "remuneracion",
        modo: "monto_total",
        monto: 80_000_000,
        moneda: "clp",
        obraId: "obra-2",
        poblacion: null,
        descripcion: "Bono término negociación",
      },
    ]);
  });

  it("hoja Eventos ausente no es un error — es opcional", async () => {
    const buffer = await construirWorkbook({ sinHojaEventos: true });
    const result = await parsePlanDotacion(buffer, OBRAS);
    expect(result.eventos).toEqual([]);
    expect(result.errores.filter((e) => e.hoja === "Eventos")).toEqual([]);
  });

  it("evento por_persona con población", async () => {
    const buffer = await construirWorkbook({
      eventos: [
        [
          "Mes",
          "Concepto",
          "Modo",
          "Monto",
          "Obra",
          "Población",
          "Descripción",
        ],
        [
          "sep-26",
          "anticipo",
          "por_persona",
          50000,
          "",
          "rg",
          "Aguinaldo extra",
        ],
      ],
    });
    const result = await parsePlanDotacion(buffer, OBRAS);
    expect(result.errores).toEqual([]);
    expect(result.eventos).toEqual([
      {
        periodo: "2026-09-01",
        concepto: "anticipo",
        modo: "por_persona",
        monto: 50000,
        moneda: "clp",
        obraId: null,
        poblacion: "rg",
        descripcion: "Aguinaldo extra",
      },
    ]);
  });

  it("archivo sin ninguna fila válida en Plan trae una advertencia", async () => {
    const buffer = await construirWorkbook({
      plan: [["Obra", "no-es-un-mes"]],
    });
    const result = await parsePlanDotacion(buffer, OBRAS);
    expect(result.filas).toEqual([]);
    expect(result.advertencias.length).toBeGreaterThan(0);
  });

  it("lee la columna Moneda: UF queda en UF, vacía o ausente es CLP", async () => {
    const buffer = await construirWorkbook({
      eventos: [
        ["Mes", "Concepto", "Modo", "Monto", "Moneda", "Obra", "Población"],
        ["ene-27", "remuneracion", "monto_total", 1713.82, "UF", "", "rg"],
        ["abr-27", "remuneracion", "monto_total", 80_000_000, "", "Jorge Edwards", ""],
      ],
    });
    const result = await parsePlanDotacion(buffer, OBRAS);

    expect(result.errores).toEqual([]);
    expect(result.eventos.map((e) => [e.periodo, e.monto, e.moneda])).toEqual([
      ["2027-01-01", 1713.82, "uf"],
      ["2027-04-01", 80_000_000, "clp"],
    ]);
  });

  it("reporta error si la Moneda no es CLP ni UF", async () => {
    const buffer = await construirWorkbook({
      eventos: [
        ["Mes", "Concepto", "Monto", "Moneda"],
        ["ene-27", "remuneracion", 100, "USD"],
      ],
    });
    const result = await parsePlanDotacion(buffer, OBRAS);

    expect(result.eventos).toEqual([]);
    expect(result.errores[0].motivo).toContain("Moneda");
  });
});
