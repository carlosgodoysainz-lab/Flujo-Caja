/**
 * Parser del "Comprobante de Pago Único de Aportes Previsionales" de
 * Previred — la carpeta real "Pagos Mensuales/imposiciones/imposiciones
 * <mes> <año>/" trae un PDF por empresa (uno por RG y otro por RP,
 * "comprobante previred <Empresa> <RG|RP>.pdf") con el TOTAL ya
 * calculado y confirmado por Previred.
 *
 * Se lee el TOTAL directo del comprobante en vez de parsear el layout
 * crudo Previred (~70 columnas por trabajador) — ese layout requeriría
 * adivinar exactamente qué campos numéricos sumar para "cotización"
 * (AFP + salud + seguro de cesantía + mutual + ...), riesgo real para
 * un dato financiero. El comprobante es la fuente de verdad oficial:
 * "TOTAL GENERAL" y "TOTAL A PAGAR" aparecen 2 veces en el mismo
 * documento — se usan como cross-check mutuo, si no coinciden se
 * reporta error en vez de adivinar cuál es el correcto.
 *
 * Formato real confirmado (comprobante de agosto-2026, texto extraído
 * vía unpdf): "PERIODO DE PAGO   2026/06 ... TOTAL GENERAL   $
 * 9.885.783 ... RESUMEN DEL PAGO  TOTAL A PAGAR   $ 9.885.783".
 */

export interface ComprobantePreviredParseado {
  estado: "ok";
  /** Primer día del mes de pago (YYYY-MM-01). */
  periodo: Date;
  montoTotal: number;
  /** Nombre o razón social de la empresa — solo para logs/auditoría, no es dato de persona. */
  empresa: string | null;
}

export interface ComprobantePreviredError {
  estado: "error";
  motivo: string;
}

function parseMontoCLP(raw: string): number {
  // Formato chileno: puntos como separador de miles, sin decimales en
  // este documento (montos previsionales siempre son pesos enteros).
  return Number(raw.replace(/\./g, "").trim());
}

export function parseComprobantePrevired(
  texto: string,
): ComprobantePreviredParseado | ComprobantePreviredError {
  const periodoMatch = texto.match(/PERIODO DE PAGO\s+(\d{4})\/(\d{2})/);
  if (!periodoMatch) {
    return {
      estado: "error",
      motivo: "No se encontró 'PERIODO DE PAGO' en el comprobante.",
    };
  }
  const anio = Number(periodoMatch[1]);
  const mes = Number(periodoMatch[2]);
  if (mes < 1 || mes > 12) {
    return {
      estado: "error",
      motivo: `Mes de pago inválido en el comprobante: "${periodoMatch[2]}".`,
    };
  }

  const totalGeneralMatch = texto.match(/TOTAL GENERAL\s+\$\s*([\d.]+)/);
  if (!totalGeneralMatch) {
    return {
      estado: "error",
      motivo: "No se encontró 'TOTAL GENERAL' en el comprobante.",
    };
  }
  const montoTotal = parseMontoCLP(totalGeneralMatch[1]);
  if (!Number.isFinite(montoTotal) || montoTotal <= 0) {
    return {
      estado: "error",
      motivo: `Monto TOTAL GENERAL no es un número válido: "${totalGeneralMatch[1]}".`,
    };
  }

  // Cross-check: "TOTAL A PAGAR" aparece de nuevo en la sección
  // "RESUMEN DEL PAGO" del mismo comprobante — debe coincidir EXACTO
  // con "TOTAL GENERAL". Si no coincide, algo se leyó mal (ej. un PDF
  // con 2 comprobantes concatenados) — se reporta error en vez de
  // arriesgar un monto financiero incorrecto.
  const totalAPagarMatch = texto.match(/TOTAL A PAGAR\s+\$\s*([\d.]+)/);
  if (totalAPagarMatch) {
    const montoAPagar = parseMontoCLP(totalAPagarMatch[1]);
    if (montoAPagar !== montoTotal) {
      return {
        estado: "error",
        motivo: `TOTAL GENERAL ($${montoTotal}) no coincide con TOTAL A PAGAR ($${montoAPagar}) en el mismo comprobante — no se puede confiar en el monto.`,
      };
    }
  }

  // Best-effort, no crítico — el texto extraído del PDF no siempre
  // conserva saltos de línea limpios, así que se acota hasta el
  // siguiente label conocido en vez de asumir un salto de línea real.
  const empresaMatch = texto.match(/NOMBRE O RAZON SOCIAL\s+(.+?)\s+DIRECCION/);

  return {
    estado: "ok",
    periodo: new Date(anio, mes - 1, 1),
    montoTotal,
    empresa: empresaMatch?.[1]?.trim() ?? null,
  };
}
