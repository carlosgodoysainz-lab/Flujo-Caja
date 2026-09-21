import { sumarMesesAPeriodo } from "./periodo";

/**
 * Recalcula el `acumulado` (dotación absoluta) de una obra después de
 * ediciones manuales — reemplaza a `calcularAcumuladosDesdeSaldoInicial`
 * (eliminada), que anclaba SIEMPRE al snapshot de Buk MÁS RECIENTE (= hoy)
 * y encadenaba desde el primer mes presente en el archivo. Como el export
 * de "Proyección Headcount" trae 12 meses de histórico (ver
 * `export-action.ts`), ese bug se disparaba SIEMPRE, no en un caso borde:
 * el acumulado de un mes pasado quedaba calculado desde la dotación de
 * HOY, y encadenar solo sobre los meses presentes en el archivo ignoraba
 * cualquier mes intermedio no editado (ej. editar ene y mar ignoraba feb).
 *
 * Módulo puro (sin `server-only`), mismo criterio que `periodo.ts`, para
 * poder testearlo sin mockear Supabase.
 */

export interface FilaHeadcountExistente {
  periodo: string; // "YYYY-MM-01"
  variacionNeta: number;
  acumulado: number | null;
  origen: string;
  forecastRunId: string | null;
}

export interface AcumuladoRecalculado {
  periodo: string;
  variacionNeta: number;
  acumulado: number;
  /**
   * `true` solo en los períodos que vienen de `edicionesPorPeriodo` — esos
   * son los únicos que el caller debe escribir con `origen='manual'`. Los
   * demás (`false`) solo cambian su `acumulado` encadenado; preservan su
   * `origen`/`forecastRunId` original (ver `FilaHeadcountExistente`).
   */
  esEdicion: boolean;
}

export interface RecalculoAcumuladoResultado {
  filas: AcumuladoRecalculado[];
  /**
   * No-null cuando no se pudo anclar al acumulado real del mes anterior
   * (hueco en el histórico, o la fila previa nunca tuvo `acumulado`) y se
   * usó el fallback — nunca se cae en silencio al snapshot de hoy.
   */
  advertencia: string | null;
}

/**
 * `edicionesPorPeriodo`: variación neta editada por el usuario, keyed por
 * "YYYY-MM-01" — SOLO los períodos que el usuario realmente cambió (ver
 * `clasificarCeldas` en `parse-headcount-upload.ts`).
 *
 * `saldoInicialFallback`: usado como ancla SOLO si el primer período
 * editado es el primer período conocido de la obra (no hay fila previa
 * de ningún tipo). Nunca se usa como ancla si ya existe historial — en
 * ese caso ancla el `acumulado` real del mes inmediatamente anterior.
 */
export function recalcularAcumuladosObra(
  filasExistentes: FilaHeadcountExistente[],
  edicionesPorPeriodo: Map<string, number>,
  saldoInicialFallback: number,
): RecalculoAcumuladoResultado {
  if (edicionesPorPeriodo.size === 0) return { filas: [], advertencia: null };

  const existentePorPeriodo = new Map(
    filasExistentes.map((f) => [f.periodo, f]),
  );

  const primerPeriodoAfectado = [...edicionesPorPeriodo.keys()].sort()[0];
  const ultimoPeriodoExistente =
    filasExistentes.length > 0
      ? filasExistentes
          .map((f) => f.periodo)
          .sort()
          .at(-1)!
      : null;
  const ultimoPeriodoEditado = [...edicionesPorPeriodo.keys()].sort().at(-1)!;
  const ultimoPeriodo =
    ultimoPeriodoExistente && ultimoPeriodoExistente > ultimoPeriodoEditado
      ? ultimoPeriodoExistente
      : ultimoPeriodoEditado;

  // Ancla: el acumulado real INMEDIATAMENTE ANTES de aplicar la variación
  // del primer período afectado — nunca el snapshot de hoy. Dos fuentes
  // posibles, en este orden:
  //   1. El propio período editado ya tenía una fila (ej. se corrige un mes
  //      intermedio ya existente): su ancla es su propio acumulado ANTES de
  //      su variación vieja (acumulado - variacionNeta) — así no depende de
  //      que exista una fila explícita para "mes - 1".
  //   2. Si el período editado es nuevo (no tenía fila), se usa el
  //      acumulado real del mes calendario anterior.
  // Si ninguna existe y SÍ hay historial previo de la obra (un hueco), se
  // avisa en vez de caer en silencio al saldo inicial.
  const periodoAnterior = sumarMesesAPeriodo(primerPeriodoAfectado, -1);
  const filaPropia = existentePorPeriodo.get(primerPeriodoAfectado);
  const filaAnterior = existentePorPeriodo.get(periodoAnterior);
  let advertencia: string | null = null;
  let acumulado: number;
  const hayHistorialPrevio = filasExistentes.some(
    (f) => f.periodo < primerPeriodoAfectado,
  );
  if (filaPropia?.acumulado != null) {
    acumulado = filaPropia.acumulado - filaPropia.variacionNeta;
  } else if (filaAnterior?.acumulado != null) {
    acumulado = filaAnterior.acumulado;
  } else if (!hayHistorialPrevio) {
    acumulado = saldoInicialFallback;
  } else {
    // Hay historial, pero no se pudo anclar (hueco, o esas filas nunca
    // tuvieron `acumulado`) — se avisa en vez de caer en silencio al saldo
    // inicial.
    acumulado = saldoInicialFallback;
    advertencia = `No se encontró el acumulado real de ${periodoAnterior} para anclar — se usó el saldo inicial de referencia (${saldoInicialFallback}).`;
  }

  const filas: AcumuladoRecalculado[] = [];
  let periodo = primerPeriodoAfectado;
  while (periodo <= ultimoPeriodo) {
    const esEdicion = edicionesPorPeriodo.has(periodo);
    const variacionNeta = esEdicion
      ? edicionesPorPeriodo.get(periodo)!
      : (existentePorPeriodo.get(periodo)?.variacionNeta ?? 0);
    acumulado = Math.max(0, acumulado + variacionNeta);
    filas.push({ periodo, variacionNeta, acumulado, esEdicion });
    periodo = sumarMesesAPeriodo(periodo, 1);
  }

  return { filas, advertencia };
}
