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

/**
 * Igual que `curvaPorAvance`, pero re-indexa la curva de una obra de
 * REFERENCIA al eje de meses de la obra OBJETIVO tratando el ciclo de
 * vida como 2 FASES separadas — obra gruesa (primera mitad de la
 * duración) y terminaciones (segunda mitad) — en vez de alinear por mes
 * calendario crudo.
 *
 * Motivo: confirmado empíricamente con datos reales de Buk (14-ago-2026,
 * ver Auto-Blindaje) que "Alto Buzeta" transiciona de obra gruesa a
 * terminaciones exactamente en la mitad de su duración (mes 11 de 22) —
 * el mix de cargo cambia de forma abrupta, no gradual (Enfierrador/
 * Carpintero desaparecen, Pintor/Yesero/Terminaciones aparecen). El
 * usuario confirmó generalizar este patrón a todas las obras ("el resto
 * de las obras tienen el mismo modelo de Buzeta").
 *
 * Sin este re-indexado, comparar dos obras de duración DISTINTA por mes
 * calendario crudo puede mezclar el remate de obra gruesa de una con el
 * inicio de terminaciones de otra en el mismo índice — cada fase se
 * escala por separado (regla de 3 sobre su propia mitad) para que
 * "30% avanzada la fase de terminaciones" de la referencia caiga en
 * "30% avanzada la fase de terminaciones" del objetivo, sin importar que
 * las duraciones totales difieran.
 */
export function curvaPorAvanceConFases(
  snapshots: SnapshotPunto[],
  inicioObraRef: Date,
  durObraRef: number,
  durObraObjetivo: number,
): (number | null)[] {
  const curvaRef = curvaPorAvance(snapshots, inicioObraRef, durObraRef);
  const mitadRef = Math.ceil(durObraRef / 2);
  const mitadObjetivo = Math.ceil(durObraObjetivo / 2);
  const curvaReindexada: (number | null)[] = new Array(durObraObjetivo).fill(
    null,
  );

  for (let mes = 0; mes < durObraRef; mes++) {
    const valor = curvaRef[mes];
    if (valor == null) continue;

    let mesObjetivo: number;
    if (mes < mitadRef) {
      // Fase obra gruesa — reescala la posición dentro de esta fase.
      const fraccion = mitadRef > 0 ? mes / mitadRef : 0;
      mesObjetivo = Math.round(fraccion * mitadObjetivo);
    } else {
      // Fase terminaciones — reescala la posición dentro de esta fase.
      const duracionFaseRef = durObraRef - mitadRef;
      const fraccion =
        duracionFaseRef > 0 ? (mes - mitadRef) / duracionFaseRef : 0;
      const duracionFaseObjetivo = durObraObjetivo - mitadObjetivo;
      mesObjetivo = mitadObjetivo + Math.round(fraccion * duracionFaseObjetivo);
    }

    if (mesObjetivo < 0 || mesObjetivo >= durObraObjetivo) continue;
    const actual = curvaReindexada[mesObjetivo];
    // Si la compresión de fases hace caer 2 meses de referencia en el
    // mismo mes objetivo, se promedian entre sí en vez de que el último
    // pise al primero.
    curvaReindexada[mesObjetivo] =
      actual == null ? valor : Math.round((actual + valor) / 2);
  }

  return curvaReindexada;
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
 * ignorando los `null` de cada una. Si TODAS son null en un mes, se
 * MANTIENE el último valor absoluto conocido (en vez de caer a 0) y se
 * marca `sinDatoReferencia: true` para seguir distinguiéndolo de un 0
 * real (ver Auto-Blindaje 13-ago-2026).
 *
 * Bug real corregido 18-ago-2026: antes el valor caía a 0 en cada mes sin
 * dato de referencia — como `aVariacionNeta` calcula la variación como
 * delta entre valores ABSOLUTOS consecutivos, un mes real rodeado de
 * meses sin dato generaba un salto artificial (ej. "+214" seguido de
 * "-214" al mes siguiente: el 0 fantasma antes y después del dato real),
 * confirmado por el usuario viendo el Excel de Plan de Obra ("no aparece
 * un flujo mensual"). Manteniendo el último valor conocido, el hueco sin
 * dato queda con variación 0 (correcto: no hay información para asumir
 * cambio) y el salto real solo aparece UNA vez, en el mes donde
 * efectivamente hay dato.
 */
export function promediarCurvas(
  curvas: (number | null)[][],
  duracion: number,
): PuntoCurva[] {
  const resultado: PuntoCurva[] = [];
  let ultimoValorConocido = 0;
  for (let mes = 0; mes < duracion; mes++) {
    const valores = curvas
      .map((c) => c[mes])
      .filter((v): v is number => v != null);
    if (valores.length > 0) {
      ultimoValorConocido = Math.round(
        valores.reduce((a, b) => a + b, 0) / valores.length,
      );
      resultado.push({ valor: ultimoValorConocido, sinDatoReferencia: false });
    } else {
      resultado.push({
        valor: ultimoValorConocido,
        sinDatoReferencia: true,
      });
    }
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
