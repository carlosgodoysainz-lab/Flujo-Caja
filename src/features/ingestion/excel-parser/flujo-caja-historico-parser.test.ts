import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseFlujoCajaHistorico } from "./flujo-caja-historico-parser";

const AMARILLO: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFFFF00" },
};

/**
 * Construye un workbook mínimo con la MISMA estructura real de la hoja
 * "Detalle" (ver flujo-caja-historico-parser.ts): fila 3 = header de
 * meses, filas 5/6/8/9/10/11/12/13 = conceptos, columnas de a 2 (valor +
 * N°) empezando en la columna C (col 3) = noviembre 2022 (k=0).
 */
function construirWorkbookDetalle(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const detalle = wb.addWorksheet("Detalle");

  // k=0 → noviembre 2022 (real), k=1 → diciembre 2022 (real, con dotación
  // RG/RP), k=2 → enero 2023 (PROYECTADO — amarillo, no debe importarse).
  detalle.getCell(3, 3).value = "Noviembre";
  detalle.getCell(3, 4).value = "N°";
  detalle.getCell(3, 5).value = "Diciembre";
  detalle.getCell(3, 6).value = "N°";
  detalle.getCell(3, 7).value = "Enero";
  detalle.getCell(3, 8).value = "N°";

  // k=0 (nov-2022): anticipo RG real, remuneración RG real con dotación 100.
  detalle.getCell(5, 3).value = 1_000_000; // anticipo_rg
  detalle.getCell(8, 3).value = 50_000_000; // remuneracion_rg
  detalle.getCell(8, 4).value = 100; // N° dotación RG

  // k=1 (dic-2022): remuneración RP real con dotación 20, finiquito real.
  detalle.getCell(9, 5).value = 5_000_000; // remuneracion_rp
  detalle.getCell(9, 6).value = 20; // N° dotación RP
  detalle.getCell(10, 5).value = 2_000_000; // finiquito

  // k=2 (ene-2023): PROYECTADO — celda amarilla, no debe importarse aunque tenga valor.
  const celdaProyectada = detalle.getCell(5, 7);
  celdaProyectada.value = 999_999_999;
  celdaProyectada.fill = AMARILLO;
  const celdaProyectadaHc = detalle.getCell(8, 8);
  celdaProyectadaHc.value = 500;
  celdaProyectadaHc.fill = AMARILLO;

  return wb;
}

async function workbookABuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  const arr = await wb.xlsx.writeBuffer();
  return Buffer.from(arr);
}

describe("parseFlujoCajaHistorico", () => {
  it("importa solo celdas REALES (no amarillas), con el período correcto", async () => {
    const buffer = await workbookABuffer(construirWorkbookDetalle());
    const { lineas, errores } = await parseFlujoCajaHistorico(buffer);

    expect(errores).toEqual([]);

    const anticipoRg = lineas.find((l) => l.concepto === "anticipo_rg");
    expect(anticipoRg?.monto).toBe(1_000_000);
    expect(anticipoRg?.periodo).toEqual(new Date(2022, 10, 1)); // noviembre 2022

    const finiquito = lineas.find((l) => l.concepto === "finiquito");
    expect(finiquito?.monto).toBe(2_000_000);
    expect(finiquito?.periodo).toEqual(new Date(2022, 11, 1)); // diciembre 2022
  });

  it("NUNCA importa una celda proyectada (amarilla), aunque tenga un valor numérico", async () => {
    const buffer = await workbookABuffer(construirWorkbookDetalle());
    const { lineas } = await parseFlujoCajaHistorico(buffer);

    // k=2 (enero 2023) era amarilla con valor 999.999.999 — no debe aparecer.
    const contieneValorProyectado = lineas.some((l) => l.monto === 999_999_999);
    expect(contieneValorProyectado).toBe(false);
  });

  it("agrupa la dotación RG/RP del mismo período en un solo punto", async () => {
    const buffer = await workbookABuffer(construirWorkbookDetalle());
    const { dotacion } = await parseFlujoCajaHistorico(buffer);

    const nov2022 = dotacion.find(
      (d) => d.periodo.getTime() === new Date(2022, 10, 1).getTime(),
    );
    expect(nov2022?.rg).toBe(100);
    expect(nov2022?.rp).toBe(null); // no había RP ese mes en el fixture

    const dic2022 = dotacion.find(
      (d) => d.periodo.getTime() === new Date(2022, 11, 1).getTime(),
    );
    expect(dic2022?.rp).toBe(20);

    // La celda de dotación proyectada (enero 2023, amarilla) tampoco se importa.
    const ene2023 = dotacion.find(
      (d) => d.periodo.getTime() === new Date(2023, 0, 1).getTime(),
    );
    expect(ene2023).toBeUndefined();
  });

  it("se detiene al llegar a una columna de mes sin header (fin de los datos)", async () => {
    const buffer = await workbookABuffer(construirWorkbookDetalle());
    const { lineas, dotacion } = await parseFlujoCajaHistorico(buffer);
    // Solo 3 meses de header en el fixture (k=0,1,2) — nunca debería
    // "inventar" un k=3 en adelante.
    const periodosUnicos = new Set([
      ...lineas.map((l) => l.periodo.getTime()),
      ...dotacion.map((d) => d.periodo.getTime()),
    ]);
    expect(periodosUnicos.size).toBeLessThanOrEqual(3);
  });

  it('devuelve un error legible si la hoja "Detalle" no existe', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("OtraHoja");
    const buffer = await workbookABuffer(wb);
    const { lineas, errores } = await parseFlujoCajaHistorico(buffer);
    expect(lineas).toEqual([]);
    expect(errores.length).toBeGreaterThan(0);
  });
});
