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
    // Paginado con `.range()` (24-sep-2026) en vez de `.limit(1000)` fijo —
    // mismo criterio defensivo que el resto del archivo: hoy son ~30 obras
    // × meses futuros (bajo riesgo real de superar 1000), pero un
    // `.limit()` fijo trunca en silencio si algún día se supera, sin
    // avisar (el mismo patrón de bug ya corregido 3 veces acá arriba).
    const variaciones: { periodo: string; variacion_neta: number }[] = [];
    const TAMANO_PAGINA_VARIACIONES = 1000;
    for (let desde = 0; ; desde += TAMANO_PAGINA_VARIACIONES) {
      const { data: pagina } = await supabase
        .from("headcount_by_obra")
        .select("periodo, variacion_neta")
        .gt("periodo", ultimoPeriodoReal)
        .range(desde, desde + TAMANO_PAGINA_VARIACIONES - 1);
      if (!pagina || pagina.length === 0) break;
      variaciones.push(...pagina);
      if (pagina.length < TAMANO_PAGINA_VARIACIONES) break;
    }

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
 * Razón real Remuneración RG / Remuneración total EN $, promediada de
 * los últimos N meses reales — usada para partir el MONTO de
 * Remuneración en RG/RP (refresh.ts), donde sí corresponde una razón en
 * dinero: RG (Rol General) y RP (Anexo/Oficina Central) tienen sueldos
 * promedio por persona distintos, así que "% del monto" y "% de la
 * dotación" son razones DIFERENTES a propósito (ver
 * `proporcionRgHistoricaPersonas` para la de dotación/N°, usada en
 * `dotacionRgRpDelMes` — no intercambiar una por la otra, bug real
 * corregido 24-ago-2026, ver esa función). `null` si no hay ningún mes
 * real con el desglose todavía.
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
 * Razón real de DOTACIÓN (personas) RG / (RG+RP), promediada de los
 * últimos N meses reales de `dotacion_mensual` — para "aperturar" la
 * dotación TOTAL en RG/RP también en los meses PROYECTADOS sin fila real
 * en `dotacion_mensual` todavía. `null` si no hay ningún mes real con el
 * desglose.
 *
 * Bug real corregido 24-ago-2026: `dotacionRgRpDelMes` usaba
 * `proporcionRgHistorica` (razón en $) para partir la DOTACIÓN (N°) — y
 * como RP gana en promedio MÁS por persona que RG, la razón en $
 * (~74-78%) es sistemáticamente distinta a la razón real en PERSONAS
 * (~95-96%, confirmado contra 43 meses reales de `dotacion_mensual`
 * desde dic-2023, notablemente estable). Esto hacía que el N° de RG/RP
 * proyectado (meses sin fila real en `dotacion_mensual`, ej.
 * junio/julio-2026) saltara de forma errática respecto al último mes con
 * dato real — reportado por el usuario ("el RP está muy dividido").
 */
export async function proporcionRgHistoricaPersonas(
  supabase: ReturnType<typeof createServiceClient>,
  antesDe: Date,
  n = 3,
): Promise<number | null> {
  const { data } = await supabase
    .from("dotacion_mensual")
    .select("periodo, rg, rp")
    .not("rg", "is", null)
    .not("rp", "is", null)
    .lt("periodo", antesDe.toISOString().slice(0, 10))
    .order("periodo", { ascending: false })
    .limit(n);

  if (!data || data.length === 0) return null;

  const razones = data
    .map((fila) => {
      const rg = Number(fila.rg);
      const rp = Number(fila.rp);
      const total = rg + rp;
      return total > 0 ? rg / total : null;
    })
    .filter((r): r is number => r != null);

  if (razones.length === 0) return null;
  return razones.reduce((a, b) => a + b, 0) / razones.length;
}

/**
 * Promedio de los últimos N meses REALES de dotación RP (personas) —
 * mismo patrón que `promedioAnticipoRpReal` (refresh.ts) aplicado a la
 * dotación N° de RP. `null` si no hay ningún mes real todavía.
 *
 * Bug real corregido 24-ago-2026: `dotacionRgRpDelMes` calculaba RP
 * SIEMPRE como residual (Total − RG) — y como la razón RG se mantiene
 * casi constante (~95-96%, ver `proporcionRgHistoricaPersonas`) pero el
 * TOTAL de la compañía sube/baja por el ciclo de obras, RP absorbía el
 * 100% de esa variación pese a que su propia población (Anexo/Oficina
 * Central) no tiene ninguna relación con las obras — reportado por el
 * usuario ("el RP... alza significativa de un mes para otro... mantenla
 * constante... esa dotación es muy estable"). Ahora RP es el ANCLA
 * (promedio histórico real) y RG absorbe el residual — al revés de
 * antes, mismo criterio ya aplicado a Anticipo RP el 20-ago-2026 (ver
 * `promedioAnticipoRpReal`).
 */
export async function promedioDotacionRpReal(
  supabase: ReturnType<typeof createServiceClient>,
  antesDe: Date,
  n = 3,
): Promise<number | null> {
  const { data } = await supabase
    .from("dotacion_mensual")
    .select("rp")
    .not("rp", "is", null)
    .lt("periodo", antesDe.toISOString().slice(0, 10))
    .order("periodo", { ascending: false })
    .limit(n);

  if (!data || data.length === 0) return null;
  return data.reduce((acc, fila) => acc + Number(fila.rp), 0) / data.length;
}

/**
 * Dotación RG/RP del mes — reutiliza EXACTAMENTE la dimensión que ya
 * existe para Anticipo/Remuneración (pedido explícito del usuario: "las
 * personas sindicalizadas son solo de la constructora [Rol General], el
 * resto se rige por el anexo"). Real desde `dotacion_mensual` (columnas
 * rg/rp del Excel histórico) cuando el mes ya está cerrado; si no, RP se
 * ancla al promedio histórico real (`promedioDotacionRpReal`) y RG
 * absorbe el residual (Total − RP) — ver comentario de esa función.
 * Fallback final (sin NINGÚN mes real de RP todavía, compañía/obra muy
 * nueva): vuelve al split proporcional histórico de personas
 * (`proporcionRgHistoricaPersonas`), comportamiento anterior a este fix.
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

  const rpPromedio = await promedioDotacionRpReal(supabase, mes);
  if (rpPromedio != null) {
    const rp = Math.round(rpPromedio);
    return { rg: total - rp, rp };
  }

  const proporcionRg = await proporcionRgHistoricaPersonas(supabase, mes);
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
 *
 * `dotacionPorPeriodoPrefetched` (opcional): evita un 2do fetch completo
 * de `getDotacionTotalPorPeriodo` cuando el caller ya tiene uno a mano
 * (ver `getDotacionPorConceptoYPeriodo`, que necesita una ventana más
 * amplia de todas formas — mismo fix de performance 24-ago-2026). Un mapa
 * más amplio que [periodoDesde, periodoHasta] funciona igual: acá solo se
 * hacen lookups por clave puntual, nunca se asume el límite exacto.
 */
export async function getDotacionRgRpPorPeriodo(
  periodoDesde: Date,
  periodoHasta: Date,
  dotacionPorPeriodoPrefetched?: Map<string, DotacionTotalPunto>,
): Promise<Map<string, DotacionRgRpPunto>> {
  const supabase = createServiceClient();
  const dotacionPorPeriodo =
    dotacionPorPeriodoPrefetched ??
    (await getDotacionTotalPorPeriodo(periodoDesde, periodoHasta));

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
 * Dotación de "Oficina Central" real por período — PARA LA FILA "Oficina
 * Central" de la hoja Excel "Proyección Headcount" (`render-excel.ts`),
 * EXCLUSIVAMENTE. No reemplaza ni toca `dotacionRgRpDelMes`/
 * `promedioDotacionRpReal` (esas siguen alimentando el split $ de
 * Anticipo/Remuneración RG/RP en otras hojas, una fórmula ya afinada en
 * una ronda anterior).
 *
 * Pedido explícito del usuario 25-ago-2026: "oficina central incluye RP
 * y RG [el que] no está asignado a ninguna obra" — antes esta fila solo
 * sumaba `dotacion_mensual.rp` (RP contractual), dejando fuera a la gente
 * RG que no trabaja en ninguna obra (ej. bodega/taller central).
 *
 * Por período: si ya existe una fila REAL cerrada en `dotacion_mensual`
 * (Finanzas), usa su `.rp` tal cual — un mes ya cerrado no se puede
 * reabrir retroactivamente con el desglose nuevo (Finanzas nunca separó
 * "RG sin obra" en su Excel histórico). Si no hay fila real (mes actual o
 * proyectado), usa el snapshot MÁS RECIENTE de `oficina_central_snapshots`
 * (`rol_privado_count + rg_sin_obra_count`, ver migración y
 * `buk-sync/sync.ts`) — dato real en vivo vía `private_role` de Buk, en
 * vez del promedio de 3 meses que usa el split $ (mejor: es un conteo
 * real de HOY, no un promedio histórico).
 *
 * Un período sin ningún dato (ni real ni snapshot de Buk todavía) NO
 * entra al mapa — el caller debe tratar la ausencia de clave como "sin
 * dato", nunca como 0 (evita esconder un hueco real de datos).
 */
export async function getOficinaCentralHeadcountPorPeriodo(
  periodoDesde: Date,
  periodoHasta: Date,
): Promise<Map<string, number>> {
  const supabase = createServiceClient();
  const desdeStr = periodoDesde.toISOString().slice(0, 10);
  const hastaStr = periodoHasta.toISOString().slice(0, 10);

  const { data: filasReales } = await supabase
    .from("dotacion_mensual")
    .select("periodo, rp")
    .gte("periodo", desdeStr)
    .lte("periodo", hastaStr)
    .not("rp", "is", null);
  const rpRealPorPeriodo = new Map<string, number>(
    (filasReales ?? []).map((f) => [f.periodo as string, f.rp as number]),
  );

  const { data: snapshotReciente } = await supabase
    .from("oficina_central_snapshots")
    .select("rol_privado_count, rg_sin_obra_count")
    .lte("snapshot_date", hastaStr)
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const oficinaCentralViva =
    snapshotReciente != null
      ? snapshotReciente.rol_privado_count + snapshotReciente.rg_sin_obra_count
      : null;

  const resultado = new Map<string, number>();
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
  let guard = 0;
  while (cursor <= hasta && guard < 240) {
    const periodoStr = cursor.toISOString().slice(0, 10);
    const real = rpRealPorPeriodo.get(periodoStr);
    if (real != null) {
      resultado.set(periodoStr, real);
    } else if (oficinaCentralViva != null) {
      resultado.set(periodoStr, oficinaCentralViva);
    }
    cursor.setMonth(cursor.getMonth() + 1);
    guard++;
  }
  return resultado;
}

/**
 * N° REAL de gente que recibió Anticipo (rg+rp) en un período específico —
 * lookup PURO (sin query) sobre un mapa `payroll_beneficiarios_reales` ya
 * prefetcheado (ver `getDotacionPorConceptoYPeriodo`). `null` si no hay
 * dato real todavía para ese período.
 *
 * Antes esto era 1 query por período — bug real de PERFORMANCE corregido
 * 24-ago-2026 (mismo día del fix que introdujo esta tabla): multiplicado
 * por los loops de razón histórica de abajo, "Actualizar reporte" y
 * "Descargar HTML + Excel" pasaron a tardar MINUTOS (reportado por el
 * usuario: "lleva 3 min") en vez de segundos — ver Auto-Blindaje.
 */
function dotacionAnticipoRealDelMes(
  beneficiariosPorClave: Map<string, number>,
  periodoStr: string,
): number | null {
  const total =
    (beneficiariosPorClave.get(`anticipo_rg::${periodoStr}`) ?? 0) +
    (beneficiariosPorClave.get(`anticipo_rp::${periodoStr}`) ?? 0);
  return total > 0 ? total : null;
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
 * PURA (sin query): recibe `dotacionPorPeriodoAmplio` ya prefetcheado
 * cubriendo al menos los 24 meses anteriores a `antesDe` — antes esta
 * función volvía a llamar `getDotacionTotalPorPeriodo` (que lee TODO el
 * histórico de `buk_dotacion_snapshots`/`dotacion_mensual` sin importar el
 * rango pedido) UNA VEZ POR CADA período sin dato real de Anticipo, el
 * principal contribuyente al bug de performance de arriba.
 */
function proporcionAnticipoHistoricaPura(
  dotacionPorPeriodoAmplio: Map<string, DotacionTotalPunto>,
  beneficiariosPorClave: Map<string, number>,
  antesDe: Date,
  n = 3,
): number | null {
  const desde = periodoDeFecha(
    new Date(antesDe.getFullYear(), antesDe.getMonth() - 24, 1)
      .toISOString()
      .slice(0, 10),
  );
  const hasta = periodoDeFecha(
    new Date(antesDe.getFullYear(), antesDe.getMonth() - 1, 1)
      .toISOString()
      .slice(0, 10),
  );
  const periodos = [...dotacionPorPeriodoAmplio.keys()]
    .filter((p) => p >= desde && p <= hasta)
    .sort()
    .reverse();

  const razones: number[] = [];
  for (const periodo of periodos) {
    if (razones.length >= n) break;
    const dotacionTotal = dotacionPorPeriodoAmplio.get(periodo)!.total;
    const conteoAnticipo = dotacionAnticipoRealDelMes(
      beneficiariosPorClave,
      periodo,
    );
    if (conteoAnticipo != null && dotacionTotal) {
      razones.push(conteoAnticipo / dotacionTotal);
    }
  }
  if (razones.length === 0) return null;
  return razones.reduce((a, b) => a + b, 0) / razones.length;
}

/**
 * Dotación de Anticipo (N° de gente que lo recibe, no la dotación total ni
 * la de Remuneración) del mes — real desde `payroll_beneficiarios_reales`
 * cuando ya hay ingesta para ese período; si no, se deriva de la dotación
 * TOTAL aplicando la razón histórica PROPIA de Anticipo (ver
 * `proporcionAnticipoHistoricaPura`). Es la variable "Q" del modelo
 * costo-por-cabeza aplicado a Anticipo — mismo patrón que
 * `dotacionRgRpDelMes`, pero con la dotación propia del concepto en vez de
 * la razón RG/RP. PURA — ver comentario de performance arriba.
 */
function dotacionAnticipoDelMesPura(
  dotacionPorPeriodoAmplio: Map<string, DotacionTotalPunto>,
  beneficiariosPorClave: Map<string, number>,
  mes: Date,
): number | null {
  const periodoStr = mes.toISOString().slice(0, 10);
  const real = dotacionAnticipoRealDelMes(beneficiariosPorClave, periodoStr);
  if (real != null) return real;

  const dotacionTotal = dotacionPorPeriodoAmplio.get(periodoStr)?.total;
  if (!dotacionTotal) return null;
  const proporcion = proporcionAnticipoHistoricaPura(
    dotacionPorPeriodoAmplio,
    beneficiariosPorClave,
    mes,
  );
  if (proporcion == null) return null;
  return Math.round(dotacionTotal * proporcion);
}

/**
 * Razón real: Anticipo RG ÷ Anticipo total (rg+rp), promediada de los
 * últimos N meses con dato real de Anticipo — para "aperturar" en RG/RP la
 * dotación PROPIA de Anticipo también en meses proyectados. Mismo criterio
 * que `proporcionRgHistoricaPersonas`, pero con la población PROPIA de
 * Anticipo, nunca la de Remuneración. PURA — ver comentario de performance
 * arriba (antes: 1 query por mes retrocedido, hasta 24 por llamada).
 */
function proporcionAnticipoRgHistoricaPura(
  beneficiariosPorClave: Map<string, number>,
  antesDe: Date,
  n = 3,
): number | null {
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
    const countRg =
      beneficiariosPorClave.get(`anticipo_rg::${periodoStr}`) ?? 0;
    const countRp =
      beneficiariosPorClave.get(`anticipo_rp::${periodoStr}`) ?? 0;
    const total = countRg + countRp;
    if (total > 0) razones.push(countRg / total);
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
 * **Anticipo RG/RP usa `payroll_beneficiarios_reales`** — conteo REAL de
 * personas (líneas de los archivos de transferencia bancaria del banco,
 * ver sync-beneficiarios-anticipo.ts), no `payroll_line_items`. Bug real
 * corregido 24-ago-2026 (pedido del usuario: "la cantidad de personas
 * son muchos más... revisa el detalle en la carpeta donde está el banco
 * y corriges por la cantidad de beneficiarios"): `payroll_line_items`
 * daba ~15-20 "personas" (en realidad divisiones/obras) para toda la
 * compañía, cuando el archivo de transferencia bancaria de UNA sola
 * sociedad ya tiene cientos de líneas reales.
 */
export async function getDotacionPorConceptoYPeriodo(
  periodoDesde: Date,
  periodoHasta: Date,
): Promise<Map<string, DotacionPorConceptoPunto>> {
  const supabase = createServiceClient();

  // Ventana AMPLIA (24 meses antes de periodoDesde) — cubre también la
  // ventana histórica que necesita `proporcionAnticipoHistoricaPura` para
  // CUALQUIER período dentro de [periodoDesde, periodoHasta]. Se calcula
  // UNA sola vez y se reutiliza tanto para `getDotacionRgRpPorPeriodo`
  // (evita su 2do fetch completo) como para todos los períodos del loop
  // de abajo.
  //
  // BUG REAL DE PERFORMANCE corregido 24-ago-2026: antes, cada período sin
  // dato real de Anticipo disparaba su PROPIA llamada completa a
  // `getDotacionTotalPorPeriodo` (que lee TODO el histórico de
  // `buk_dotacion_snapshots`/`dotacion_mensual` sin importar el rango
  // pedido — decenas de round-trips paginados cada vez) más hasta ~48
  // queries adicionales de razón histórica — con el rango típico de un
  // export (12-18 meses) esto sumaba fácilmente cientos de round-trips
  // SECUENCIALES a Supabase. Reportado por el usuario: "Actualizar
  // reporte"/"Descargar HTML + Excel" tardaban minutos en vez de segundos.
  // Ahora se prefetchea 1 sola vez y el resto del loop es puro (sin query).
  const periodoDesdeAmplio = new Date(
    periodoDesde.getFullYear(),
    periodoDesde.getMonth() - 24,
    1,
  );
  const dotacionTotalAmplio = await getDotacionTotalPorPeriodo(
    periodoDesdeAmplio,
    periodoHasta,
  );

  const dotacionRgRpPorPeriodo = await getDotacionRgRpPorPeriodo(
    periodoDesde,
    periodoHasta,
    dotacionTotalAmplio,
  );

  // Tabla chica (1 fila por período/concepto) — sin riesgo de
  // truncamiento de PostgREST, no necesita paginar con `.range()` como
  // sí hacía la versión anterior sobre `payroll_line_items`. Misma
  // ventana amplia — reutilizada por las funciones puras de arriba en vez
  // de 1 query por mes retrocedido.
  const { data: beneficiariosReales } = await supabase
    .from("payroll_beneficiarios_reales")
    .select("periodo, concepto, cantidad")
    .in("concepto", ["anticipo_rg", "anticipo_rp"])
    .gte("periodo", periodoDesdeAmplio.toISOString().slice(0, 10))
    .lte("periodo", periodoHasta.toISOString().slice(0, 10));
  const beneficiariosPorClave = new Map<string, number>();
  for (const fila of beneficiariosReales ?? []) {
    beneficiariosPorClave.set(
      `${fila.concepto}::${fila.periodo}`,
      fila.cantidad,
    );
  }

  const resultado = new Map<string, DotacionPorConceptoPunto>();
  for (const [periodo, rgRp] of dotacionRgRpPorPeriodo) {
    let anticipoRg =
      beneficiariosPorClave.get(`anticipo_rg::${periodo}`) ?? null;
    let anticipoRp =
      beneficiariosPorClave.get(`anticipo_rp::${periodo}`) ?? null;
    if (anticipoRg == null || anticipoRp == null) {
      const [anio, mesNum] = periodo.split("-").map(Number);
      const mesDate = new Date(anio, mesNum - 1, 1);
      const anticipoTotal = dotacionAnticipoDelMesPura(
        dotacionTotalAmplio,
        beneficiariosPorClave,
        mesDate,
      );
      if (anticipoTotal != null) {
        const proporcionRg = proporcionAnticipoRgHistoricaPura(
          beneficiariosPorClave,
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
