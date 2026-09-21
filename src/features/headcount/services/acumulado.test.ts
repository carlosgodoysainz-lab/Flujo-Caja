import { describe, expect, it } from "vitest";
import {
  recalcularAcumuladosObra,
  type FilaHeadcountExistente,
} from "./acumulado";

function fila(
  periodo: string,
  variacionNeta: number,
  acumulado: number | null,
  origen = "buk_real",
): FilaHeadcountExistente {
  return { periodo, variacionNeta, acumulado, origen, forecastRunId: null };
}

describe("recalcularAcumuladosObra", () => {
  it("sin ediciones, no devuelve nada que escribir", () => {
    const resultado = recalcularAcumuladosObra(
      [fila("2026-05-01", 10, 100)],
      new Map(),
      0,
    );
    expect(resultado).toEqual({ filas: [], advertencia: null });
  });

  it("ancla al acumulado del mes ANTERIOR, no al saldo de hoy", () => {
    // Obra con acumulado 100 en mayo; edición en junio. El acumulado de
    // junio debe salir de 100 + variación editada, NUNCA del saldo
    // "de hoy" (que acá sería 9999 si el bug siguiera vivo).
    const existentes = [fila("2026-05-01", 3, 100)];
    const resultado = recalcularAcumuladosObra(
      existentes,
      new Map([["2026-06-01", 8]]),
      9999,
    );
    expect(resultado.advertencia).toBeNull();
    expect(resultado.filas).toEqual([
      {
        periodo: "2026-06-01",
        variacionNeta: 8,
        acumulado: 108,
        esEdicion: true,
      },
    ]);
  });

  it("meses no contiguos: editar ene y mar SÍ incluye la variación de feb", () => {
    const existentes = [
      fila("2025-12-01", 0, 50),
      fila("2026-02-01", -3, null, "modelo_estimado"), // feb, no editado
    ];
    const resultado = recalcularAcumuladosObra(
      existentes,
      new Map([
        ["2026-01-01", 10],
        ["2026-03-01", 5],
      ]),
      0,
    );
    // dic=50 (ancla) -> ene(+10, manual)=60 -> feb(-3, existente)=57 -> mar(+5, manual)=62
    expect(resultado.filas).toEqual([
      {
        periodo: "2026-01-01",
        variacionNeta: 10,
        acumulado: 60,
        esEdicion: true,
      },
      {
        periodo: "2026-02-01",
        variacionNeta: -3,
        acumulado: 57,
        esEdicion: false,
      },
      {
        periodo: "2026-03-01",
        variacionNeta: 5,
        acumulado: 62,
        esEdicion: true,
      },
    ]);
  });

  it("edición en el primer mes de la obra (sin fila previa) usa el saldo inicial de referencia", () => {
    const resultado = recalcularAcumuladosObra(
      [],
      new Map([["2026-05-01", 12]]),
      0,
    );
    expect(resultado.advertencia).toBeNull();
    expect(resultado.filas).toEqual([
      {
        periodo: "2026-05-01",
        variacionNeta: 12,
        acumulado: 12,
        esEdicion: true,
      },
    ]);
  });

  it("hay historial pero con un hueco justo antes del período editado: avisa y usa el fallback", () => {
    const existentes = [fila("2026-01-01", 5, 40)]; // no hay fila de 2026-04-01
    const resultado = recalcularAcumuladosObra(
      existentes,
      new Map([["2026-05-01", 7]]),
      0,
    );
    expect(resultado.advertencia).toContain("2026-04-01");
    expect(resultado.filas).toEqual([
      {
        periodo: "2026-05-01",
        variacionNeta: 7,
        acumulado: 7,
        esEdicion: true,
      },
    ]);
  });

  it("edición en un mes intermedio recalcula todos los meses posteriores existentes, sin convertirlos en edición", () => {
    const existentes = [
      fila("2026-05-01", 0, 100),
      fila("2026-06-01", 10, 110, "modelo_estimado"),
      fila("2026-07-01", -4, 106, "buk_real"),
    ];
    // El usuario corrige mayo (0 -> 20). Junio y julio deben re-encadenarse
    // desde el nuevo acumulado de mayo, conservando su propia variación.
    const resultado = recalcularAcumuladosObra(
      existentes,
      new Map([["2026-05-01", 20]]),
      0,
    );
    expect(resultado.filas).toEqual([
      {
        periodo: "2026-05-01",
        variacionNeta: 20,
        acumulado: 120,
        esEdicion: true,
      },
      {
        periodo: "2026-06-01",
        variacionNeta: 10,
        acumulado: 130,
        esEdicion: false,
      },
      {
        periodo: "2026-07-01",
        variacionNeta: -4,
        acumulado: 126,
        esEdicion: false,
      },
    ]);
  });

  it("piso físico: el encadenamiento nunca queda negativo", () => {
    const resultado = recalcularAcumuladosObra(
      [fila("2026-05-01", 0, 5)],
      new Map([["2026-06-01", -40]]),
      0,
    );
    expect(resultado.filas).toEqual([
      {
        periodo: "2026-06-01",
        variacionNeta: -40,
        acumulado: 0,
        esEdicion: true,
      },
    ]);
  });

  it("obra sin ninguna fila previa y sin snapshot: ancla en el fallback (0) sin advertencia", () => {
    const resultado = recalcularAcumuladosObra(
      [],
      new Map([["2026-05-01", 0]]),
      0,
    );
    expect(resultado.advertencia).toBeNull();
    expect(resultado.filas).toEqual([
      {
        periodo: "2026-05-01",
        variacionNeta: 0,
        acumulado: 0,
        esEdicion: true,
      },
    ]);
  });
});
