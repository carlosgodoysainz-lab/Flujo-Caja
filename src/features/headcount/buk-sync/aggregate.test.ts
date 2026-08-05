import { describe, expect, it } from "vitest";
import { agruparDotacion } from "./aggregate";
import type { BukEmpleadoMinimo } from "./client";

function emp(partial: Partial<BukEmpleadoMinimo>): BukEmpleadoMinimo {
  return {
    personId: "1",
    cargo: "Jornal",
    familiaCargo: "Obra",
    areaId: "100",
    activeSince: null,
    ...partial,
  };
}

describe("agruparDotacion", () => {
  const fechaSnapshot = new Date(2026, 6, 1); // julio 2026

  it("cuenta activos agrupados por cargo+area", () => {
    const empleados = [
      emp({ personId: "1", cargo: "Jornal", areaId: "100" }),
      emp({ personId: "2", cargo: "Jornal", areaId: "100" }),
      emp({ personId: "3", cargo: "Capataz", areaId: "100" }),
    ];
    const result = agruparDotacion(empleados, fechaSnapshot);

    const jornal = result.find(
      (r) => r.cargo === "Jornal" && r.areaId === "100",
    );
    expect(jornal?.activos).toBe(2);
    const capataz = result.find((r) => r.cargo === "Capataz");
    expect(capataz?.activos).toBe(1);
  });

  it("separa el mismo cargo en áreas distintas", () => {
    const empleados = [
      emp({ cargo: "Jornal", areaId: "100" }),
      emp({ cargo: "Jornal", areaId: "200" }),
    ];
    const result = agruparDotacion(empleados, fechaSnapshot);
    expect(result).toHaveLength(2);
  });

  it("cuenta altas solo si active_since es del mismo mes del snapshot", () => {
    const empleados = [
      emp({
        personId: "1",
        cargo: "Jornal",
        areaId: "100",
        activeSince: "2026-07-15",
      }), // alta este mes
      emp({
        personId: "2",
        cargo: "Jornal",
        areaId: "100",
        activeSince: "2026-01-01",
      }), // antiguo
    ];
    const result = agruparDotacion(empleados, fechaSnapshot);
    const jornal = result.find((r) => r.cargo === "Jornal");
    expect(jornal?.activos).toBe(2);
    expect(jornal?.altas).toBe(1);
  });

  it("cargo null se agrupa como 'Sin cargo', no se pierde el empleado", () => {
    const empleados = [emp({ cargo: null })];
    const result = agruparDotacion(empleados, fechaSnapshot);
    expect(result[0].cargo).toBe("Sin cargo");
    expect(result[0].activos).toBe(1);
  });

  it("bajas siempre es 0 (limitación documentada)", () => {
    const result = agruparDotacion([emp({})], fechaSnapshot);
    expect(result[0].bajas).toBe(0);
  });

  it("lista vacía no explota", () => {
    expect(agruparDotacion([], fechaSnapshot)).toEqual([]);
  });
});
