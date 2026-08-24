/**
 * Fórmulas de proyección del modelo de flujo de caja de nómina —
 * REDEFINIDAS a partir de (a) las fórmulas reales confirmadas en el Excel
 * "Flujo de Caja" (`scripts/inspect-flujo-caja-formulas.ts`, estables en 7
 * meses distintos) y (b) la corrección explícita del usuario sobre la
 * metodología deseada, que en 2 conceptos difiere a propósito de lo que
 * hacía el Excel (ver TECH-SPEC §7 y Auto-Blindaje):
 *
 *   Concepto        | Excel real          | Metodología redefinida (usada acá)
 *   ----------------|----------------------|-------------------------------------
 *   Anticipo        | 24% × Remun. (RG)    | Igual, confirmado 2 veces (17-ago y 18-ago-2026) — el Anticipo es por
 *                                              naturaleza un adelanto de un % del sueldo de cada persona, no un
 *                                              costo fijo por cabeza (se evaluó un modelo costo-por-cabeza con
 *                                              dotación propia de Anticipo y se revirtió — ver Auto-Blindaje)
 *   Remuneración     | (prevMonto/prevHC)×HC | Igual — modelo costo-por-cabeza × dotación (ver dotacion-total.ts)
 *   Finiquito        | 7% × Remuneración    | Promedio de los ÚLTIMOS 6 MESES REALES (decisión explícita del usuario)
 *   Reliquidación    | 1% × Remuneración    | Igual (el usuario confirmó mantener la fórmula del Excel)
 *   Cotización       | 30% × (Rem+Reliq+Ant)| Igual, confirmado — Beneficios/Bonos (ver beneficios.ts) se suman de
 *                                              forma IMPLÍCITA dentro de Remuneración (no es un sumando aparte
 *                                              acá), así que ya quedan incluidos sin tocar esta fórmula
 *   Aporte SENCE     | siempre manual       | Igual — NUNCA fórmula, ver override.ts
 *
 * IMPORTANTE: estas son fórmulas de RESPALDO — se usan solo cuando no hay
 * dato real ingerido para el concepto/mes correspondiente (ver `engine.ts`).
 * Cuando existe un archivo real de SharePoint (o un override manual) para
 * ese mes, ese valor real siempre tiene prioridad.
 *
 * AUTO-APRENDIZAJE (24-ago-2026, pedido explícito del usuario): Anticipo,
 * Cotización y Reliquidación ya NO usan solo estos % fijos — `refresh.ts`
 * calcula, en cada "Actualizar reporte", el % REAL promedio de los
 * últimos meses reales (ver `pctSobreRemuneracionAprendido`/
 * `cotizacionPctAprendido` ahí) y lo pasa a `engine.ts` como el 2do
 * parámetro `pct` de cada función de abajo. Los % de ESTA constante solo
 * se usan como fallback final cuando todavía no hay suficiente historia
 * real (compañía/obra nueva) — nunca se editan a mano en el código.
 */

export const ANTICIPO_PCT = 0.24;
export const COTIZACION_PCT = 0.3;
export const RELIQUIDACION_PCT = 0.01;

function round(value: number): number {
  return Math.round(value);
}

/**
 * Anticipo proyectado ≈ % de Remuneración del mismo mes (fallback cuando
 * no hay dato real ingerido de la carpeta "Pagos Mensuales/Anticipo").
 * `pct` es el % aprendido de los últimos meses reales (ver `refresh.ts`);
 * si no hay historia real todavía, cae a `ANTICIPO_PCT` (24%, la misma
 * fórmula del Excel maestro de Finanzas para sus meses proyectados).
 * Se evaluó un modelo costo-por-cabeza × dotación PROPIA de Anticipo
 * (18-ago-2026) y se revirtió el mismo día: el Anticipo es por naturaleza
 * un adelanto de un % del SUELDO de cada persona (no un costo fijo por
 * cabeza como Remuneración o un Beneficio).
 */
export function calcularAnticipoProyectado(
  remuneracion: number,
  pct: number = ANTICIPO_PCT,
): number {
  return round(remuneracion * pct);
}

/**
 * Reliquidaciones proyectadas ≈ % de Remuneraciones del mismo mes
 * (fallback). `pct` es el % aprendido de los últimos meses reales (ver
 * `refresh.ts`); sin historia real todavía, cae a `RELIQUIDACION_PCT`
 * (1%, la fórmula original del Excel).
 */
export function calcularReliquidacionProyectada(
  remuneracion: number,
  pct: number = RELIQUIDACION_PCT,
): number {
  return round(remuneracion * pct);
}

/**
 * Cotizaciones ≈ % × (Anticipo + Remuneración + Reliquidación) del mismo
 * mes. Siempre fórmula — no hay fuente real automatizada para este
 * concepto cuando no hay comprobante Previred (ver `engine.ts`). `pct` es
 * el % aprendido de los últimos meses reales (ver `refresh.ts`); sin
 * historia real todavía, cae a `COTIZACION_PCT` (30%, la fórmula original
 * del Excel).
 *
 * Beneficios/Bonos (Convenio Lira Parque + Anexo Oficina Central, ver
 * beneficios.ts) NO son un 4to sumando acá — se suman de forma implícita
 * dentro de `remuneracion` (decisión explícita del usuario: "no quiero
 * que agregues estos como adicionales... se deben considerar de manera
 * implícita en las remuneraciones", 13-ago-2026) — por eso ya quedan
 * incluidos en la base sin tocar esta fórmula.
 */
export function calcularCotizacion(
  anticipo: number,
  remuneracion: number,
  reliquidacion: number,
  pct: number = COTIZACION_PCT,
): number {
  return round((anticipo + remuneracion + reliquidacion) * pct);
}

/**
 * Remuneración proyectada = costo promedio por cabeza del mes anterior ×
 * dotación del mes actual — el modelo "precio × cantidad" pedido
 * explícitamente por el usuario. `costoPromedioPorCabezaMesAnterior` viene
 * de dividir la Remuneración real (o ya proyectada) del mes anterior por
 * la dotación total de ese mismo mes anterior (ver `dotacion-total.ts`).
 * Si no hay dato de dotación disponible todavía (Buk histórico insuficiente
 * o la obra nueva no tiene curva de referencia), cae al fallback de
 * promedio histórico simple — degradación explícita, nunca un error duro.
 */
export function calcularRemuneracionProyectada(params: {
  costoPromedioPorCabezaMesAnterior: number | null;
  dotacionActual: number | null;
  fallbackPromedioHistorico: number;
}): { monto: number; metodoCalculo: string } {
  const {
    costoPromedioPorCabezaMesAnterior,
    dotacionActual,
    fallbackPromedioHistorico,
  } = params;
  if (costoPromedioPorCabezaMesAnterior != null && dotacionActual != null) {
    return {
      monto: round(costoPromedioPorCabezaMesAnterior * dotacionActual),
      metodoCalculo: "costo_por_cabeza_x_dotacion",
    };
  }
  return {
    monto: fallbackPromedioHistorico,
    metodoCalculo: "proyeccion_base_promedio_historico",
  };
}
