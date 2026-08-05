import { describe, expect, it } from "vitest";
import { calcularMesCashFlow } from "./engine";

describe("calcularMesCashFlow", () => {
  it("prioriza remuneración real sobre proyección cuando existe", () => {
    const result = calcularMesCashFlow({
      remuneracionReal: 150_000_000,
      reliquidacionReal: null,
      finiquitoReal: null,
      anticipoReal: null,
      remuneracionBaseParaProyeccion: 99_999_999, // no debe usarse
    });

    expect(result.remuneracion.monto).toBe(150_000_000);
    expect(result.remuneracion.esReal).toBe(true);
    expect(result.remuneracion.metodoCalculo).toBe("ingesta_real");
  });

  it("usa la base de proyección cuando no hay remuneración real", () => {
    const result = calcularMesCashFlow({
      remuneracionReal: null,
      reliquidacionReal: null,
      finiquitoReal: null,
      anticipoReal: null,
      remuneracionBaseParaProyeccion: 120_000_000,
    });

    expect(result.remuneracion.monto).toBe(120_000_000);
    expect(result.remuneracion.esReal).toBe(false);
  });

  it("reliquidación y finiquito reales tienen prioridad sobre la fórmula", () => {
    const result = calcularMesCashFlow({
      remuneracionReal: 100_000_000,
      reliquidacionReal: 5_000_000, // distinto al 1% que daría la fórmula (1M)
      finiquitoReal: 2_000_000,
      anticipoReal: null,
      remuneracionBaseParaProyeccion: 0,
    });

    expect(result.reliquidacion.monto).toBe(5_000_000);
    expect(result.reliquidacion.esReal).toBe(true);
    expect(result.finiquito.monto).toBe(2_000_000);
    expect(result.finiquito.esReal).toBe(true);
  });

  it("sin dato real de reliquidación, cae a la fórmula del 1% de remuneración", () => {
    const result = calcularMesCashFlow({
      remuneracionReal: 100_000_000,
      reliquidacionReal: null,
      finiquitoReal: null,
      anticipoReal: null,
      remuneracionBaseParaProyeccion: 0,
    });

    expect(result.reliquidacion.monto).toBe(1_000_000);
    expect(result.reliquidacion.esReal).toBe(false);
  });

  it("cotizaciones y SENCE siempre son fórmula, incluso con todo lo demás real", () => {
    const result = calcularMesCashFlow({
      remuneracionReal: 100_000_000,
      reliquidacionReal: 1_000_000,
      finiquitoReal: 500_000,
      anticipoReal: 2_000_000,
      remuneracionBaseParaProyeccion: 0,
    });

    expect(result.cotizacion.esReal).toBe(false);
    expect(result.cotizacion.monto).toBe(24_000_000);
    expect(result.sence.esReal).toBe(false);
    expect(result.sence.monto).toBe(8_000_000 + 30_000_000);
  });

  it("anticipo sin fuente real queda en 0, no en la fórmula (Fase 10 pendiente)", () => {
    const result = calcularMesCashFlow({
      remuneracionReal: 100_000_000,
      reliquidacionReal: null,
      finiquitoReal: null,
      anticipoReal: null,
      remuneracionBaseParaProyeccion: 0,
    });

    expect(result.anticipo.monto).toBe(0);
    expect(result.anticipo.esReal).toBe(false);
    expect(result.anticipo.metodoCalculo).toBe(
      "sin_fuente_automatizada_fase10",
    );
  });

  it("totalNomina es la suma exacta de los 6 conceptos", () => {
    const result = calcularMesCashFlow({
      remuneracionReal: 100_000_000,
      reliquidacionReal: 1_000_000,
      finiquitoReal: 500_000,
      anticipoReal: 2_000_000,
      remuneracionBaseParaProyeccion: 0,
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
      remuneracionReal: null,
      reliquidacionReal: null,
      finiquitoReal: null,
      anticipoReal: null,
      remuneracionBaseParaProyeccion: 100_000_000,
    });

    expect(result.totalNomina).toBeGreaterThan(result.remuneracion.monto);
    expect(Number.isFinite(result.totalNomina)).toBe(true);
  });
});
