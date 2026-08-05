import { describe, expect, it } from "vitest";
import { periodoDeFecha, sumarMesesAPeriodo } from "./periodo";

describe("periodoDeFecha", () => {
  it("normaliza cualquier día del mes al día 1", () => {
    expect(periodoDeFecha("2026-08-15")).toBe("2026-08-01");
    expect(periodoDeFecha("2026-08-31")).toBe("2026-08-01");
    expect(periodoDeFecha("2026-08-01")).toBe("2026-08-01");
  });
});

describe("sumarMesesAPeriodo", () => {
  it("suma meses dentro del mismo año", () => {
    expect(sumarMesesAPeriodo("2026-08-01", 1)).toBe("2026-09-01");
    expect(sumarMesesAPeriodo("2026-08-01", 4)).toBe("2026-12-01");
  });
  it("cruza el límite de año hacia adelante", () => {
    expect(sumarMesesAPeriodo("2026-12-01", 1)).toBe("2027-01-01");
    expect(sumarMesesAPeriodo("2026-08-01", 12)).toBe("2027-08-01");
  });
  it("resta meses (n negativo), incluyendo cruce de año hacia atrás", () => {
    expect(sumarMesesAPeriodo("2026-08-01", -1)).toBe("2026-07-01");
    expect(sumarMesesAPeriodo("2026-01-01", -1)).toBe("2025-12-01");
  });
  it("n=0 devuelve el mismo período", () => {
    expect(sumarMesesAPeriodo("2026-08-01", 0)).toBe("2026-08-01");
  });
});
