import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

export interface DotacionTotalPunto {
  /** YYYY-MM-01 */
  periodo: string;
  total: number;
  esReal: boolean;
}

/**
 * NOTA sobre fechas: acá se trabaja SIEMPRE con el string "YYYY-MM-DD" tal
 * cual viene de Postgres, nunca con `new Date(dateOnlyString).getMonth()`.
 * Ese patrón es un bug real en timezones detrás de UTC (Chile, UTC-3/-4):
 * `new Date("2026-08-01")` es medianoche UTC, que en hora de Chile cae la
 * noche del 31 de julio — `.getMonth()` devuelve julio, no agosto. Todo el
 * cálculo de "mes de avance" acá es aritmética de string, no de Date.
 */
function periodoDeFecha(fechaStr: string): string {
  return `${fechaStr.slice(0, 7)}-01`;
}

function sumarMesesAPeriodo(periodo: string, n: number): string {
  const [y, m] = periodo.slice(0, 7).split("-").map(Number);
  const totalMeses = y * 12 + (m - 1) + n;
  const yy = Math.floor(totalMeses / 12);
  const mm = (totalMeses % 12) + 1;
  return `${yy}-${String(mm).padStart(2, "0")}-01`;
}

/**
 * Dotación TOTAL mensual de la compañía — la variable "Q" (cantidad) del
 * modelo de Remuneración (costo promedio por cabeza × dotación, ver
 * `formulas.ts`). Reconstruye la curva de "crece al inicio de cada obra,
 * decrece por desvinculaciones hacia el cierre" a nivel agregado:
 *
 * - Meses REALES: suma directa de `buk_dotacion_snapshots.activos` de TODOS
 *   los cargos/obras de ese mes (snapshot real del cron mensual de Buk) —
 *   es la altas−bajas neta que YA ocurrió, no hay que modelarla.
 * - Meses futuros (sin snapshot todavía): se parte del último total REAL
 *   conocido y se acumula, mes a mes, la `variacion_neta` (altas−bajas)
 *   de `headcount_by_obra` sumada a través de TODAS las obras — origen
 *   'manual' (dato cargado a mano), 'buk_real' o 'modelo_estimado' (curva
 *   de obras similares, ver `headcount/forecast-model/run.ts`, que YA
 *   modela el ciclo completo de una obra: sube en el arranque, se estabiliza
 *   en régimen, baja al cierre).
 */
export async function getDotacionTotalPorPeriodo(
  periodoDesde: Date,
  periodoHasta: Date,
): Promise<Map<string, DotacionTotalPunto>> {
  const supabase = createServiceClient();
  const resultado = new Map<string, DotacionTotalPunto>();

  const { data: snapshots } = await supabase
    .from("buk_dotacion_snapshots")
    .select("snapshot_date, activos")
    .order("snapshot_date");

  const totalPorSnapshot = new Map<string, number>();
  for (const s of snapshots ?? []) {
    const periodo = periodoDeFecha(s.snapshot_date);
    totalPorSnapshot.set(
      periodo,
      (totalPorSnapshot.get(periodo) ?? 0) + s.activos,
    );
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
      .gt("periodo", ultimoPeriodoReal);

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
