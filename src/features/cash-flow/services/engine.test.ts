import { describe, expect, it } from "vitest";
import { calcularMesCashFlow, type CashFlowInputs } from "./engine";

const BASE: CashFlowInputs = {
  remuneracionReal: null,
  reliquidacionReal: null,
  finiquitoReal: null,
  anticipoReal: null,
  senceManual: null,
  senceFallbackProyectado: 0,
  costoPromedioPorCabezaMesAnterior: null,
  dotacionActual: null,
  remuneracionFallbackPromedioHistorico: 0,
  finiquitoFallbackPromedio6m: 0,
};

describe("calcularMesCashFlow", () => {
  it("prioriza remuneración real sobre proyección cuando existe", () => {
    const result = calcularMesCashFlow({
      ...BASE,
      remuneracionReal: 150_000_000,
      remuneracionFallbackPromedioHistorico: 99_999_999, // no debe usarse
    });

    expect(result.remuneracion.monto).toBe(150_000_000);
    expect(result.remuneracion.esReal).toBe(true);
    expect(result.remuneracion.metodoCalculo).toBe("ingesta_real");
  });

  it("proyecta remuneración con el modelo costo-por-cabeza × dotación cuando hay dato de dotación", () => {
    const result = calcularMesCashFlow({
      ...BASE,
      costoPromedioPorCabezaMesAnterior: 1_000_000,
      dotacionActual: 200,
      remuneracionFallbackPromedioHistorico: 999_999_999, // no debe usarse
    });

    expect(result.remuneracion.monto).toBe(200_000_000);
    expect(result.remuneracion.esReal).toBe(false);
    expect(result.remuneracion.metodoCalculo).toBe(
      "costo_por_cabeza_x_dotacion",
    );
  });

  it("usa el fallback de promedio histórico cuando no hay ni remuneración real ni dato de dotación", () => {
    const result = calcularMesCashFlow({
      ...BASE,
      remuneracionFallbackPromedioHistorico: 120_000_000,
    });

    expect(result.remuneracion.monto).toBe(120_000_000);
    expect(result.remuneracion.esReal).toBe(false);
    expect(result.remuneracion.metodoCalculo).toBe(
      "proyeccion_base_promedio_historico",
    );
  });

  it("reliquidación, finiquito y anticipo reales tienen prioridad sobre la fórmula", () => {
    const result = calcularMesCashFlow({
      ...BASE,
      remuneracionReal: 100_000_000,
      reliquidacionReal: 5_000_000, // distinto al 1% que daría la fórmula (1M)
      finiquitoReal: 2_000_000,
      anticipoReal: 3_000_000,
    });

    expect(result.reliquidacion.monto).toBe(5_000_000);
    expect(result.reliquidacion.esReal).toBe(true);
    expect(result.finiquito.monto).toBe(2_000_000);
    expect(result.finiquito.esReal).toBe(true);
    expect(result.anticipo.monto).toBe(3_000_000);
    expect(result.anticipo.esReal).toBe(true);
  });

  it("sin dato real de anticipo, cae a la fórmula del 24% de remuneración", () => {
    const result = calcularMesCashFlow({
      ...BASE,
      remuneracionReal: 100_000_000,
    });

    expect(result.anticipo.monto).toBe(24_000_000);
    expect(result.anticipo.esReal).toBe(false);
    expect(result.anticipo.metodoCalculo).toBe("formula_24pct_remuneracion");
  });

  it("sin dato real de reliquidación, cae a la fórmula del 1% de remuneración", () => {
    const result = calcularMesCashFlow({
      ...BASE,
      remuneracionReal: 100_000_000,
    });

    expect(result.reliquidacion.monto).toBe(1_000_000);
    expect(result.reliquidacion.esReal).toBe(false);
  });

  it("sin dato real de finiquito, cae al promedio de los últimos 6 meses reales (no a un %)", () => {
    const result = calcularMesCashFlow({
      ...BASE,
      remuneracionReal: 100_000_000,
      finiquitoFallbackPromedio6m: 3_500_000,
    });

    expect(result.finiquito.monto).toBe(3_500_000);
    expect(result.finiquito.esReal).toBe(false);
    expect(result.finiquito.metodoCalculo).toBe(
      "promedio_ultimos_6_meses_reales",
    );
  });

  it("cotización siempre es fórmula — 30% de (anticipo + remuneración + reliquidación)", () => {
    const result = calcularMesCashFlow({
      ...BASE,
      remuneracionReal: 100_000_000,
      reliquidacionReal: 1_000_000,
      finiquitoReal: 500_000,
      anticipoReal: 2_000_000,
    });

    const esperado = Math.round((2_000_000 + 100_000_000 + 1_000_000) * 0.3);
    expect(result.cotizacion.esReal).toBe(false);
    expect(result.cotizacion.monto).toBe(esperado);
  });

  it("SENCE sin override manual queda pendiente en 0, nunca se inventa por fórmula", () => {
    const result = calcularMesCashFlow({
      ...BASE,
      remuneracionReal: 100_000_000,
    });

    expect(result.sence.monto).toBe(0);
    expect(result.sence.esReal).toBe(false);
    expect(result.sence.metodoCalculo).toBe("pendiente_ingreso_manual");
  });

  it("SENCE con override manual se usa tal cual, marcado como real", () => {
    const result = calcularMesCashFlow({
      ...BASE,
      remuneracionReal: 100_000_000,
      senceManual: 42_000_000,
    });

    expect(result.sence.monto).toBe(42_000_000);
    expect(result.sence.esReal).toBe(true);
    expect(result.sence.metodoCalculo).toBe("manual_override");
  });

  it("SENCE sin manual pero con proyección anual (ej. junio) usa esa, sigue sin ser real", () => {
    const result = calcularMesCashFlow({
      ...BASE,
      remuneracionReal: 100_000_000,
      senceFallbackProyectado: 20_000_000,
    });

    expect(result.sence.monto).toBe(20_000_000);
    expect(result.sence.esReal).toBe(false);
    expect(result.sence.metodoCalculo).toBe("proyeccion_pago_anual");
  });

  it("el override manual tiene prioridad sobre la proyección anual", () => {
    const result = calcularMesCashFlow({
      ...BASE,
      remuneracionReal: 100_000_000,
      senceManual: 20_000_000,
      senceFallbackProyectado: 20_000_000,
    });

    expect(result.sence.esReal).toBe(true);
    expect(result.sence.metodoCalculo).toBe("manual_override");
  });

  it("totalNomina es la suma exacta de los 6 conceptos", () => {
    const result = calcularMesCashFlow({
      ...BASE,
      remuneracionReal: 100_000_000,
      reliquidacionReal: 1_000_000,
      finiquitoReal: 500_000,
      anticipoReal: 2_000_000,
      senceManual: 1_000_000,
    });

    const sumaManual =
      result.anticipo.monto +
      result.remuneracion.monto +
      result.finiquito.monto +
      result.reliquidacion.monto +
      result.cotizacion.monto +
      result.sence.monto;

    expect(result.totalNomina).toBe(sumaManual);
  });

  it("mes completamente sin datos (todo proyectado) no explota y da un total coherente", () => {
    const result = calcularMesCashFlow({
      ...BASE,
      remuneracionFallbackPromedioHistorico: 100_000_000,
    });

    expect(result.totalNomina).toBeGreaterThan(result.remuneracion.monto);
    expect(Number.isFinite(result.totalNomina)).toBe(true);
  });
});
