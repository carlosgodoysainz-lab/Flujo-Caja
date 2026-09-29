import { describe, expect, it } from "vitest";
import {
  controlAnticipoVsDotacion,
  controlBonoEneroJulio,
  controlDocumentosParciales,
  controlSaltoAguinaldo,
  controlSaltoBuk,
  controlSumaObras,
  evaluarControles,
  type DatosControles,
} from "./controles";

const VACIO: DatosControles = {
  beneficiarios: [],
  dotacionPorPeriodo: {},
  sumaObrasPorPeriodo: {},
  documentos: [],
  anticipoMensual: [],
  buk: { anterior: null, ultima: null },
  remuneracionProyectada: [],
};

const con = (parcial: Partial<DatosControles>): DatosControles => ({
  ...VACIO,
  ...parcial,
});

describe("controlAnticipoVsDotacion", () => {
  it("alerta el caso real de sep-2026: 1.533 personas con Anticipo vs 916", () => {
    const r = controlAnticipoVsDotacion(
      con({
        beneficiarios: [
          { periodo: "2026-09-01", anticipoRg: 1492, anticipoRp: 41 },
        ],
        dotacionPorPeriodo: { "2026-09-01": 916 },
      }),
    );
    expect(r.estado).toBe("alerta");
    expect(r.detalle).toContain("2026-09");
  });

  it("ok cuando las personas caben en la dotación", () => {
    const r = controlAnticipoVsDotacion(
      con({
        beneficiarios: [
          { periodo: "2026-08-01", anticipoRg: 738, anticipoRp: 7 },
        ],
        dotacionPorPeriodo: { "2026-08-01": 935 },
      }),
    );
    expect(r.estado).toBe("ok");
  });

  it("sin datos si no hay meses con ambos datos", () => {
    expect(controlAnticipoVsDotacion(VACIO).estado).toBe("sin_datos");
  });
});

describe("controlSumaObras", () => {
  it("alerta cuando las obras suman más que el total (caso ago-2026: 4.000+ vs 935)", () => {
    const r = controlSumaObras(
      con({
        sumaObrasPorPeriodo: { "2026-08-01": 4200 },
        dotacionPorPeriodo: { "2026-08-01": 935 },
      }),
    );
    expect(r.estado).toBe("alerta");
  });

  it("ok cuando las obras caben en el total", () => {
    const r = controlSumaObras(
      con({
        sumaObrasPorPeriodo: { "2026-08-01": 683 },
        dotacionPorPeriodo: { "2026-08-01": 935 },
      }),
    );
    expect(r.estado).toBe("ok");
  });
});

describe("controlDocumentosParciales", () => {
  it("alerta si algún documento no quedó completo", () => {
    const r = controlDocumentosParciales(
      con({
        documentos: [
          {
            periodo: "2026-09-01",
            nombreArchivo: "anticipo - aguinaldo septiembre 2026.xlsx",
            estado: "parcial",
          },
          {
            periodo: "2026-09-01",
            nombreArchivo: "remuneracion RP.xlsx",
            estado: "ok",
          },
        ],
      }),
    );
    expect(r.estado).toBe("alerta");
    expect(r.detalle).toContain("aguinaldo");
  });

  it("ok si todos están completos", () => {
    const r = controlDocumentosParciales(
      con({
        documentos: [
          { periodo: "2026-09-01", nombreArchivo: "a.xlsx", estado: "ok" },
        ],
      }),
    );
    expect(r.estado).toBe("ok");
  });
});

describe("controlSaltoAguinaldo", () => {
  it("alerta sep-2026: el Anticipo casi no subió pese al aguinaldo (+2%)", () => {
    const r = controlSaltoAguinaldo(
      con({
        anticipoMensual: [
          { periodo: "2026-08-01", monto: 188_070_000, esReal: true },
          { periodo: "2026-09-01", monto: 192_516_000, esReal: true },
        ],
      }),
    );
    expect(r.estado).toBe("alerta");
    expect(r.detalle).toContain("Aguinaldo");
  });

  it("ok con el salto de sep-2025 (+42%)", () => {
    const r = controlSaltoAguinaldo(
      con({
        anticipoMensual: [
          { periodo: "2025-08-01", monto: 173_599_000, esReal: true },
          { periodo: "2025-09-01", monto: 246_051_324, esReal: true },
        ],
      }),
    );
    expect(r.estado).toBe("ok");
  });

  it("ignora meses proyectados (no real) y meses sin aguinaldo", () => {
    const r = controlSaltoAguinaldo(
      con({
        anticipoMensual: [
          { periodo: "2026-10-01", monto: 100, esReal: true },
          { periodo: "2026-11-01", monto: 101, esReal: false },
          { periodo: "2026-12-01", monto: 102, esReal: false },
        ],
      }),
    );
    expect(r.estado).toBe("sin_datos");
  });
});

describe("controlSaltoBuk", () => {
  it("alerta la caída real 24→29-sep: 916 → 828 (−9,6%)", () => {
    const r = controlSaltoBuk(
      con({
        buk: {
          anterior: { fecha: "2026-09-24", total: 916 },
          ultima: { fecha: "2026-09-29", total: 828 },
        },
      }),
    );
    expect(r.estado).toBe("alerta");
    expect(r.detalle).toContain("-9.6%");
  });

  it("ok con variación menor a 5%", () => {
    const r = controlSaltoBuk(
      con({
        buk: {
          anterior: { fecha: "2026-09-21", total: 913 },
          ultima: { fecha: "2026-09-23", total: 917 },
        },
      }),
    );
    expect(r.estado).toBe("ok");
  });

  it("no compara lecturas separadas por más de 14 días", () => {
    const r = controlSaltoBuk(
      con({
        buk: {
          anterior: { fecha: "2026-08-25", total: 884 },
          ultima: { fecha: "2026-09-24", total: 916 },
        },
      }),
    );
    expect(r.estado).toBe("sin_datos");
  });

  it("sin datos con menos de dos lecturas", () => {
    expect(controlSaltoBuk(VACIO).estado).toBe("sin_datos");
  });
});

describe("controlBonoEneroJulio", () => {
  it("ok cuando enero y julio proyectados incluyen el evento", () => {
    const r = controlBonoEneroJulio(
      con({
        remuneracionProyectada: [
          {
            periodo: "2027-01-01",
            metodo: "costo_por_cabeza_x_dotacion_mas_eventos",
            esReal: false,
          },
          {
            periodo: "2027-02-01",
            metodo: "costo_por_cabeza_x_dotacion",
            esReal: false,
          },
          {
            periodo: "2027-07-01",
            metodo: "costo_por_cabeza_x_dotacion_mas_eventos",
            esReal: false,
          },
        ],
      }),
    );
    expect(r.estado).toBe("ok");
  });

  it("alerta cuando julio proyectado no trae el bono", () => {
    const r = controlBonoEneroJulio(
      con({
        remuneracionProyectada: [
          {
            periodo: "2027-07-01",
            metodo: "costo_por_cabeza_x_dotacion",
            esReal: false,
          },
        ],
      }),
    );
    expect(r.estado).toBe("alerta");
    expect(r.detalle).toContain("2027-07");
  });
});

describe("evaluarControles", () => {
  it("devuelve los 6 controles en orden", () => {
    expect(evaluarControles(VACIO).map((r) => r.id)).toEqual([
      "anticipo_vs_dotacion",
      "suma_obras",
      "documentos_parciales",
      "salto_aguinaldo",
      "salto_buk",
      "bono_enero_julio",
    ]);
  });
});
