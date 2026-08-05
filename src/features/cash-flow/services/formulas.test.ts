import { describe, expect, it } from "vitest";
import {
  calcularCotizacion,
  calcularFiniquitoProyectado,
  calcularReliquidacionProyectada,
  calcularSence,
} from "./formulas";

describe("calcularCotizacion", () => {
  it("es exactamente 24% de la remuneración", () => {
    expect(calcularCotizacion(100_000_000)).toBe(24_000_000);
  });
  it("redondea a entero", () => {
    expect(calcularCotizacion(1_000_003)).toBe(Math.round(1_000_003 * 0.24));
  });
  it("remuneración cero da cotización cero", () => {
    expect(calcularCotizacion(0)).toBe(0);
  });
});

describe("calcularSence", () => {
  it("es 8% de la remuneración más 30.000.000 fijo", () => {
    expect(calcularSence(100_000_000)).toBe(8_000_000 + 30_000_000);
  });
  it("con remuneración cero, queda solo el fijo de 30M", () => {
    expect(calcularSence(0)).toBe(30_000_000);
  });
});

describe("calcularReliquidacionProyectada", () => {
  it("es 1% de la remuneración", () => {
    expect(calcularReliquidacionProyectada(200_000_000)).toBe(2_000_000);
  });
});

describe("calcularFiniquitoProyectado", () => {
  it("es 30% de (remuneración + reliquidación + anticipo)", () => {
    const remuneracion = 100_000_000;
    const reliquidacion = 1_000_000;
    const anticipo = 5_000_000;
    const esperado = Math.round(
      (remuneracion + reliquidacion + anticipo) * 0.3,
    );
    expect(
      calcularFiniquitoProyectado(remuneracion, reliquidacion, anticipo),
    ).toBe(esperado);
  });
  it("con todo en cero, finiquito es cero", () => {
    expect(calcularFiniquitoProyectado(0, 0, 0)).toBe(0);
  });
});
