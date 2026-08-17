import { describe, expect, it } from "vitest";
import { parseComprobantePrevired } from "./comprobante-previred-parser";

// Fixture sintético (anonimizado) — misma ESTRUCTURA real del comprobante
// de Previred confirmada en vivo (17-ago-2026), pero con nombre/RUT de
// empresa y representante legal inventados. Nunca datos reales.
const TEXTO_COMPROBANTE_OK = `NUMERO DE CUPON  COMPROBANTE DE PAGO UNICO DE APORTES PREVISIONALES   202606066951-8  Fecha Emisión   04/07/2026  ANTECEDENTES DE LA EMPRESA  RUT EMPRESA   99.999.999-9   NOMBRE O RAZON SOCIAL   EMPRESA EJEMPLO SPA. DIRECCION   Av. Ejemplo N° 123   COMUNA   SANTIAGO CIUDAD   SANTIAGO   REGION   Región Metropolitana   TELEFONO   220000000   CODIGO POSTAL RUT REPRESENTANTE LEGAL   1.111.111-1   NOMBRE REPRESENTANTE LEGAL   NOMBRE EJEMPLO APELLIDO  ANTECEDENTES DEL PAGO  MODALIDAD DE PAGO   CHEQUE UNICO   N° INSTITUCIONES A PAGAR   5   PERIODO DE PAGO   2026/06  DETALLE DEL PAGO DE APORTES PREVISIONALES  NOMBRE DE INSTITUCIONES   MONTO A PAGAR ($)   N° DE FOLIO  AFP Capital   1.056.063   2008202606161410 Total AFP   1.056.063 ISAPRE Colmena   173.486   2024202606049223 Total ISAPRE   173.486 MUTUAL Mutual de Seguridad CChC   325.112   2081202606069996 Total MUTUAL   325.112 CCAF Los Andes   2.751.574   2061202606055496 Total CCAF   2.751.574 Seguro Social   272.481   2006260600703284 Total SEGURO SOCIAL   272.481  TOTAL GENERAL   $ 4.578.716  INSTRUCCIONES PARA PAGAR CUPÓN DE PAGO ...  RESUMEN DEL PAGO  TOTAL A PAGAR   $ 4.578.716  PAGO EN EFECTIVO PAGO CON CHEQUE`;

describe("parseComprobantePrevired", () => {
  it("extrae período y monto total de un comprobante real (fixture sintético)", () => {
    const resultado = parseComprobantePrevired(TEXTO_COMPROBANTE_OK);
    expect(resultado.estado).toBe("ok");
    if (resultado.estado !== "ok") return;
    expect(resultado.periodo).toEqual(new Date(2026, 5, 1)); // junio-2026
    expect(resultado.montoTotal).toBe(4_578_716);
    expect(resultado.empresa).toBe("EMPRESA EJEMPLO SPA.");
  });

  it("da error si no encuentra 'PERIODO DE PAGO'", () => {
    const resultado = parseComprobantePrevired(
      "un texto cualquiera sin ese label",
    );
    expect(resultado.estado).toBe("error");
  });

  it("da error si no encuentra 'TOTAL GENERAL'", () => {
    const resultado = parseComprobantePrevired(
      "PERIODO DE PAGO   2026/06  sin el resto",
    );
    expect(resultado.estado).toBe("error");
  });

  it("da error si 'TOTAL GENERAL' y 'TOTAL A PAGAR' no coinciden (posible lectura corrupta)", () => {
    const textoInconsistente = TEXTO_COMPROBANTE_OK.replace(
      "TOTAL A PAGAR   $ 4.578.716",
      "TOTAL A PAGAR   $ 9.999.999",
    );
    const resultado = parseComprobantePrevired(textoInconsistente);
    expect(resultado.estado).toBe("error");
    if (resultado.estado === "error") {
      expect(resultado.motivo).toContain("no coincide");
    }
  });

  it("da error si el monto no es un número válido", () => {
    const textoMontoInvalido = TEXTO_COMPROBANTE_OK.replace(
      "TOTAL GENERAL   $ 4.578.716",
      "TOTAL GENERAL   $ 0",
    ).replace("TOTAL A PAGAR   $ 4.578.716", "TOTAL A PAGAR   $ 0");
    const resultado = parseComprobantePrevired(textoMontoInvalido);
    expect(resultado.estado).toBe("error");
  });

  it("sigue extrayendo período y monto aunque no encuentre el nombre de la empresa", () => {
    const sinEmpresa = TEXTO_COMPROBANTE_OK.replace(
      "NOMBRE O RAZON SOCIAL   EMPRESA EJEMPLO SPA. DIRECCION",
      "",
    );
    const resultado = parseComprobantePrevired(sinEmpresa);
    expect(resultado.estado).toBe("ok");
    if (resultado.estado === "ok") {
      expect(resultado.empresa).toBeNull();
      expect(resultado.montoTotal).toBe(4_578_716);
    }
  });
});
