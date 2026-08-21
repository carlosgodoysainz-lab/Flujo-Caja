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

/**
 * Razón real: Anticipo RG ÷ Anticipo total (rg+rp), promediada de los
 * últimos N meses con dato real de Anticipo — para "aperturar" en RG/RP la
 * dotación PROPIA de Anticipo también en meses proyectados. Mismo criterio
 * que `proporcionRgHistorica`, pero con la población PROPIA de Anticipo,
 * nunca la de Remuneración (ver bug real 18-ago-2026 más abajo, en
 * `getDotacionPorConceptoYPeriodo`).
 */
async function proporcionAnticipoRgHistorica(
  supabase: ReturnType<typeof createServiceClient>,
  antesDe: Date,
  n = 3,
): Promise<number | null> {
  const razones: number[] = [];
  let mesesAtras = 1;
  let guard = 0;
  while (razones.length < n && guard < 24) {
    const cursor = new Date(
      antesDe.getFullYear(),
      antesDe.getMonth() - mesesAtras,
      1,
    );
    const periodoStr = cursor.toISOString().slice(0, 10);
    const { count: countRg } = await supabase
      .from("payroll_line_items")
      .select("*", { count: "exact", head: true })
      .eq("concepto", "anticipo_rg")
      .eq("periodo", periodoStr);
    const { count: countRp } = await supabase
      .from("payroll_line_items")
      .select("*", { count: "exact", head: true })
      .eq("concepto", "anticipo_rp")
      .eq("periodo", periodoStr);
    const total = (countRg ?? 0) + (countRp ?? 0);
    if (total > 0) razones.push((countRg ?? 0) / total);
    mesesAtras++;
    guard++;
  }
  if (razones.length === 0) return null;
  return razones.reduce((a, b) => a + b, 0) / razones.length;
}

export interface DotacionPorConceptoPunto {
  anticipo_rg: number | null;
  anticipo_rp: number | null;
  remuneracion_rg: number | null;
  remuneracion_rp: number | null;
}

// Solo Anticipo — Remuneración RG/RP ya NUNCA lee payroll_line_items
// (ver comentario de getDotacionPorConceptoYPeriodo), así que pedirlos
// acá sería trabajo/datos descartados.
const CONCEPTOS_CON_DOTACION = ["anticipo_rg", "anticipo_rp"] as const;

/**
 * N° (dotación) por CADA sub-fila RG/RP de Anticipo y Remuneración por
 * separado.
 *
 * Bug real corregido 21-ago-2026 (invalida una premisa de los 2 fixes
 * anteriores, 17 y 18-ago): `payroll_line_items` NO es grano de persona
 * — es grano de (sociedad, división/obra). Confirmado con datos reales
 * (usuario: "la sumatoria de dotación no cuadra... debería sumar la
 * dotación de sueldos"): para mayo-2026 el archivo real de Remuneración
 * RG solo tenía 20 filas totales para TODA la compañía (Dotación total
 * = 790), y una fila de Anticipo real tenía monto $37.590.000 — imposible
 * que sea 1 sola persona. El archivo es un REQUERIMIENTO DE TRANSFERENCIA
 * agregado por división/centro de costo (para que Finanzas pida el giro
 * al banco), no un listado persona por persona — Buk (no este archivo)
 * es el único sistema con el detalle real por persona, y no se integra
 * acá (ver regla de nunca persistir RUT/nombre).
 *
 * Por esto, **Remuneración RG/RP NUNCA usa el conteo de
 * `payroll_line_items`** — siempre usa `rgRp.rg`/`rgRp.rp` (dotación
 * TOTAL real/proyectada × razón histórica RG/RP en $, ver
 * `dotacionRgRpDelMes`), que es lo que realmente reconcilia con la fila
 * "Dotación (N°)" (RG+RP = total) — igual que el Excel real de
 * Finanzas (confirmado 18-ago-2026: su N° de Remuneración RG/RP también
 * suma al total de dotación, no al conteo de filas del archivo).
 *
 * **Anticipo RG/RP SÍ sigue usando el conteo de `payroll_line_items`**
 * — decisión explícita del usuario (18-ago-2026, vía AskUserQuestion:
 * "Personas que efectivamente cobraron anticipo") tomada ANTES de
 * descubrir que ese conteo en realidad mide "N° de divisiones/obras con
 * un pago de Anticipo ese mes", no "N° de personas". Sigue siendo un
 * número mucho más chico y más volátil que la dotación total (lo que el
 * usuario pidió visualmente), pero la etiqueta "personas" ya no es
 * exacta — pendiente de decisión del usuario si quiere mantenerlo así,
 * relabearlo, o buscar una fuente real de headcount por persona.
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
  const dotacionPorPeriodo = await getDotacionTotalPorPeriodo(
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
    let anticipoRg = conteoPorClave.get(`anticipo_rg::${periodo}`) ?? null;
    let anticipoRp = conteoPorClave.get(`anticipo_rp::${periodo}`) ?? null;
    if (anticipoRg == null || anticipoRp == null) {
      const [anio, mesNum] = periodo.split("-").map(Number);
      const mesDate = new Date(anio, mesNum - 1, 1);
      const anticipoTotal = await dotacionAnticipoDelMes(
        supabase,
        mesDate,
        dotacionPorPeriodo,
      );
      if (anticipoTotal != null) {
        const proporcionRg = await proporcionAnticipoRgHistorica(
          supabase,
          mesDate,
        );
        if (proporcionRg != null) {
          anticipoRg = Math.round(anticipoTotal * proporcionRg);
          anticipoRp = anticipoTotal - anticipoRg;
        }
      }
    }
    resultado.set(periodo, {
      anticipo_rg: anticipoRg,
      anticipo_rp: anticipoRp,
      // Remuneración SIEMPRE usa la dotación total×razón — nunca el
      // conteo de payroll_line_items (no es grano de persona, ver
      // comentario de la función). RG+RP reconcilia con "Dotación (N°)".
      remuneracion_rg: rgRp.rg,
      remuneracion_rp: rgRp.rp,
    });
  }
  return resultado;
}
