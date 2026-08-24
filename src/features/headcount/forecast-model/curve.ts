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
 * Índice del mes de avance en que la obra CIERRA de verdad — pedido
 * explícito del usuario 24-ago-2026 ("no estás considerando bajas a la
 * fecha de cierre"). Antes el modelo NUNCA leía `finObra`, solo
 * `durObraMeses` (mitad/mitad fijo) — una obra con `finObra` real más
 * temprano que `inicioObra + durObraMeses` (columnas independientes del
 * Excel Gespro, sin relación garantizada entre sí) seguía proyectando
 * dotación hasta el final de `durObraMeses`, sin ninguna baja de cierre.
 *
 * `finObra` solo puede ADELANTAR el cierre dentro del horizonte, NUNCA
 * extenderlo más allá de `durObraMeses - 1` — extenderlo generaría filas
 * de `headcount_by_obra` que `plan-obra-dotacion.ts` no itera (recorta a
 * `durObraMeses`) y desaparecerían silenciosamente del Excel. Sin
 * `finObra`, cae exactamente al comportamiento anterior (`durObraMeses - 1`).
 */
export function mesDeCierre(
  inicioObra: Date,
  finObra: Date | null,
  durObraMeses: number,
): number {
  const ultimoMes = Math.max(durObraMeses - 1, 0);
  if (finObra == null) return ultimoMes;
  const mesesHastaFin = diferenciaEnMeses(inicioObra, finObra);
  return Math.min(Math.max(mesesHastaFin, 0), ultimoMes);
}

/**
 * Igual que `curvaPorAvance`, pero re-indexa la curva de una obra de
 * REFERENCIA al eje de meses de la obra OBJETIVO tratando el ciclo de
 * vida como 2 FASES separadas — obra gruesa (primera mitad hasta el
 * cierre) y terminaciones (segunda mitad hasta el cierre) — en vez de
 * alinear por mes calendario crudo.
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
 *
 * `opciones.mesCierreRef`/`mesCierreObjetivo` (24-ago-2026, ver
 * `mesDeCierre`): mueven el punto de "mitad" real de cada obra a su
 * cierre real en vez de a `dur - 1`. Con el DEFAULT (`mesCierre = dur -
 * 1` para ambas), el resultado es IDÉNTICO byte a byte al de antes de
 * este parámetro — ver test de identidad en `curve.test.ts`. Los meses
 * de la referencia DESPUÉS de su propio cierre (desmovilización que se
 * estiró más de lo esperado) se remapean proporcionalmente a la zona
 * post-cierre del objetivo si existe; si el objetivo no tiene zona
 * post-cierre (el caso default), esos meses simplemente se descartan.
 */
export function curvaPorAvanceConFases(
  snapshots: SnapshotPunto[],
  inicioObraRef: Date,
  durObraRef: number,
  durObraObjetivo: number,
  opciones?: { mesCierreRef?: number; mesCierreObjetivo?: number },
): (number | null)[] {
  const curvaRef = curvaPorAvance(snapshots, inicioObraRef, durObraRef);
  const mesCierreRef = opciones?.mesCierreRef ?? durObraRef - 1;
  const mesCierreObjetivo = opciones?.mesCierreObjetivo ?? durObraObjetivo - 1;
  const mitadRef = Math.ceil((mesCierreRef + 1) / 2);
  const mitadObjetivo = Math.ceil((mesCierreObjetivo + 1) / 2);
  const curvaReindexada: (number | null)[] = new Array(durObraObjetivo).fill(
    null,
  );

  for (let mes = 0; mes < durObraRef; mes++) {
    const valor = curvaRef[mes];
    if (valor == null) continue;

    let mesObjetivo: number;
    if (mes <= mesCierreRef) {
      if (mes < mitadRef) {
        // Fase obra gruesa — reescala la posición dentro de esta fase.
        const fraccion = mitadRef > 0 ? mes / mitadRef : 0;
        mesObjetivo = Math.round(fraccion * mitadObjetivo);
      } else {
        // Fase terminaciones — reescala la posición dentro de esta fase.
        const duracionFaseRef = mesCierreRef + 1 - mitadRef;
        const fraccion =
          duracionFaseRef > 0 ? (mes - mitadRef) / duracionFaseRef : 0;
        const duracionFaseObjetivo = mesCierreObjetivo + 1 - mitadObjetivo;
        mesObjetivo =
          mitadObjetivo + Math.round(fraccion * duracionFaseObjetivo);
      }
    } else {
      // Post-cierre de la referencia — remapea proporcionalmente a la
      // zona post-cierre del objetivo, si existe. Con el default
      // (mesCierreRef = durObraRef - 1), esta rama nunca se ejecuta
      // (mes < durObraRef siempre en el loop).
      const colaRef = durObraRef - 1 - mesCierreRef;
      if (colaRef <= 0) continue;
      const colaObjetivo = durObraObjetivo - 1 - mesCierreObjetivo;
      if (colaObjetivo <= 0) continue;
      const fraccion = (mes - mesCierreRef) / colaRef;
      mesObjetivo = mesCierreObjetivo + Math.round(fraccion * colaObjetivo);
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

/**
 * Interpola linealmente los huecos (`null`) de una curva de avance de UNA
 * obra de referencia, ANTES de `promediarCurvas` — pedido explícito del
 * usuario 24-ago-2026: "considera una curva más realista que sea
 * progresiva". Solo interpola huecos con dato real a AMBOS lados (nunca
 * extrapola cabeza ni cola), y solo si el hueco mide `maxHuecoMeses` o
 * menos (una referencia con 2 snapshots muy separados no debe imponer una
 * recta larga).
 *
 * Causa raíz indirecta del salto abrupto ("Vista Llacolén B": -99 un mes,
 * +90 al siguiente): sin esto, qué obras de referencia aportan dato a
 * `promediarCurvas` cambia de mes a mes (una referencia con dato en el
 * mes 3 y en el mes 9 no aporta nada en el medio) — interpolar estabiliza
 * ese conjunto antes de promediar.
 */
export function interpolarHuecos(
  curva: (number | null)[],
  maxHuecoMeses = 6,
): (number | null)[] {
  const resultado = [...curva];
  let i = 0;
  while (i < resultado.length) {
    if (resultado[i] != null) {
      i++;
      continue;
    }
    const inicioHueco = i;
    while (i < resultado.length && resultado[i] == null) i++;
    const finHueco = i; // exclusivo

    const antes = inicioHueco > 0 ? resultado[inicioHueco - 1] : null;
    const despues = finHueco < resultado.length ? resultado[finHueco] : null;
    if (antes == null || despues == null) continue; // hueco de cabeza/cola
    const largoHueco = finHueco - inicioHueco;
    if (largoHueco > maxHuecoMeses) continue;

    for (let j = inicioHueco; j < finHueco; j++) {
      const fraccion = (j - inicioHueco + 1) / (largoHueco + 1);
      resultado[j] = Math.round(antes + (despues - antes) * fraccion);
    }
  }
  return resultado;
}

/**
 * Limitador de pendiente (slew-rate limiter): cada mes se mueve hacia el
 * valor objetivo pero nunca más de `maxDeltaPorMes`, reconvergiendo en
 * los meses siguientes — nunca se queda "pegado" para siempre. Pedido
 * explícito del usuario 24-ago-2026 ("Vista Llacolén B... debes
 * considerar una curva más realista"). Con `maxDeltaPorMes <= 0`
 * (deshabilitado) o curva vacía, devuelve la curva intacta.
 *
 * El mes 0 nunca se modifica (no hay "mes anterior" del cual acotar el
 * salto) — su valor absoluto ya es la variación neta del primer mes en
 * `aVariacionNeta`.
 */
export function suavizarSaltos(
  curva: PuntoCurva[],
  maxDeltaPorMes: number,
): PuntoCurva[] {
  if (maxDeltaPorMes <= 0 || curva.length === 0) return curva;
  const resultado: PuntoCurva[] = [curva[0]];
  for (let i = 1; i < curva.length; i++) {
    const anterior = resultado[i - 1].valor;
    const objetivo = curva[i].valor;
    const delta = Math.max(
      -maxDeltaPorMes,
      Math.min(maxDeltaPorMes, objetivo - anterior),
    );
    resultado.push({
      valor: anterior + delta,
      sinDatoReferencia: curva[i].sinDatoReferencia,
    });
  }
  return resultado;
}

/**
 * Para obras que recién arrancan: rellena los primeros meses sin dato
 * real con una rampa lineal hacia el primer valor real conocido, y fuerza
 * monotonía NO decreciente desde el inicio hasta el mes de MAYOR
 * headcount dentro de la fase de obra gruesa (`[0, finFaseObraGruesa)`)
 * — garantiza que nunca hay bajas mientras la obra crece hacia su
 * régimen. Pedido explícito del usuario 24-ago-2026: obras como "General
 * Mackenna" no pueden mostrar despidos justo al arrancar.
 *
 * Sin ningún dato real en toda la curva, devuelve la curva intacta
 * (respeta la degradación explícita a `sinDatoReferencia` — nunca
 * inventa una magnitud sin ninguna referencia real).
 */
export function aplicarArranqueDeObra(
  curva: PuntoCurva[],
  finFaseObraGruesa: number,
): PuntoCurva[] {
  const primerIndiceConDato = curva.findIndex((p) => !p.sinDatoReferencia);
  if (primerIndiceConDato === -1) return curva;

  const resultado = curva.map((p) => ({ ...p }));

  // Relleno de arranque: meses antes del primer dato real, rampa lineal.
  const valorPrimerDato = resultado[primerIndiceConDato].valor;
  for (let i = 0; i < primerIndiceConDato; i++) {
    resultado[i] = {
      valor: Math.round(
        (valorPrimerDato * (i + 1)) / (primerIndiceConDato + 1),
      ),
      sinDatoReferencia: false,
    };
  }

  // Monotonía no decreciente hasta el pico de la fase de obra gruesa.
  const indiceFinBusqueda = Math.min(finFaseObraGruesa, resultado.length);
  let mesPico = 0;
  let valorPico = resultado[0].valor;
  for (let i = 1; i < indiceFinBusqueda; i++) {
    if (resultado[i].valor > valorPico) {
      valorPico = resultado[i].valor;
      mesPico = i;
    }
  }
  for (let i = 1; i <= mesPico; i++) {
    if (resultado[i].valor < resultado[i - 1].valor) {
      resultado[i] = { ...resultado[i], valor: resultado[i - 1].valor };
    }
  }

  return resultado;
}

/**
 * Rampa de desmovilización hacia el cierre real de la obra (`mesCierre`,
 * ver `mesDeCierre`) — pedido explícito del usuario 24-ago-2026: obras
 * como "Jorge Edwards" no pueden quedar planas (variación 0 sostenida)
 * hasta el final, deben mostrar bajas progresivas hacia su cierre.
 * `fin_obra` es un dato duro de Gespro, así que "al cerrar la obra la
 * dotación tiende a 0" es inferencia sobre un hecho conocido, no un
 * relleno inventado.
 *
 * Desde el último mes con dato real ANTES o EN `mesCierre`, decrece
 * linealmente hasta 0 exactamente en `mesCierre` (y se mantiene en 0
 * después) — pero NUNCA pisa un mes que ya tenga su propio dato real
 * (una referencia real dice que ahí todavía hay gente, gana el dato).
 * Sin ningún dato real hasta `mesCierre`, devuelve la curva intacta.
 */
export function aplicarCierreDeObra(
  curva: PuntoCurva[],
  mesCierre: number,
): PuntoCurva[] {
  if (curva.length === 0) return curva;
  const mesCierreClamp = Math.min(Math.max(mesCierre, 0), curva.length - 1);

  let m0 = -1;
  for (let i = mesCierreClamp; i >= 0; i--) {
    if (!curva[i].sinDatoReferencia) {
      m0 = i;
      break;
    }
  }
  if (m0 === -1) return curva;

  const resultado = curva.map((p) => ({ ...p }));
  const valorM0 = resultado[m0].valor;
  const tramo = mesCierreClamp + 1 - m0; // >= 1 por construcción

  for (let i = m0 + 1; i < resultado.length; i++) {
    if (!resultado[i].sinDatoReferencia) continue; // nunca pisa dato real
    if (i <= mesCierreClamp) {
      const factor = (mesCierreClamp + 1 - i) / tramo;
      resultado[i] = {
        valor: Math.round(valorM0 * factor),
        sinDatoReferencia: false,
      };
    } else {
      resultado[i] = { valor: 0, sinDatoReferencia: false };
    }
  }
  return resultado;
}

export interface OpcionesCicloDeVida {
  mesCierre: number;
  finFaseObraGruesa: number;
  /** `undefined` o `<= 0` deshabilita el suavizado de saltos. */
  maxDeltaPorMes?: number;
}

/**
 * Orquestador del fix "ciclo de vida" (24-ago-2026): arranque → suavizado
 * → cierre, en ese orden — el cierre va ÚLTIMO para que el limitador de
 * pendiente no aplane la rampa de desmovilización (que ya es suave por
 * construcción, no necesita el limitador).
 */
export function aplicarCicloDeVida(
  curva: PuntoCurva[],
  opciones: OpcionesCicloDeVida,
): PuntoCurva[] {
  const conArranque = aplicarArranqueDeObra(curva, opciones.finFaseObraGruesa);
  const suavizada =
    opciones.maxDeltaPorMes != null && opciones.maxDeltaPorMes > 0
      ? suavizarSaltos(conArranque, opciones.maxDeltaPorMes)
      : conArranque;
  return aplicarCierreDeObra(suavizada, opciones.mesCierre);
}
