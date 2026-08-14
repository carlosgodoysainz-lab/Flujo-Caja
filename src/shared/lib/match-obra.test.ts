import { describe, expect, it } from "vitest";
import { matchObraByName } from "./match-obra";

const OBRAS = [
  { id: "1", nombre: "Lira I" },
  { id: "2", nombre: "Lira II" },
  { id: "3", nombre: "Vista Llacolén" },
  { id: "4", nombre: "Lira III" },
  { id: "5", nombre: "Serrano A" },
];

describe("matchObraByName", () => {
  it("matchea quitando el prefijo 'Obra '", () => {
    expect(matchObraByName("Obra Lira I", OBRAS)?.id).toBe("1");
  });

  it("no confunde Lira I con Lira II", () => {
    expect(matchObraByName("Obra Lira II", OBRAS)?.id).toBe("2");
  });

  it("retorna null si no hay ningún match razonable", () => {
    expect(matchObraByName("Oficina Central", OBRAS)).toBeNull();
  });

  it("matchea con acentos", () => {
    expect(matchObraByName("Obra Vista Llacolén", OBRAS)?.id).toBe("3");
  });

  it("texto vacío retorna null sin explotar", () => {
    expect(matchObraByName("", OBRAS)).toBeNull();
  });

  it("regresión: distingue las 3 obras 'Lira' correctamente (bug real detectado por el primer test)", () => {
    expect(matchObraByName("Obra Lira I", OBRAS)?.id).toBe("1");
    expect(matchObraByName("Obra Lira II", OBRAS)?.id).toBe("2");
    expect(matchObraByName("Obra Lira III", OBRAS)?.id).toBe("4");
  });

  it("regresión: alias manual conecta 'Obra Serrano Torre A' con 'Serrano A' (no comparten ninguna palabra, el match por palabra no los conecta)", () => {
    expect(matchObraByName("Obra Serrano Torre A", OBRAS)?.id).toBe("5");
  });
});
