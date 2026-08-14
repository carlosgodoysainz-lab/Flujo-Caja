import { describe, expect, it } from "vitest";
import { calcularMesCashFlow, type CashFlowInputs } from "./engine";

const SIN_BENEFICIOS = {
  monto: 0,
  esReal: false,
  metodoCalculo: "pendiente_ingreso_manual",
};

const BASE: CashFlowInputs = {
  remuneracionReal: null,
  reliquidacionReal: null,
  finiquitoReal: null,
  anticipoReal: null,
  senceManual: null,
  senceFallback: { monto: 0, metodoCalculo: "no_corresponde_pago_anual" },
  costoPromedioPorCabezaMesAnterior: null,
  dotacionActual: null,
  remuneracionFallbackPromedioHistorico: 0,
  finiquitoFallbackPromedio6m: 0,
  beneficiosRg: SIN_BENEFICIOS,
  beneficiosRp: SIN_BENEFICIOS,
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

  it("SENCE fuera del mes de pago (30-jun) da $0 SIN quedar 'pendiente' — es el valor correcto y final", () => {
    const result = calcularMesCashFlow({
      ...BASE,
      remuneracionReal: 100_000_000,
    });

    expect(result.sence.monto).toBe(0);
    expect(result.sence.esReal).toBe(false);
    expect(result.sence.metodoCalculo).toBe("no_corresponde_pago_anual");
  });

  it("SENCE en el mes de pago esperado pero sin UF sincronizada SÍ queda genuinamente pendiente", () => {
    const result = calcularMesCashFlow({
      ...BASE,
      remuneracionReal: 100_000_000,
      senceFallback: { monto: 0, metodoCalculo: "pendiente_ingreso_manual" },
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

  it("SENCE sin manual pero con proyección anual (500 UF convertidas) usa esa, sigue sin ser real", () => {
    const result = calcularMesCashFlow({
      ...BASE,
      remuneracionReal: 100_000_000,
      senceFallback: {
        monto: 20_000_000,
        metodoCalculo: "proyeccion_pago_anual",
      },
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
      senceFallback: {
        monto: 20_000_000,
        metodoCalculo: "proyeccion_pago_anual",
      },
    });

    expect(result.sence.esReal).toBe(true);
    expect(result.sence.metodoCalculo).toBe("manual_override");
  });

  it("totalNomina es la suma exacta de los 6 conceptos (Beneficios ya va implícito dentro de Remuneración)", () => {
    const result = calcularMesCashFlow({
      ...BASE,
      remuneracionReal: 100_000_000,
      reliquidacionReal: 1_000_000,
      finiquitoReal: 500_000,
      anticipoReal: 2_000_000,
      senceManual: 1_000_000,
      beneficiosRg: {
        monto: 3_000_000,
        esReal: true,
        metodoCalculo: "ingesta_real",
      },
    });

    const sumaManual =
      result.anticipo.monto +
      result.remuneracion.monto +
      result.finiquito.monto +
      result.reliquidacion.monto +
      result.cotizacion.monto +
      result.sence.monto;

    expect(result.totalNomina).toBe(sumaManual);
    // Beneficios se sumó DENTRO de remuneración (100M + 3M), no aparte.
    expect(result.remuneracion.monto).toBe(103_000_000);
  });

  it("Beneficios (RG+RP) se suman de forma implícita a Remuneración — no hay concepto ni fila aparte", () => {
    const result = calcularMesCashFlow({
      ...BASE,
      remuneracionReal: 100_000_000,
      reliquidacionReal: 1_000_000,
      anticipoReal: 2_000_000,
      beneficiosRg: {
        monto: 2_000_000,
        esReal: false,
        metodoCalculo: "formula_fecha_fija",
      },
      beneficiosRp: {
        monto: 500_000,
        esReal: false,
        metodoCalculo: "formula_fecha_fija",
      },
    });

    expect(result.remuneracion.monto).toBe(102_500_000);
    const resultSinTipos = result as unknown as Record<string, unknown>;
    expect(resultSinTipos.beneficiosTotal).toBeUndefined();
    expect(resultSinTipos.beneficiosRg).toBeUndefined();
    // Al ir implícito en Remuneración, Cotización (30% de Anticipo+Remun+Reliq)
    // ya lo incluye sin necesidad de un 4to sumando.
    const esperadoCotizacion = Math.round(
      (2_000_000 + 102_500_000 + 1_000_000) * 0.3,
    );
    expect(result.cotizacion.monto).toBe(esperadoCotizacion);
  });

  it("Remuneración conserva su propio esReal/metodoCalculo aunque se le sumen Beneficios", () => {
    const result = calcularMesCashFlow({
      ...BASE,
      remuneracionReal: 100_000_000,
      beneficiosRg: {
        monto: 10_360_000,
        esReal: true,
        metodoCalculo: "ingesta_real",
      },
    });

    expect(result.remuneracion.monto).toBe(110_360_000);
    expect(result.remuneracion.esReal).toBe(true);
    expect(result.remuneracion.metodoCalculo).toBe("ingesta_real");
  });

  it("sin remuneración real, Anticipo/Reliquidación formula usan la Remuneración YA con Beneficios sumados", () => {
    const result = calcularMesCashFlow({
      ...BASE,
      costoPromedioPorCabezaMesAnterior: 1_000_000,
      dotacionActual: 100, // remuneracionBase = 100.000.000
      beneficiosRg: {
        monto: 5_000_000,
        esReal: false,
        metodoCalculo: "formula_fecha_fija",
      },
    });

    expect(result.remuneracion.monto).toBe(105_000_000);
    expect(result.anticipo.monto).toBe(Math.round(105_000_000 * 0.24));
    expect(result.reliquidacion.monto).toBe(Math.round(105_000_000 * 0.01));
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
