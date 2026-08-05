import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseSolicitudRequerimiento } from "./solicitud-requerimiento-parser";

/**
 * Replica la estructura REAL confirmada del archivo
 * "Solicitud de Requerimiento remuneracion julio 2026 RP.xlsx"
 * (3 hojas: RP, retencion judicial, finiquito RP cuota) — ver
 * conversación de descubrimiento, no se commitea el archivo real
 * (contiene datos financieros reales de la empresa).
 */
async function buildSyntheticWorkbook() {
  const workbook = new ExcelJS.Workbook();

  const HEADERS = [
    "N° Soc.",
    "Sociedad",
    "RUT",
    "N° Division",
    "Division",
    "Fecha Solicitud",
    "Fecha Pago",
    "Concepto de pago",
    "Monto",
    "Sociedad Pagadora",
  ];

  const rp = workbook.addWorksheet("RP");
  rp.addRow(["Resumen Remuneraciones Julio 2026"]);
  rp.addRow([]);
  rp.addRow(HEADERS);
  rp.addRow([
    9,
    "MAESTRA POSVENTA SPA.",
    "0076319238-5",
    95,
    "Rol Privado Posventa",
    "27/07/2026",
    new Date(2026, 6, 30),
    "Remuneraciones Julio 2026",
    3_675_060,
    "MAESTRA SERVICIOS S.A.",
  ]);
  rp.addRow([
    7,
    "MAESTRA CONSTRUCCION S.A.",
    "0096990200-1",
    88,
    "Obra Vista Llacolén",
    "27/07/2026",
    new Date(2026, 6, 30),
    "Remuneraciones Julio 2026",
    12_416_711,
    "MAESTRA SERVICIOS S.A.",
  ]);
  rp.addRow(["", "", "", "", "", "", "", "Total", 16_091_771, ""]);

  const retJudicial = workbook.addWorksheet("retencion judicial");
  retJudicial.addRow(["Resumen retencion judicial Julio 2026"]);
  retJudicial.addRow([]);
  retJudicial.addRow(HEADERS);
  retJudicial.addRow([
    7,
    "MAESTRA CONSTRUCCION S.A.",
    "0096990200-1",
    90,
    "Rol Privado Arquitectura",
    "27/07/2026",
    new Date(2026, 6, 30),
    "Retencion Judicial Julio 2026",
    671_878,
    "MAESTRA SERVICIOS S.A.",
  ]);
  retJudicial.addRow(["", "", "", "", "", "", "", "Total", 671_878, ""]);

  const finiquitoCuota = workbook.addWorksheet("finiquito RP cuota");
  finiquitoCuota.addRow(["Resumen Remuneraciones Julio 2026"]);
  finiquitoCuota.addRow([]);
  finiquitoCuota.addRow(HEADERS);
  finiquitoCuota.addRow([
    93,
    "MAESTRA SERVICIOS S.A.",
    "0096996620-4",
    88,
    "Rol Privado Servicios",
    "27/07/2026",
    new Date(2026, 6, 30),
    "Finiquito RP cuota 4/5",
    5_121_937,
    "MAESTRA SERVICIOS S.A.",
  ]);
  finiquitoCuota.addRow(["", "", "", "", "", "", "", "Total", 5_121_937, ""]);

  return workbook.xlsx.writeBuffer();
}

describe("parseSolicitudRequerimiento", () => {
  it("parsea las 3 hojas y clasifica cada concepto correctamente", async () => {
    const buffer = await buildSyntheticWorkbook();
    const result = await parseSolicitudRequerimiento(buffer, "RP");

    expect(result.errores).toHaveLength(0);
    // 2 remuneración + 1 retención judicial (se pliega en remuneración) + 1 finiquito
    expect(result.lineItems).toHaveLength(4);

    const remuneraciones = result.lineItems.filter(
      (li) => li.concepto === "remuneracion_rp",
    );
    expect(remuneraciones).toHaveLength(3);
    expect(remuneraciones[0].periodo).toEqual(new Date(2026, 6, 1));
    expect(remuneraciones[0].sociedad).toBe("MAESTRA POSVENTA SPA.");
    expect(remuneraciones[0].monto).toBe(3_675_060);

    // Retención judicial se pliega en el bucket de remuneración (decisión documentada)
    expect(remuneraciones.some((li) => li.monto === 671_878)).toBe(true);

    const finiquito = result.lineItems.find(
      (li) => li.concepto === "finiquito",
    );
    expect(finiquito?.monto).toBe(5_121_937);
    // "Finiquito RP cuota 4/5" no tiene mes en el texto -> usa Fecha Pago
    expect(finiquito?.periodo).toEqual(new Date(2026, 6, 1));
  });

  it("extrae el nombre de obra desde la columna Division cuando existe", async () => {
    const buffer = await buildSyntheticWorkbook();
    const result = await parseSolicitudRequerimiento(buffer, "RP");

    const conObra = result.lineItems.find((li) =>
      li.division?.includes("Vista Llacolén"),
    );
    expect(conObra).toBeDefined();
  });

  it("ignora la fila de Total sin generar error", async () => {
    const buffer = await buildSyntheticWorkbook();
    const result = await parseSolicitudRequerimiento(buffer, "RP");
    expect(
      result.lineItems.every((li) => li.sociedad.toLowerCase() !== "total"),
    ).toBe(true);
  });

  it("respeta el sufijo RG del archivo cuando corresponde", async () => {
    const buffer = await buildSyntheticWorkbook();
    const result = await parseSolicitudRequerimiento(buffer, "RG");
    const remuneraciones = result.lineItems.filter(
      (li) => li.concepto === "remuneracion_rg",
    );
    expect(remuneraciones.length).toBeGreaterThan(0);
  });
});
