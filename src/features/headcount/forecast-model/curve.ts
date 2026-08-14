export interface SnapshotPunto {
  fecha: Date;
  activos: number;
}

export interface PuntoCurva {
  valor: number;
  /**
   * true si NINGUNA obra de referencia tenía dato real de Buk para este
   * mes de avance — `valor` es un placeholder (0 acumulado, sin cambio),
   * NO una estimación real. Hallazgo real de auditoría (13-ago-2026): de
   * 254 filas ya estimadas, 91% tenían variación 0, casi todas por esta
   * razón (el cron de snapshots recién corrió 1 vez, solo 4 de 32 obras
   * elegibles tenían histórico real de referencia) — sin esta bandera,
   * "sin dato" y "0 confirmado" se veían idénticos en la tabla/Excel.
   */
  sinDatoReferencia: boolean;
}

export interface VariacionCurva {
  variacion: number;
  sinDatoReferencia: boolean;
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
 * ignorando los `null` de cada una. Si TODAS son null en un mes, el
 * valor es 0 pero se marca `sinDatoReferencia: true` — antes esto
 * quedaba indistinguible de un 0 real (ver Auto-Blindaje 13-ago-2026).
 */
export function promediarCurvas(
  curvas: (number | null)[][],
  duracion: number,
): PuntoCurva[] {
  const resultado: PuntoCurva[] = [];
  for (let mes = 0; mes < duracion; mes++) {
    const valores = curvas
      .map((c) => c[mes])
      .filter((v): v is number => v != null);
    resultado.push(
      valores.length > 0
        ? {
            valor: Math.round(
              valores.reduce((a, b) => a + b, 0) / valores.length,
            ),
            sinDatoReferencia: false,
          }
        : { valor: 0, sinDatoReferencia: true },
    );
  }
  return resultado;
}

/**
 * Convierte una curva de headcount ABSOLUTO a variación NETA mensual (lo
 * que espera `headcount_by_obra.variacion_neta`). Un delta hereda
 * `sinDatoReferencia: true` si CUALQUIERA de los 2 puntos que lo forman
 * no tenía dato real — el delta tampoco es confiable en ese caso.
 */
export function aVariacionNeta(curvaAbsoluta: PuntoCurva[]): VariacionCurva[] {
  return curvaAbsoluta.map((punto, i) => {
    if (i === 0)
      return {
        variacion: punto.valor,
        sinDatoReferencia: punto.sinDatoReferencia,
      };
    const anterior = curvaAbsoluta[i - 1];
    return {
      variacion: punto.valor - anterior.valor,
      sinDatoReferencia: punto.sinDatoReferencia || anterior.sinDatoReferencia,
    };
  });
}
