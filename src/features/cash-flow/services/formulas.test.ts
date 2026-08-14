import { describe, expect, it } from "vitest";
import {
  calcularAnticipoProyectado,
  calcularCotizacion,
  calcularReliquidacionProyectada,
  calcularRemuneracionProyectada,
} from "./formulas";

describe("calcularAnticipoProyectado", () => {
  it("es exactamente 24% de la remuneración", () => {
    expect(calcularAnticipoProyectado(100_000_000)).toBe(24_000_000);
  });
  it("remuneración cero da anticipo cero", () => {
    expect(calcularAnticipoProyectado(0)).toBe(0);
  });
});

describe("calcularReliquidacionProyectada", () => {
  it("es 1% de la remuneración", () => {
    expect(calcularReliquidacionProyectada(200_000_000)).toBe(2_000_000);
  });
});

describe("calcularCotizacion", () => {
  it("es 30% de (anticipo + remuneración + reliquidación)", () => {
    const anticipo = 5_000_000;
    const remuneracion = 100_000_000;
    const reliquidacion = 1_000_000;
    const esperado = Math.round(
      (anticipo + remuneracion + reliquidacion) * 0.3,
    );
    expect(calcularCotizacion(anticipo, remuneracion, reliquidacion)).toBe(
      esperado,
    );
  });
  it("con todo en cero, cotización es cero", () => {
    expect(calcularCotizacion(0, 0, 0)).toBe(0);
  });
});

describe("calcularRemuneracionProyectada", () => {
  it("es costo promedio por cabeza del mes anterior × dotación actual", () => {
    const result = calcularRemuneracionProyectada({
      costoPromedioPorCabezaMesAnterior: 1_000_000,
      dotacionActual: 250,
      fallbackPromedioHistorico: 999_999_999, // no debe usarse
    });
    expect(result.monto).toBe(250_000_000);
    expect(result.metodoCalculo).toBe("costo_por_cabeza_x_dotacion");
  });

  it("cae al fallback si no hay dato de dotación del mes anterior", () => {
    const result = calcularRemuneracionProyectada({
      costoPromedioPorCabezaMesAnterior: null,
      dotacionActual: 250,
      fallbackPromedioHistorico: 120_000_000,
    });
    expect(result.monto).toBe(120_000_000);
    expect(result.metodoCalculo).toBe("proyeccion_base_promedio_historico");
  });

  it("cae al fallback si no hay dotación actual", () => {
    const result = calcularRemuneracionProyectada({
      costoPromedioPorCabezaMesAnterior: 1_000_000,
      dotacionActual: null,
      fallbackPromedioHistorico: 120_000_000,
    });
    expect(result.monto).toBe(120_000_000);
    expect(result.metodoCalculo).toBe("proyeccion_base_promedio_historico");
  });
});
