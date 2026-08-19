import { describe, expect, it } from "vitest";
import { overrideSchema } from "./override-schema";

describe("overrideSchema", () => {
  it("acepta un override válido de un concepto real", () => {
    const result = overrideSchema.safeParse({
      periodo: new Date(2026, 6, 1),
      concepto: "sence",
      monto: 42_000_000,
    });
    expect(result.success).toBe(true);
  });

  it("acepta cada uno de los 6 conceptos overrideables", () => {
    const conceptos = [
      "anticipo",
      "remuneracion",
      "finiquito",
      "reliquidacion",
      "cotizacion",
      "sence",
    ];
    for (const concepto of conceptos) {
      const result = overrideSchema.safeParse({
        periodo: new Date(2026, 6, 1),
        concepto,
        monto: 1_000_000,
      });
      expect(result.success).toBe(true);
    }
  });

  it("rechaza 'total_nomina' — hallazgo real de /temple: nunca debe ser overrideable, siempre es la suma calculada", () => {
    const result = overrideSchema.safeParse({
      periodo: new Date(2026, 6, 1),
      concepto: "total_nomina",
      monto: 1_000_000,
    });
    expect(result.success).toBe(false);
  });

  it("rechaza un concepto inexistente", () => {
    const result = overrideSchema.safeParse({
      periodo: new Date(2026, 6, 1),
      concepto: "concepto_inventado",
      monto: 1_000_000,
    });
    expect(result.success).toBe(false);
  });

  it("rechaza monto NaN — antes solo se validaba en el cliente, evitable llamando la Server Action directo", () => {
    const result = overrideSchema.safeParse({
      periodo: new Date(2026, 6, 1),
      concepto: "sence",
      monto: NaN,
    });
    expect(result.success).toBe(false);
  });

  it("rechaza monto Infinity", () => {
    const result = overrideSchema.safeParse({
      periodo: new Date(2026, 6, 1),
      concepto: "sence",
      monto: Infinity,
    });
    expect(result.success).toBe(false);
  });

  it("acepta monto negativo (una corrección/reverso es un caso de negocio válido, no se restringe el signo)", () => {
    const result = overrideSchema.safeParse({
      periodo: new Date(2026, 6, 1),
      concepto: "reliquidacion",
      monto: -500_000,
    });
    expect(result.success).toBe(true);
  });

  it("rechaza un periodo que no es Date", () => {
    const result = overrideSchema.safeParse({
      periodo: "2026-07-01",
      concepto: "sence",
      monto: 1_000_000,
    });
    expect(result.success).toBe(false);
  });
});
