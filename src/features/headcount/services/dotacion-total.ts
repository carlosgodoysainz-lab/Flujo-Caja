import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { periodoDeFecha, sumarMesesAPeriodo } from "./periodo";

export interface DotacionTotalPunto {
  /** YYYY-MM-01 */
  periodo: string;
  total: number;
  esReal: boolean;
}

/**
 * Dotación TOTAL mensual de la compañía — la variable "Q" (cantidad) del
 * modelo de Remuneración (costo promedio por cabeza × dotación, ver
 * `formulas.ts`). Reconstruye la curva de "crece al inicio de cada obra,
 * decrece por desvinculaciones hacia el cierre" a nivel agregado:
 *
 * - Meses REALES: preferentemente `dotacion_mensual` (la columna "N°" del
 *   Excel maestro de Flujo de Caja — cubre Nov-2022 en adelante, es el
 *   registro histórico más completo, ver `sync-flujo-caja-historico.ts`);
 *   para meses que esa tabla todavía no cubre (recientes, el Excel
 *   maestro no cerrado aún), se usa la suma de
 *   `buk_dotacion_snapshots.activos` de ese mes (snapshot real del cron
 *   mensual de Buk).
 * - Meses futuros (sin dato real todavía): se parte del último total REAL
 *   conocido (de cualquiera de las 2 fuentes anteriores) y se acumula,
 *   mes a mes, la `variacion_neta` (altas−bajas) de `headcount_by_obra`
 *   sumada a través de TODAS las obras — origen 'manual', 'buk_real' o
 *   'modelo_estimado' (curva de obras similares, ver
 *   `headcount/forecast-model/run.ts`, que YA modela el ciclo completo de
 *   una obra: sube en el arranque, se estabiliza en régimen, baja al
 *   cierre).
 */
export async function getDotacionTotalPorPeriodo(
  periodoDesde: Date,
  periodoHasta: Date,
): Promise<Map<string, DotacionTotalPunto>> {
  const supabase = createServiceClient();
  const resultado = new Map<string, DotacionTotalPunto>();

  const totalPorSnapshot = new Map<string, number>();

  // BUG REAL corregido 17-ago-2026: esta consulta no tenía `.range()` ni
  // `.limit()` — PostgREST trunca a su tope server-side (`max-rows`,
  // ~1000) sin avisar, y como hay ~250 filas/mes × 103 meses (~25.000+
  // filas), con `.order("snapshot_date")` ascendente solo volvían los
  // primeros ~4 meses de 2018 — TODO 2026 quedaba silenciosamente afuera.
  // Por eso mayo se veía "real" (venía de `dotacion_mensual`, el Excel) y
  // junio/julio se veían "estimados" pese a que Buk SÍ tenía el dato real
  // (confirmado: 247 y 259 filas reales respectivamente) — el mismo
  // patrón de bug ya encontrado y corregido 2 veces en los scripts de
  // backfill (ver Auto-Blindaje 14-ago-2026), esta vez en la lectura, no
  // en la escritura. Fix: paginar con `.range()` hasta agotar la tabla.
  const snapshots: { snapshot_date: string; activos: number }[] = [];
  const TAMANO_PAGINA = 1000;
  for (let desde = 0; ; desde += TAMANO_PAGINA) {
    const { data: pagina } = await supabase
      .from("buk_dotacion_snapshots")
      .select("snapshot_date, activos")
      .order("snapshot_date")
      .range(desde, desde + TAMANO_PAGINA - 1);
    if (!pagina || pagina.length === 0) break;
    snapshots.push(...pagina);
    if (pagina.length < TAMANO_PAGINA) break;
  }
  // BUG REAL corregido 17-ago-2026 (mismo día, 2do bug distinto): cada
  // `snapshot_date` es una FOTO puntual de dotación — si el mismo mes
  // tiene más de 1 snapshot (ej. el cron mensual del día 5 + el pull en
  // vivo de "Actualizar reporte" de hoy, que ahora corre cada vez que se
  // hace click — ver refresh.ts), el período debe quedarse con el
  // snapshot MÁS RECIENTE de ese mes, nunca con la SUMA de ambos (sumar 2
  // fotos del mismo mes duplica gente que sigue activa en las 2 — visto
  // en vivo: agosto salió ~1.760 en vez de ~860 porque sumaba el
  // snapshot del 5-ago con el de hoy). Primero se suma `activos` por
  // fecha exacta, después cada período se queda con la fecha más
  // reciente que caiga en ese mes (no con la suma de todas).
  const sumaPorFechaExacta = new Map<string, number>();
  for (const s of snapshots) {
    sumaPorFechaExacta.set(
      s.snapshot_date,
      (sumaPorFechaExacta.get(s.snapshot_date) ?? 0) + s.activos,
    );
  }
  for (const [fecha, suma] of [...sumaPorFechaExacta.entries()].sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    // Recorriendo en orden ascendente, la última asignación por período
    // es siempre la fecha más reciente de ese mes — pisa a la anterior a
    // propósito.
    totalPorSnapshot.set(periodoDeFecha(fecha), suma);
  }

  // `dotacion_mensual` manda por sobre el derivado de Buk cuando ambos
  // cubren el mismo mes — es la fuente más completa históricamente.
  // `.limit()` defensivo — esta tabla es 1 fila/mes (bajo riesgo real de
  // superar 1000 filas), pero mismo criterio de nunca asumir que no hace
  // falta.
  const { data: dotacionMensual } = await supabase
    .from("dotacion_mensual")
    .select("periodo, total")
    .order("periodo")
    .limit(1000);
  for (const d of dotacionMensual ?? []) {
    totalPorSnapshot.set(periodoDeFecha(d.periodo), d.total);
  }

  const periodosReales = [...totalPorSnapshot.keys()].sort();
  const ultimoPeriodoReal = periodosReales.at(-1) ?? null;
  const ultimoTotalReal = ultimoPeriodoReal
    ? totalPorSnapshot.get(ultimoPeriodoReal)!
    : null;

  for (const periodo of periodosReales) {
    resultado.set(periodo, {
      periodo,
      total: totalPorSnapshot.get(periodo)!,
      esReal: true,
    });
  }

  if (ultimoPeriodoReal && ultimoTotalReal != null) {
    const { data: variaciones } = await supabase
      .from("headcount_by_obra")
      .select("periodo, variacion_neta")
      .gt("periodo", ultimoPeriodoReal)
      .limit(1000);

    const variacionNetaPorPeriodo = new Map<string, number>();
    for (const v of variaciones ?? []) {
      const periodo = periodoDeFecha(v.periodo);
      variacionNetaPorPeriodo.set(
        periodo,
        (variacionNetaPorPeriodo.get(periodo) ?? 0) + v.variacion_neta,
      );
    }

    const hastaPeriodo = periodoDeFecha(
      periodoHasta.toISOString().slice(0, 10),
    );
    let acumulado = ultimoTotalReal;
    let cursor = sumarMesesAPeriodo(ultimoPeriodoReal, 1);
    // Tope defensivo — nunca debería iterar más de ~240 meses (20 años).
    let guard = 0;
    while (cursor <= hastaPeriodo && guard < 240) {
      acumulado += variacionNetaPorPeriodo.get(cursor) ?? 0;
      resultado.set(cursor, {
        periodo: cursor,
        total: acumulado,
        esReal: false,
      });
      cursor = sumarMesesAPeriodo(cursor, 1);
      guard++;
    }
  }

  const desde = periodoDeFecha(periodoDesde.toISOString().slice(0, 10));
  const hasta = periodoDeFecha(periodoHasta.toISOString().slice(0, 10));
  for (const key of [...resultado.keys()]) {
    if (key < desde || key > hasta) resultado.delete(key);
  }

  return resultado;
}

export interface DotacionRgRpPunto {
  rg: number;
  rp: number;
}

/**
 * Razón real Remuneración RG / Remuneración total, promediada de los
 * últimos N meses reales — para "aperturar" la dotación TOTAL en RG/RP
 * también en los meses PROYECTADOS (pedido explícito del usuario, "como
 * en el Excel"), ya que el modelo costo-por-cabeza solo proyecta el
 * total combinado. `null` si no hay ningún mes real con el desglose
 * todavía. Movida acá desde `refresh.ts` (17-ago-2026) para que la
 * página del reporte pueda mostrar la misma columna N° por RG/RP que ya
 * usa el motor de cálculo, sin duplicar la lógica en 2 lugares.
 */
export async function proporcionRgHistorica(
  supabase: ReturnType<typeof createServiceClient>,
  antesDe: Date,
  n = 3,
): Promise<number | null> {
  const { data } = await supabase
    .from("cash_flow_monthly")
    .select("periodo, monto")
    .eq("concepto", "remuneracion_rg")
    .eq("es_real", true)
    .lt("periodo", antesDe.toISOString().slice(0, 10))
    .order("periodo", { ascending: false })
    .limit(n);

  if (!data || data.length === 0) return null;

  let sumaRg = 0;
  let sumaTotal = 0;
  for (const fila of data) {
    const { data: totalFila } = await supabase
      .from("cash_flow_monthly")
      .select("monto")
      .eq("periodo", fila.periodo)
      .eq("concepto", "remuneracion")
      .maybeSingle();
    if (!totalFila) continue;
    sumaRg += Number(fila.monto);
    sumaTotal += Number(totalFila.monto);
  }
  return sumaTotal > 0 ? sumaRg / sumaTotal : null;
}

/**
 * Dotación RG/RP del mes — reutiliza EXACTAMENTE la dimensión que ya
 * existe para Anticipo/Remuneración (pedido explícito del usuario: "las
 * personas sindicalizadas son solo de la constructora [Rol General], el
 * resto se rige por el anexo"). Real desde `dotacion_mensual` (columnas
 * rg/rp del Excel histórico) cuando el mes ya está cerrado; si no, se
 * deriva de la dotación TOTAL ya calculada aplicando la razón histórica
 * RG/(RG+RP). Movida desde `refresh.ts` (17-ago-2026) — ver
 * `proporcionRgHistorica`.
 */
export async function dotacionRgRpDelMes(
  supabase: ReturnType<typeof createServiceClient>,
  mes: Date,
  dotacionPorPeriodo: Map<string, DotacionTotalPunto>,
): Promise<DotacionRgRpPunto> {
  const periodoStr = mes.toISOString().slice(0, 10);
  const { data } = await supabase
    .from("dotacion_mensual")
    .select("rg, rp")
    .eq("periodo", periodoStr)
    .maybeSingle();
  if (data?.rg != null && data?.rp != null) {
    return { rg: data.rg, rp: data.rp };
  }

  const total = dotacionPorPeriodo.get(periodoStr)?.total ?? 0;
  if (total === 0) return { rg: 0, rp: 0 };
  const proporcionRg = await proporcionRgHistorica(supabase, mes);
  if (proporcionRg == null) return { rg: 0, rp: 0 };
  const rg = Math.round(total * proporcionRg);
  return { rg, rp: total - rg };
}

/**
 * Versión "para todo el rango de una vez" de `dotacionRgRpDelMes` — usada
 * por la tabla de detalle y los 3 formatos de export (columna N° bajo
 * cada sub-fila RG/RP de Anticipo y Remuneración, igual al formato del
 * Excel real de Finanzas, pedido explícito del usuario 17-ago-2026:
 * "mantén ese formato para ver cómo va cambiando el input principal que
 * corresponde a dotación").
 */
export async function getDotacionRgRpPorPeriodo(
  periodoDesde: Date,
  periodoHasta: Date,
): Promise<Map<string, DotacionRgRpPunto>> {
  const supabase = createServiceClient();
  const dotacionPorPeriodo = await getDotacionTotalPorPeriodo(
    periodoDesde,
    periodoHasta,
  );

  const resultado = new Map<string, DotacionRgRpPunto>();
  const cursor = new Date(
    periodoDesde.getFullYear(),
    periodoDesde.getMonth(),
    1,
  );
  const hasta = new Date(
    periodoHasta.getFullYear(),
    periodoHasta.getMonth(),
    1,
  );
  // Tope defensivo — nunca debería iterar más de ~240 meses (20 años).
  let guard = 0;
  while (cursor <= hasta && guard < 240) {
    const punto = await dotacionRgRpDelMes(
      supabase,
      cursor,
      dotacionPorPeriodo,
    );
    resultado.set(cursor.toISOString().slice(0, 10), punto);
    cursor.setMonth(cursor.getMonth() + 1);
    guard++;
  }
  return resultado;
}

/**
 * N° REAL de gente que recibió Anticipo (rg+rp) en un período específico —
 * cuenta filas de `payroll_line_items` (grano de persona). `null` si no hay
 * ningún dato real ingerido todavía para ese período. Solo `count` (sin
 * traer filas) — no hay riesgo de truncamiento de PostgREST con este patrón.
 */
async function dotacionAnticipoRealDelMes(
  supabase: ReturnType<typeof createServiceClient>,
  periodoStr: string,
): Promise<number | null> {
  const { count } = await supabase
    .from("payroll_line_items")
    .select("*", { count: "exact", head: true })
    .in("concepto", ["anticipo_rg", "anticipo_rp"])
    .eq("periodo", periodoStr);
  return count && count > 0 ? count : null;
}

/**
 * Razón real: dotación de Anticipo (gente que efectivamente lo recibe) ÷
 * dotación TOTAL de la compañía, promediada de los últimos N meses con dato
 * real de Anticipo — para proyectar la dotación PROPIA de Anticipo en meses
 * sin ingesta real todavía. Pedido explícito del usuario 18-ago-2026: "para
 * efectos de la proyección de anticipos... la dotación se debe ir
 * proyectando por concepto" — Anticipo NO puede reutilizar la dotación (ni
 * la razón histórica) de Remuneración, son poblaciones distintas (mucha
 * menos gente pide Anticipo, ver Auto-Blindaje 17-ago-2026 en
 * `getDotacionPorConceptoYPeriodo`).
 *
 * Independiente del rango que esté iterando el caller — trae su propia
 * ventana de dotación TOTAL (24 meses atrás) vía `getDotacionTotalPorPeriodo`,
 * mismo criterio de `proporcionRgHistorica` (que tampoco depende del mapa
 * del caller).
 */
export async function proporcionAnticipoHistorica(
  supabase: ReturnType<typeof createServiceClient>,
  antesDe: Date,
  n = 3,
): Promise<number | null> {
  const desde = new Date(antesDe.getFullYear(), antesDe.getMonth() - 24, 1);
  const hasta = new Date(antesDe.getFullYear(), antesDe.getMonth() - 1, 1);
  const dotacionPorPeriodo = await getDotacionTotalPorPeriodo(desde, hasta);

  const razones: number[] = [];
  const periodos = [...dotacionPorPeriodo.keys()].sort().reverse();
  for (const periodo of periodos) {
    if (razones.length >= n) break;
    const dotacionTotal = dotacionPorPeriodo.get(periodo)!.total;
    const conteoAnticipo = await dotacionAnticipoRealDelMes(supabase, periodo);
    if (conteoAnticipo != null && dotacionTotal) {
      razones.push(conteoAnticipo / dotacionTotal);
    }
  }
  if (razones.length === 0) return null;
  return razones.reduce((a, b) => a + b, 0) / razones.length;
}

/**
 * Dotación de Anticipo (N° de gente que lo recibe, no la dotación total ni
 * la de Remuneración) del mes — real desde `payroll_line_items` cuando ya
 * hay ingesta para ese período; si no, se deriva de la dotación TOTAL
 * aplicando la razón histórica PROPIA de Anticipo (ver
 * `proporcionAnticipoHistorica`). Es la variable "Q" del modelo
 * costo-por-cabeza aplicado a Anticipo (ver `calcularAnticipoPorCabeza` en
 * `formulas.ts`) — mismo patrón que `dotacionRgRpDelMes`, pero con la
 * dotación propia del concepto en vez de la razón RG/RP.
 */
export async function dotacionAnticipoDelMes(
  supabase: ReturnType<typeof createServiceClient>,
  mes: Date,
  dotacionPorPeriodo: Map<string, DotacionTotalPunto>,
): Promise<number | null> {
  const periodoStr = mes.toISOString().slice(0, 10);
  const real = await dotacionAnticipoRealDelMes(supabase, periodoStr);
  if (real != null) return real;

  const dotacionTotal = dotacionPorPeriodo.get(periodoStr)?.total;
  if (!dotacionTotal) return null;
  const proporcion = await proporcionAnticipoHistorica(supabase, mes);
  if (proporcion == null) return null;
  return Math.round(dotacionTotal * proporcion);
}

export interface DotacionPorConceptoPunto {
  anticipo_rg: number | null;
  anticipo_rp: number | null;
  remuneracion_rg: number | null;
  remuneracion_rp: number | null;
}

const CONCEPTOS_CON_DOTACION = [
  "anticipo_rg",
  "anticipo_rp",
  "remuneracion_rg",
  "remuneracion_rp",
] as const;

/**
 * N° (dotación) por CADA sub-fila RG/RP de Anticipo y Remuneración por
 * separado — bug real corregido 17-ago-2026: antes se reutilizaba la
 * MISMA dotación total (RG/RP) para las 4 sub-filas, mostrando el mismo
 * N° en Anticipo que en Remuneración — pero mucha menos gente pide
 * Anticipo que la que recibe Remuneración completa (confirmado por el
 * usuario viendo el Excel real: "las personas que reciben anticipos son
 * muchos menos").
 *
 * `payroll_line_items` es grano de PERSONA (1 fila = 1 pago real a 1
 * persona, sin RUT/nombre — ver types.ts) para los meses ya ingeridos
 * de SharePoint: contar sus filas por (concepto, período) da el N°
 * REAL de gente que recibió ESE concepto específico ese mes — a
 * diferencia de la dotación total, que no distingue Anticipo de
 * Remuneración. Para meses sin ese dato real todavía (proyectados o
 * antes de que existiera la ingesta), cae al mismo estimado de
 * `dotacionRgRpDelMes` que ya se usaba (dotación total × razón RG/RP),
 * igual para las 4 sub-filas — sigue siendo un estimado razonable a
 * falta de algo mejor, pero SOLO cuando no hay dato real.
 */
export async function getDotacionPorConceptoYPeriodo(
  periodoDesde: Date,
  periodoHasta: Date,
): Promise<Map<string, DotacionPorConceptoPunto>> {
  const supabase = createServiceClient();
  const dotacionRgRpPorPeriodo = await getDotacionRgRpPorPeriodo(
    periodoDesde,
    periodoHasta,
  );

  // Paginado con `.range()` — mismo motivo ya documentado 2 veces en
  // este archivo: PostgREST trunca a su tope server-side (~1000 filas)
  // sin avisar, y esta tabla es grano de persona (puede haber cientos
  // de filas por mes).
  const conteoPorClave = new Map<string, number>();
  const TAMANO_PAGINA = 1000;
  for (let desde = 0; ; desde += TAMANO_PAGINA) {
    const { data: pagina } = await supabase
      .from("payroll_line_items")
      .select("periodo, concepto")
      .in("concepto", CONCEPTOS_CON_DOTACION)
      .gte("periodo", periodoDesde.toISOString().slice(0, 10))
      .lte("periodo", periodoHasta.toISOString().slice(0, 10))
      .range(desde, desde + TAMANO_PAGINA - 1);
    if (!pagina || pagina.length === 0) break;
    for (const fila of pagina) {
      const clave = `${fila.concepto}::${fila.periodo}`;
      conteoPorClave.set(clave, (conteoPorClave.get(clave) ?? 0) + 1);
    }
    if (pagina.length < TAMANO_PAGINA) break;
  }

  const resultado = new Map<string, DotacionPorConceptoPunto>();
  for (const [periodo, rgRp] of dotacionRgRpPorPeriodo) {
    resultado.set(periodo, {
      anticipo_rg: conteoPorClave.get(`anticipo_rg::${periodo}`) ?? rgRp.rg,
      anticipo_rp: conteoPorClave.get(`anticipo_rp::${periodo}`) ?? rgRp.rp,
      remuneracion_rg:
        conteoPorClave.get(`remuneracion_rg::${periodo}`) ?? rgRp.rg,
      remuneracion_rp:
        conteoPorClave.get(`remuneracion_rp::${periodo}`) ?? rgRp.rp,
    });
  }
  return resultado;
}
