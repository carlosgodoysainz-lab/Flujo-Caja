import { describe, expect, it } from "vitest";
import { obrasSimilares, type ObraParaSimilitud } from "./similarity";

const OBJETIVO: ObraParaSimilitud = {
  id: "obj",
  nombre: "Obra Objetivo",
  tipo: "Retail",
  unidades: 200,
  comuna: "Ñuñoa",
};

describe("obrasSimilares", () => {
  it("excluye obras de tipo distinto", () => {
    const historicas: ObraParaSimilitud[] = [
      { id: "1", nombre: "A", tipo: "DS19", unidades: 200, comuna: "Ñuñoa" },
      { id: "2", nombre: "B", tipo: "Retail", unidades: 200, comuna: "Ñuñoa" },
    ];
    const result = obrasSimilares(OBJETIVO, historicas);
    expect(result.map((o) => o.id)).toEqual(["2"]);
  });

  it("excluye obras fuera del rango ±30% de unidades", () => {
    const historicas: ObraParaSimilitud[] = [
      {
        id: "1",
        nombre: "Muy chica",
        tipo: "Retail",
        unidades: 50,
        comuna: "Ñuñoa",
      }, // 25% -> fuera
      {
        id: "2",
        nombre: "Similar",
        tipo: "Retail",
        unidades: 220,
        comuna: "Ñuñoa",
      }, // 110% -> dentro
      {
        id: "3",
        nombre: "Muy grande",
        tipo: "Retail",
        unidades: 400,
        comuna: "Ñuñoa",
      }, // 200% -> fuera
    ];
    const result = obrasSimilares(OBJETIVO, historicas);
    expect(result.map((o) => o.id)).toEqual(["2"]);
  });

  it("no descarta por unidades si algún lado no tiene el dato", () => {
    const historicas: ObraParaSimilitud[] = [
      {
        id: "1",
        nombre: "Sin unidades",
        tipo: "Retail",
        unidades: null,
        comuna: "Ñuñoa",
      },
    ];
    const result = obrasSimilares(OBJETIVO, historicas);
    expect(result).toHaveLength(1);
  });

  it("prioriza la misma comuna primero en el orden", () => {
    const historicas: ObraParaSimilitud[] = [
      {
        id: "1",
        nombre: "Otra comuna",
        tipo: "Retail",
        unidades: 200,
        comuna: "Maipú",
      },
      {
        id: "2",
        nombre: "Misma comuna",
        tipo: "Retail",
        unidades: 200,
        comuna: "Ñuñoa",
      },
    ];
    const result = obrasSimilares(OBJETIVO, historicas);
    expect(result[0].id).toBe("2");
  });

  it("nunca incluye la obra objetivo a sí misma", () => {
    const historicas: ObraParaSimilitud[] = [OBJETIVO];
    expect(obrasSimilares(OBJETIVO, historicas)).toHaveLength(0);
  });

  it("sin candidatas retorna lista vacía, no explota", () => {
    expect(obrasSimilares(OBJETIVO, [])).toEqual([]);
  });
});
