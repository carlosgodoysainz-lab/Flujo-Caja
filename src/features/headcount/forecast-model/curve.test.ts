import { describe, expect, it } from "vitest";
import {
  aVariacionNeta,
  curvaPorAvance,
  curvaPorAvanceConFases,
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

describe("curvaPorAvanceConFases", () => {
  // Snapshots sintéticos: 22 meses de obra de referencia, valor = mes*10
  // (mes 0 -> 0, mes 1 -> 10, ..., mes 21 -> 210) para poder verificar
  // exactamente a qué mes del objetivo cae cada mes de referencia.
  const inicioObraRef = new Date(2024, 0, 1);
  const snapshots22Meses = Array.from({ length: 22 }, (_, mes) => ({
    fecha: new Date(2024, mes, 1),
    activos: mes * 10,
  }));

  it("con misma duración ref y objetivo, es idéntico a curvaPorAvance (identidad)", () => {
    const conFases = curvaPorAvanceConFases(
      snapshots22Meses,
      inicioObraRef,
      22,
      22,
    );
    const sinFases = curvaPorAvance(snapshots22Meses, inicioObraRef, 22);
    expect(conFases).toEqual(sinFases);
  });

  it("alinea el INICIO de la fase terminaciones de la referencia con el inicio de la fase terminaciones del objetivo, aunque las duraciones difieran", () => {
    // Objetivo de 12 meses: mitad = mes 6 (ceil(12/2)) es el primer mes de
    // terminaciones. En la referencia (22 meses), el primer mes de
    // terminaciones es el mes 11 (ceil(22/2)), con valor 110.
    const curva = curvaPorAvanceConFases(
      snapshots22Meses,
      inicioObraRef,
      22,
      12,
    );
    expect(curva[0]).toBe(0); // primer mes de obra gruesa de ambas, sin reescalar
    expect(curva[6]).toBe(110); // primer mes de terminaciones -> primer mes de terminaciones
    // Los últimos 2 meses de la referencia (20 y 21, valores 200 y 210)
    // también colapsan en el último mes del objetivo por la compresión de
    // fase — se promedian, igual que el caso del mes 5 (ver test siguiente).
    expect(curva[11]).toBe(205);
  });

  it("si la compresión de fases hace caer 2 meses de referencia en el mismo mes objetivo, los promedia en vez de pisar el primero", () => {
    const curva = curvaPorAvanceConFases(
      snapshots22Meses,
      inicioObraRef,
      22,
      12,
    );
    // mes 9 (valor 90) y mes 10 (valor 100) de la referencia caen ambos en
    // el índice 5 del objetivo tras la compresión de la fase terminaciones.
    expect(curva[5]).toBe(95);
  });

  it("sin duración de referencia (0), no divide por cero — todo cae en el mes 0", () => {
    const curva = curvaPorAvanceConFases([], inicioObraRef, 0, 12);
    expect(curva.length).toBe(12);
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
