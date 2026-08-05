/**
 * Fórmulas de proyección migradas del Excel "Flujo de Caja" (hoja Detalle).
 * Confirmadas contra el archivo real durante la investigación inicial —
 * ver TECH-SPEC-flujo-caja-nomina.md §2.2 y §7.
 *
 * IMPORTANTE: estas son fórmulas de RESPALDO — se usan solo cuando no hay
 * dato real ingerido para el concepto/mes correspondiente (ver `engine.ts`).
 * Cuando existe un archivo real de SharePoint para ese mes, ese valor real
 * siempre tiene prioridad.
 */

export const COTIZACION_PCT = 0.24;
export const SENCE_PCT = 0.08;
export const SENCE_FIJO = 30_000_000;
export const RELIQUIDACION_PCT = 0.01;
export const FINIQUITO_PCT = 0.3;

function round(value: number): number {
  return Math.round(value);
}

/** Cotizaciones ≈ 24% de Remuneraciones. Siempre fórmula — no hay fuente real automatizada para este concepto. */
export function calcularCotizacion(remuneracion: number): number {
  return round(remuneracion * COTIZACION_PCT);
}

/** Aporte SENCE ≈ 8% de Remuneraciones + $30.000.000 fijo. Siempre fórmula. */
export function calcularSence(remuneracion: number): number {
  return round(remuneracion * SENCE_PCT + SENCE_FIJO);
}

/** Reliquidaciones proyectadas ≈ 1% de Remuneraciones (fallback cuando no hay dato real ingerido). */
export function calcularReliquidacionProyectada(remuneracion: number): number {
  return round(remuneracion * RELIQUIDACION_PCT);
}

/** Finiquitos proyectados ≈ 30% × (Remuneraciones + Reliquidaciones + Anticipo) (fallback). */
export function calcularFiniquitoProyectado(
  remuneracion: number,
  reliquidacion: number,
  anticipo: number,
): number {
  return round((remuneracion + reliquidacion + anticipo) * FINIQUITO_PCT);
}
