export interface SnapshotPunto {
  fecha: Date;
  activos: number;
}

function diferenciaEnMeses(desde: Date, hasta: Date): number {
  return (
    (hasta.getFullYear() - desde.getFullYear()) * 12 +
    (hasta.getMonth() - desde.getMonth())
  );
}

/**
 * Convierte una serie de snapshots (fecha calendario) a una curva
 * indexada por "mes de avance de obra" (0 = mes de inicio), NO por fecha
 * calendario — así se pueden comparar/promediar obras que empezaron en
 * fechas distintas. `null` en un índice = sin dato ese mes de avance.
 */
export function curvaPorAvance(
  snapshots: SnapshotPunto[],
  inicioObra: Date,
  durObraMeses: number,
): (number | null)[] {
  const curva: (number | null)[] = new Array(durObraMeses).fill(null);
  for (const s of snapshots) {
    const mes = diferenciaEnMeses(inicioObra, s.fecha);
    if (mes >= 0 && mes < durObraMeses) {
      curva[mes] = s.activos;
    }
  }
  return curva;
}

/** Escala una curva absoluta por la razón de tamaño entre la obra objetivo y la obra de referencia. */
export function escalarCurva(
  curva: (number | null)[],
  unidadesReferencia: number,
  unidadesObjetivo: number,
): (number | null)[] {
  if (!unidadesReferencia) return curva;
  const factor = unidadesObjetivo / unidadesReferencia;
  return curva.map((v) => (v == null ? null : Math.round(v * factor)));
}

/**
 * Promedia N curvas ya escaladas, mes de avance por mes de avance,
 * ignorando los `null` de cada una. Si todas son null en un mes, el
 * resultado es 0 (no hay señal — se documenta en `headcount_forecast_runs`).
 */
export function promediarCurvas(
  curvas: (number | null)[][],
  duracion: number,
): number[] {
  const resultado: number[] = [];
  for (let mes = 0; mes < duracion; mes++) {
    const valores = curvas
      .map((c) => c[mes])
      .filter((v): v is number => v != null);
    resultado.push(
      valores.length > 0
        ? Math.round(valores.reduce((a, b) => a + b, 0) / valores.length)
        : 0,
    );
  }
  return resultado;
}

/** Convierte una curva de headcount ABSOLUTO a variación NETA mensual (lo que espera `headcount_by_obra.variacion_neta`). */
export function aVariacionNeta(curvaAbsoluta: number[]): number[] {
  return curvaAbsoluta.map((v, i) => (i === 0 ? v : v - curvaAbsoluta[i - 1]));
}
