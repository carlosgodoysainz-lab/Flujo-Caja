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
 *   Anticipo        | 24% × Remun. (RG)    | Costo-por-cabeza × dotación PROPIA de Anticipo (rediseñado 18-ago-2026,
 *                                              ver `calcularAnticipoPorCabeza`); cae a 24% × Remuneración solo si no
 *                                              hay dotación de Anticipo disponible todavía
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
 */

export const ANTICIPO_PCT = 0.24;
export const COTIZACION_PCT = 0.3;
export const RELIQUIDACION_PCT = 0.01;

function round(value: number): number {
  return Math.round(value);
}

/** Anticipo proyectado ≈ 24% de Remuneración del mismo mes — último fallback cuando ni hay dato real ingerido ni dotación de Anticipo disponible (ver `calcularAnticipoPorCabeza`, el modelo primario desde 18-ago-2026). */
export function calcularAnticipoProyectado(remuneracion: number): number {
  return round(remuneracion * ANTICIPO_PCT);
}

/**
 * Anticipo proyectado = costo promedio por cabeza del mes anterior × la
 * dotación PROPIA de Anticipo del mes actual (NO la dotación de
 * Remuneración) — mismo modelo "precio × cantidad" que Remuneración, pero
 * con su propia "cantidad": bastante menos gente pide Anticipo que la que
 * recibe Remuneración completa (confirmado por el usuario viendo el Excel
 * real, 17-ago-2026). Pedido explícito del usuario 18-ago-2026: "para
 * efectos de la proyección de anticipos... la dotación se debe ir
 * proyectando por concepto". `costoPromedioAnticipoPorCabezaMesAnterior`
 * viene de dividir el Anticipo real (o ya proyectado) del mes anterior por
 * la dotación de Anticipo de ese mismo mes anterior (ver
 * `dotacionAnticipoDelMes` en `dotacion-total.ts`). Si no hay dotación de
 * Anticipo disponible todavía, cae al fallback de 24% × Remuneración
 * (`calcularAnticipoProyectado`) — degradación explícita, nunca un error
 * duro. Reliquidación queda SIN cambios (decisión explícita del usuario:
 * "No, solo Anticipo") — sigue en 1% × Remuneración.
 */
export function calcularAnticipoPorCabeza(params: {
  costoPromedioAnticipoPorCabezaMesAnterior: number | null;
  dotacionAnticipoActual: number | null;
  fallbackRemuneracion: number;
}): { monto: number; metodoCalculo: string } {
  const {
    costoPromedioAnticipoPorCabezaMesAnterior,
    dotacionAnticipoActual,
    fallbackRemuneracion,
  } = params;
  if (
    costoPromedioAnticipoPorCabezaMesAnterior != null &&
    dotacionAnticipoActual != null
  ) {
    return {
      monto: round(
        costoPromedioAnticipoPorCabezaMesAnterior * dotacionAnticipoActual,
      ),
      metodoCalculo: "costo_por_cabeza_x_dotacion_anticipo",
    };
  }
  return {
    monto: calcularAnticipoProyectado(fallbackRemuneracion),
    metodoCalculo: "formula_24pct_remuneracion",
  };
}

/** Reliquidaciones proyectadas ≈ 1% de Remuneraciones del mismo mes (fallback). Fórmula del Excel, confirmada por el usuario. */
export function calcularReliquidacionProyectada(remuneracion: number): number {
  return round(remuneracion * RELIQUIDACION_PCT);
}

/**
 * Cotizaciones ≈ 30% × (Anticipo + Remuneración + Reliquidación) del mismo
 * mes. Siempre fórmula — no hay fuente real automatizada para este
 * concepto (es un porcentaje legal relativamente estable, no requiere
 * ingesta de archivo).
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
): number {
  return round((anticipo + remuneracion + reliquidacion) * COTIZACION_PCT);
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
