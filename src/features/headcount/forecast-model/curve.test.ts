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
  it("promedia mes a mes ignorando nulls, marca sinDatoReferencia=false cuando hay señal", () => {
    const curvas = [
      [10, 20, null],
      [30, null, 50],
    ];
    const resultado = promediarCurvas(curvas, 3);
    expect(resultado).toEqual([
      { valor: 20, sinDatoReferencia: false },
      { valor: 20, sinDatoReferencia: false },
      { valor: 50, sinDatoReferencia: false },
    ]);
  });

  it("mes sin ninguna señal da valor=0 Y sinDatoReferencia=true (no confundir con 0 confirmado)", () => {
    const curvas = [
      [null, 10],
      [null, 20],
    ];
    const resultado = promediarCurvas(curvas, 2);
    expect(resultado[0]).toEqual({ valor: 0, sinDatoReferencia: true });
    expect(resultado[1]).toEqual({ valor: 15, sinDatoReferencia: false });
  });

  it("sin curvas de referencia, todo el resultado es sin dato", () => {
    expect(promediarCurvas([], 3)).toEqual([
      { valor: 0, sinDatoReferencia: true },
      { valor: 0, sinDatoReferencia: true },
      { valor: 0, sinDatoReferencia: true },
    ]);
  });
});

describe("aVariacionNeta", () => {
  const conDato = (valor: number) => ({ valor, sinDatoReferencia: false });
  const sinDato = (valor = 0) => ({ valor, sinDatoReferencia: true });

  it("el primer mes es su propio valor absoluto", () => {
    expect(
      aVariacionNeta([conDato(5), conDato(8), conDato(12)])[0].variacion,
    ).toBe(5);
  });

  it("los meses siguientes son la diferencia con el mes anterior", () => {
    const resultado = aVariacionNeta([conDato(5), conDato(8), conDato(12)]);
    expect(resultado.map((r) => r.variacion)).toEqual([5, 3, 4]);
    expect(resultado.every((r) => !r.sinDatoReferencia)).toBe(true);
  });

  it("una curva plana da variación 0 después del primer mes", () => {
    expect(
      aVariacionNeta([conDato(10), conDato(10), conDato(10)]).map(
        (r) => r.variacion,
      ),
    ).toEqual([10, 0, 0]);
  });

  it("una curva decreciente da variaciones negativas", () => {
    expect(
      aVariacionNeta([conDato(20), conDato(15), conDato(10)]).map(
        (r) => r.variacion,
      ),
    ).toEqual([20, -5, -5]);
  });

  it("un delta hereda sinDatoReferencia=true si CUALQUIERA de sus 2 puntos no tenía dato real", () => {
    const resultado = aVariacionNeta([conDato(10), sinDato(0), conDato(15)]);
    expect(resultado[0].sinDatoReferencia).toBe(false);
    expect(resultado[1].sinDatoReferencia).toBe(true); // depende de mes 0 (con dato) y mes 1 (sin dato)
    expect(resultado[2].sinDatoReferencia).toBe(true); // depende de mes 1 (sin dato) y mes 2 (con dato)
  });
});
