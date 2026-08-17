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
  for (const s of snapshots) {
    const periodo = periodoDeFecha(s.snapshot_date);
    totalPorSnapshot.set(
      periodo,
      (totalPorSnapshot.get(periodo) ?? 0) + s.activos,
    );
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
