import { describe, expect, it } from "vitest";
import { contarBeneficiariosTransferenciaBancaria } from "./transferencia-bancaria-parser";

// Líneas SINTÉTICAS con el mismo formato de ancho fijo del archivo real
// (RUT + apellidos + nombre + dirección + cuenta + fecha + monto), pero
// con datos ficticios — nunca un RUT/nombre real.
const LINEA_1 =
  "111111111PEREZ           GONZALEZ       JUAN ANDRES    CALLE FICTICIA 123                                OTC0000000000001111111101200028082026000000000010000200000                              ";
const LINEA_2 =
  "222222222SOTO            MUNOZ          MARIA JOSE     AVENIDA INVENTADA 456                              OTC0000000000002222222201200028082026000000000010000350000                              ";

describe("contarBeneficiariosTransferenciaBancaria", () => {
  it("cuenta 1 línea válida como 1 beneficiario", () => {
    expect(contarBeneficiariosTransferenciaBancaria(LINEA_1)).toBe(1);
  });

  it("cuenta varias líneas válidas", () => {
    const texto = [LINEA_1, LINEA_2].join("\n");
    expect(contarBeneficiariosTransferenciaBancaria(texto)).toBe(2);
  });

  it("ignora líneas vacías (no las cuenta como beneficiario)", () => {
    const texto = [LINEA_1, "", "", LINEA_2, ""].join("\n");
    expect(contarBeneficiariosTransferenciaBancaria(texto)).toBe(2);
  });

  it("ignora una línea que no matchea el patrón (ej. encabezado inesperado)", () => {
    const texto = ["ENCABEZADO INESPERADO", LINEA_1].join("\n");
    expect(contarBeneficiariosTransferenciaBancaria(texto)).toBe(1);
  });

  it("texto vacío da 0 beneficiarios", () => {
    expect(contarBeneficiariosTransferenciaBancaria("")).toBe(0);
  });

  it("funciona con saltos de línea \\r\\n (Windows)", () => {
    const texto = `${LINEA_1}\r\n${LINEA_2}\r\n`;
    expect(contarBeneficiariosTransferenciaBancaria(texto)).toBe(2);
  });

  it("nunca extrae ni expone RUT/nombre — la función solo retorna un número", () => {
    const resultado = contarBeneficiariosTransferenciaBancaria(LINEA_1);
    expect(typeof resultado).toBe("number");
  });
});
