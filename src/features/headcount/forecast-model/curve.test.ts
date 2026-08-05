import { describe, expect, it } from "vitest";
import {
  aVariacionNeta,
  curvaPorAvance,
  escalarCurva,
  promediarCurvas,
} from "./curve";

describe("curvaPorAvance", () => {
  it("indexa por mes de avance desde el inicio de obra, no por fecha calendario", () => {
    const inicioObra = new Date(2024, 0, 1); // enero 2024
    const snapshots = [
      { fecha: new Date(2024, 0, 15), activos: 10 }, // mes 0
      { fecha: new Date(2024, 2, 1), activos: 30 }, // mes 2
    ];
    const curva = curvaPorAvance(snapshots, inicioObra, 6);
    expect(curva).toEqual([10, null, 30, null, null, null]);
  });

  it("ignora snapshots fuera del rango de duración de la obra", () => {
    const inicioObra = new Date(2024, 0, 1);
    const snapshots = [
      { fecha: new Date(2023, 5, 1), activos: 5 }, // antes del inicio -> ignorado
      { fecha: new Date(2026, 0, 1), activos: 5 }, // muy después de la duración -> ignorado
    ];
    const curva = curvaPorAvance(snapshots, inicioObra, 6);
    expect(curva.every((v) => v === null)).toBe(true);
  });
});

describe("escalarCurva", () => {
  it("escala proporcionalmente por la razón de unidades", () => {
    const curva = [10, 20, 30];
    // obra de referencia tenía 100 unidades, la objetivo tiene 200 -> el doble
    expect(escalarCurva(curva, 100, 200)).toEqual([20, 40, 60]);
  });

  it("preserva los null al escalar", () => {
    expect(escalarCurva([10, null, 30], 100, 50)).toEqual([5, null, 15]);
  });

  it("sin unidades de referencia, retorna la curva sin cambios (evita división por cero)", () => {
    expect(escalarCurva([10, 20], 0, 100)).toEqual([10, 20]);
  });
});

describe("promediarCurvas", () => {
  it("promedia mes a mes ignorando nulls", () => {
    const curvas = [
      [10, 20, null],
      [30, null, 50],
    ];
    expect(promediarCurvas(curvas, 3)).toEqual([20, 20, 50]);
  });

  it("mes sin ninguna señal da 0, no NaN ni null", () => {
    const curvas = [
      [null, 10],
      [null, 20],
    ];
    const resultado = promediarCurvas(curvas, 2);
    expect(resultado[0]).toBe(0);
    expect(Number.isFinite(resultado[0])).toBe(true);
  });

  it("sin curvas de referencia, todo el resultado es 0", () => {
    expect(promediarCurvas([], 3)).toEqual([0, 0, 0]);
  });
});

describe("aVariacionNeta", () => {
  it("el primer mes es su propio valor absoluto", () => {
    expect(aVariacionNeta([5, 8, 12])[0]).toBe(5);
  });

  it("los meses siguientes son la diferencia con el mes anterior", () => {
    expect(aVariacionNeta([5, 8, 12])).toEqual([5, 3, 4]);
  });

  it("una curva plana da variación 0 después del primer mes", () => {
    expect(aVariacionNeta([10, 10, 10])).toEqual([10, 0, 0]);
  });

  it("una curva decreciente da variaciones negativas", () => {
    expect(aVariacionNeta([20, 15, 10])).toEqual([20, -5, -5]);
  });
});
