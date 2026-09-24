import { describe, expect, it } from "vitest";
import {
  sumarVariacionPlanDelPeriodo,
  detectarObrasCerradasSinPlan,
  detectarObrasSinPlan,
  type PlanDotacionVariacion,
} from "./resolver-dotacion";

describe("sumarVariacionPlanDelPeriodo", () => {
  it("suma las variaciones de obras + Oficina Central de un período, ignora otros períodos", () => {
    const variaciones: PlanDotacionVariacion[] = [
      { obraId: "obra-1", periodo: "2026-10-01", variacionNeta: 10 },
      { obraId: "obra-2", periodo: "2026-10-01", variacionNeta: -3 },
      { obraId: null, periodo: "2026-10-01", variacionNeta: 1 },
      { obraId: "obra-1", periodo: "2026-11-01", variacionNeta: 99 },
    ];
    expect(sumarVariacionPlanDelPeriodo(variaciones, "2026-10-01")).toBe(8);
  });

  it("0 si no hay ninguna fila para ese período", () => {
    expect(sumarVariacionPlanDelPeriodo([], "2026-10-01")).toBe(0);
  });
});

describe("detectarObrasCerradasSinPlan", () => {
  it("alerta una obra vencida, con dotación real > 0 y sin plan cargado", () => {
    const alertas = detectarObrasCerradasSinPlan({
      obras: [{ id: "obra-1", nombre: "Jorge Edwards", finObra: "2026-08-01" }],
      variaciones: [],
      dotacionRealPorObra: new Map([["obra-1", 33]]),
      hoyStr: "2026-09-24",
    });
    expect(alertas).toEqual([
      {
        obraId: "obra-1",
        obraNombre: "Jorge Edwards",
        finObra: "2026-08-01",
        dotacionActual: 33,
      },
    ]);
  });

  it("no alerta si la obra ya tiene plan cargado (aunque sea 0)", () => {
    const alertas = detectarObrasCerradasSinPlan({
      obras: [{ id: "obra-1", nombre: "Jorge Edwards", finObra: "2026-08-01" }],
      variaciones: [
        { obraId: "obra-1", periodo: "2026-09-01", variacionNeta: 0 },
      ],
      dotacionRealPorObra: new Map([["obra-1", 33]]),
      hoyStr: "2026-09-24",
    });
    expect(alertas).toEqual([]);
  });

  it("no alerta si la dotación real ya es 0", () => {
    const alertas = detectarObrasCerradasSinPlan({
      obras: [{ id: "obra-1", nombre: "Jorge Edwards", finObra: "2026-08-01" }],
      variaciones: [],
      dotacionRealPorObra: new Map([["obra-1", 0]]),
      hoyStr: "2026-09-24",
    });
    expect(alertas).toEqual([]);
  });

  it("no alerta obras cuya fecha de término todavía no llega", () => {
    const alertas = detectarObrasCerradasSinPlan({
      obras: [
        { id: "obra-1", nombre: "Vista Llacolén A", finObra: "2028-07-22" },
      ],
      variaciones: [],
      dotacionRealPorObra: new Map([["obra-1", 50]]),
      hoyStr: "2026-09-24",
    });
    expect(alertas).toEqual([]);
  });

  it("no alerta obras sin fecha de término cargada", () => {
    const alertas = detectarObrasCerradasSinPlan({
      obras: [{ id: "obra-1", nombre: "Sin fecha", finObra: null }],
      variaciones: [],
      dotacionRealPorObra: new Map([["obra-1", 50]]),
      hoyStr: "2026-09-24",
    });
    expect(alertas).toEqual([]);
  });
});

describe("detectarObrasSinPlan", () => {
  it("lista obras vigentes sin ninguna fila de plan", () => {
    const sinPlan = detectarObrasSinPlan({
      obras: [
        { id: "obra-1", nombre: "Con plan", finObra: "2028-01-01" },
        { id: "obra-2", nombre: "Sin plan", finObra: "2028-01-01" },
      ],
      variaciones: [
        { obraId: "obra-1", periodo: "2026-10-01", variacionNeta: 5 },
      ],
      hoyStr: "2026-09-24",
    });
    expect(sinPlan.map((o) => o.id)).toEqual(["obra-2"]);
  });

  it("no lista obras ya vencidas (esas las cubre detectarObrasCerradasSinPlan)", () => {
    const sinPlan = detectarObrasSinPlan({
      obras: [{ id: "obra-1", nombre: "Vencida", finObra: "2026-01-01" }],
      variaciones: [],
      hoyStr: "2026-09-24",
    });
    expect(sinPlan).toEqual([]);
  });
});
