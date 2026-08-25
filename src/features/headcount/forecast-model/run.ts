"use server";

import { auth } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { obrasSimilares, type ObraParaSimilitud } from "./similarity";
import {
  aplicarCicloDeVida,
  aVariacionNeta,
  curvaPorAvance,
  curvaPorAvanceConFases,
  escalarCurva,
  fechaLocalDesdeString,
  interpolarHuecos,
  mesDeCierre,
  METODO_FORECAST_ACTUAL,
  type PuntoCurva,
  promediarCurvas,
} from "./curve";
import {
  periodoDeFecha,
  sumarMesesAPeriodo,
} from "@/features/headcount/services/periodo";

/**
 * Elimina filas HUÉRFANAS de `headcount_by_obra` para una obra —
 * períodos que quedaron FUERA del rango válido actual
 * `[inicio_obra, inicio_obra + dur_obra_meses)`. Bug real corregido
 * 25-ago-2026, encontrado por la auditoría automatizada (Fase 12), no
 * por reporte manual del usuario: cuando Gespro actualiza `inicio_obra`
 * de una obra (el plan de obra se corre en el tiempo) o cuando una obra
 * pasa de estimarse por similitud a usar su propio histórico real de Buk
 * (ver `intentarUsarSnapshotPropio`), el `upsert` (onConflict
 * "obra_id,periodo") solo escribe/actualiza los períodos del rango
 * NUEVO — nunca borra los del rango VIEJO que ya no corresponden,
 * dejándolos huérfanos para siempre. Confirmado en 14 obras reales tras
 * el refresh de hoy (ej. "Vista Llacolén B" tenía 25 filas para una
 * duración de 24 meses — un mes 2025-07 huérfano de un cálculo anterior
 * a que Gespro corrigiera su `inicio_obra` a 2025-08). NUNCA borra filas
 * `origen='manual'`.
 */
async function limpiarFilasHuerfanas(
  supabase: ReturnType<typeof createServiceClient>,
  obraId: string,
  periodoDesdeValido: string,
  periodoHastaValido: string,
): Promise<void> {
  await supabase
    .from("headcount_by_obra")
    .delete()
    .eq("obra_id", obraId)
    .neq("origen", "manual")
    .or(`periodo.lt.${periodoDesdeValido},periodo.gt.${periodoHastaValido}`);
}

/**
 * Curva REAL de la obra objetivo (no de una obra "similar"), indexada por
 * mes de avance — `null` en un mes = sin snapshot real propio ese mes.
 * `null` la función completa si la obra no tiene NINGÚN snapshot propio,
 * o si todos caen fuera de su rango de avance (caso real "General
 * Mackenna 1": 148 snapshots de 2018-2023, todos anteriores a su propio
 * `inicio_obra` 2028-02-01 — `curvaPorAvance` ya los descarta).
 *
 * Pedido implícito confirmado con datos reales 25-ago-2026: "Matilde
 * Throup" tiene 418 snapshots reales propios (167 personas, crecimiento
 * real documentado desde may-2025) pero el modelo nunca los usaba, solo
 * miraba obras similares (`obrasSimilares` excluye explícitamente la
 * obra objetivo de sí misma, ver `similarity.ts`).
 */
async function obtenerCurvaRealPropia(
  supabase: ReturnType<typeof createServiceClient>,
  obraObjetivo: { id: string; inicio_obra: string; dur_obra_meses: number },
): Promise<(number | null)[] | null> {
  const { data: snapshots } = await supabase
    .from("buk_dotacion_snapshots")
    .select("snapshot_date, activos")
    .eq("obra_id", obraObjetivo.id);

  if (!snapshots || snapshots.length === 0) return null;

  const activosPorFecha = new Map<string, number>();
  for (const s of snapshots) {
    activosPorFecha.set(
      s.snapshot_date,
      (activosPorFecha.get(s.snapshot_date) ?? 0) + s.activos,
    );
  }
  const puntos = [...activosPorFecha.entries()].map(([fecha, activos]) => ({
    fecha: fechaLocalDesdeString(fecha),
    activos,
  }));

  const inicioObraLocal = fechaLocalDesdeString(obraObjetivo.inicio_obra);
  const curva = curvaPorAvance(
    puntos,
    inicioObraLocal,
    obraObjetivo.dur_obra_meses,
  );
  return curva.every((v) => v == null) ? null : curva;
}

/**
 * Fallback para cuando NO existe ninguna obra similar utilizable (0
 * referencias, o ninguna con histórico de Buk) pero la obra objetivo SÍ
 * tiene su propio histórico real — escribe solo con ese dato real, sin
 * ninguna proyección de similitud posible (no hay con qué). Reutiliza
 * `promediarCurvas([curvaPropia], dur)` como mecanismo ya probado de
 * "mantener último valor conocido + marcar sinDatoReferencia" — con 1
 * sola curva, el "promedio" es exactamente la curva propia.
 */
async function escribirSoloDatoReal(
  supabase: ReturnType<typeof createServiceClient>,
  obraObjetivo: { id: string; inicio_obra: string; dur_obra_meses: number },
  curvaPropia: (number | null)[],
  inicioObraPeriodo: string,
  session: { user?: { id?: string | null } | null } | null,
): Promise<RunForecastModelResult> {
  const curvaFinal = promediarCurvas(
    [curvaPropia],
    obraObjetivo.dur_obra_meses,
  );
  const variacionNeta = aVariacionNeta(curvaFinal);
  const mesesSinDatoReferencia = variacionNeta.filter(
    (v) => v.sinDatoReferencia,
  ).length;

  const filas = variacionNeta.map((v, mesIndex) => ({
    obra_id: obraObjetivo.id,
    periodo: sumarMesesAPeriodo(inicioObraPeriodo, mesIndex),
    variacion_neta: v.variacion,
    acumulado: curvaFinal[mesIndex].valor,
    origen: v.sinDatoReferencia
      ? ("sin_dato_referencia" as const)
      : ("buk_real" as const),
    forecast_run_id: null,
    created_by: session?.user?.id ?? null,
  }));

  const { data: filasManuales } = await supabase
    .from("headcount_by_obra")
    .select("periodo")
    .eq("obra_id", obraObjetivo.id)
    .eq("origen", "manual");
  const periodosProtegidos = new Set(
    (filasManuales ?? []).map((f) => f.periodo),
  );
  const filasAEscribir = filas.filter(
    (f) => !periodosProtegidos.has(f.periodo),
  );

  const errores: string[] = [];
  if (filasAEscribir.length > 0) {
    const { error: upsertError } = await supabase
      .from("headcount_by_obra")
      .upsert(filasAEscribir, { onConflict: "obra_id,periodo" });
    if (upsertError)
      errores.push(`Error guardando dato real propio: ${upsertError.message}`);
  }
  await limpiarFilasHuerfanas(
    supabase,
    obraObjetivo.id,
    inicioObraPeriodo,
    sumarMesesAPeriodo(inicioObraPeriodo, obraObjetivo.dur_obra_meses - 1),
  );

  return {
    estado: errores.length > 0 ? "error" : "ok",
    obraId: obraObjetivo.id,
    obrasReferenciaUsadas: 0,
    mesesEstimados: filasAEscribir.length,
    mesesSinDatoReferencia,
    errores,
  };
}

export interface RunForecastModelResult {
  estado: "ok" | "error";
  obraId: string;
  obrasReferenciaUsadas: number;
  mesesEstimados: number;
  /** De `mesesEstimados`, cuántos quedaron sin ninguna obra de referencia con dato real ese mes de avance (origen='sin_dato_referencia', ver curve.ts). */
  mesesSinDatoReferencia: number;
  errores: string[];
}

/**
 * Estima la dotación mensual de una obra sin dato manual, comparándola
 * contra obras históricas similares con curva de dotación real en Buk.
 * Ver TECH-SPEC §3.3 y BLUEPRINT Fase 6 — método heurístico documentado,
 * no ML. Escribe en `headcount_by_obra` (origen='modelo_estimado') y
 * registra la corrida completa en `headcount_forecast_runs` para
 * trazabilidad (qué obras de referencia y qué método se usó).
 *
 * v2 (14-ago-2026): las curvas de referencia se re-indexan por FASE
 * (obra gruesa = 1ra mitad de la duración, terminaciones = 2da mitad —
 * ver `curvaPorAvanceConFases`) en vez de por mes calendario crudo,
 * confirmado con datos reales ("Alto Buzeta" transiciona justo a la
 * mitad de su duración) y generalizado a todas las obras por indicación
 * explícita del usuario.
 *
 * v3 "ciclo de vida" (24-ago-2026, pedido explícito del usuario tras ver
 * el Excel en vivo — "Jorge Edwards" quedaba plana hasta el final sin
 * bajas de cierre, "Vista Llacolén B" saltaba -99/+90 de un mes a otro,
 * "General Mackenna" podía mostrar despidos justo al arrancar): el mes
 * de "mitad" de cada obra pasa a anclarse a su `fin_obra` real (ver
 * `mesDeCierre`) en vez de a `dur_obra_meses/2` fijo; las curvas de
 * referencia se interpolan (`interpolarHuecos`) antes de promediarse; y
 * la curva final pasa por `aplicarCicloDeVida` (arranque sin bajas +
 * suavizado de saltos + rampa de desmovilización hacia el cierre) antes
 * de convertirse a variación neta. Impacto esperado y DESEADO (confirmado
 * por el usuario): la dotación total de la compañía —y por lo tanto el
 * flujo de caja que la usa como input— se ajusta a la baja en los meses
 * donde antes una obra ya cerrada seguía "plana" en vez de bajar a 0.
 *
 * v5 "real + similitud combinados" (25-ago-2026, 2da vuelta — bug real
 * reportado por el usuario viendo el Excel: "Lira Parque pusiste 59 y 45
 * [personas]... estaba mejor antes", "Jorge Edwards" y "Matilde Throup"
 * en cero total): la v4 (`intentarUsarSnapshotPropio`) usaba el dato real
 * propio como REEMPLAZO COMPLETO de la estimación por similitud — una
 * obra con solo 1-2 meses de histórico real (todo Buk real es "hasta
 * hoy", nunca futuro) quedaba con el resto de su vida útil entera en
 * `sin_dato_referencia`/0, justo la proyección que este reporte existe
 * para dar. Ahora el dato real propio se SUPERPONE mes a mes sobre la
 * curva de similitud (con ciclo de vida completo) en vez de reemplazarla:
 * real donde existe (`origen='buk_real'`, nunca tocado por el modelo),
 * estimación por similitud donde no. Si NO hay ninguna obra similar
 * utilizable, cae al fallback anterior (`escribirSoloDatoReal`: solo
 * dato real, sin proyección — no hay con qué proyectar).
 */
export async function runForecastModel(
  obraId: string,
): Promise<RunForecastModelResult> {
  const session = await auth();
  const supabase = createServiceClient();
  const errores: string[] = [];

  const { data: obraObjetivo } = await supabase
    .from("obras")
    .select(
      "id, nombre, tipo, unidades, comuna, inicio_obra, fin_obra, dur_obra_meses",
    )
    .eq("id", obraId)
    .single();

  if (!obraObjetivo) {
    return {
      estado: "error",
      obraId,
      obrasReferenciaUsadas: 0,
      mesesEstimados: 0,
      mesesSinDatoReferencia: 0,
      errores: ["Obra no encontrada."],
    };
  }
  if (!obraObjetivo.inicio_obra || !obraObjetivo.dur_obra_meses) {
    return {
      estado: "error",
      obraId,
      obrasReferenciaUsadas: 0,
      mesesEstimados: 0,
      mesesSinDatoReferencia: 0,
      errores: [
        "La obra no tiene fecha de inicio o duración — no se puede indexar la curva por mes de avance.",
      ],
    };
  }

  const inicioObraPeriodo = periodoDeFecha(obraObjetivo.inicio_obra);

  // Real gana sobre fórmula: se calcula la curva real propia (si existe)
  // para SUPERPONERLA después sobre la estimación por similitud, mes a
  // mes — nunca como reemplazo completo (ver Auto-Blindaje 25-ago-2026,
  // 2da vuelta, casos "Lira Parque"/"Jorge Edwards"/"Matilde Throup").
  const curvaPropia = await obtenerCurvaRealPropia(supabase, obraObjetivo);

  const { data: todasLasObras } = await supabase
    .from("obras")
    .select(
      "id, nombre, tipo, unidades, comuna, inicio_obra, fin_obra, dur_obra_meses",
    );

  // Mes de cierre REAL de la obra objetivo (ver mesDeCierre) — ancla el
  // punto de "mitad" del modelo a fin_obra en vez de a dur/2 fijo.
  // `fechaLocalDesdeString` (nunca `new Date(str)` directo) — bug real
  // corregido 25-ago-2026: `inicio_obra` siempre es día "01", y en un
  // timezone detrás de UTC el parseo directo corría el mes hacia atrás.
  const mesCierreObjetivo = mesDeCierre(
    fechaLocalDesdeString(obraObjetivo.inicio_obra),
    obraObjetivo.fin_obra ? fechaLocalDesdeString(obraObjetivo.fin_obra) : null,
    obraObjetivo.dur_obra_meses,
  );
  const finFaseObraGruesa = Math.ceil((mesCierreObjetivo + 1) / 2);

  const objetivoParaSimilitud: ObraParaSimilitud = {
    id: obraObjetivo.id,
    nombre: obraObjetivo.nombre,
    tipo: obraObjetivo.tipo,
    unidades: obraObjetivo.unidades,
    comuna: obraObjetivo.comuna,
  };
  const referencias = obrasSimilares(
    objetivoParaSimilitud,
    (todasLasObras ?? []).map((o) => ({
      id: o.id,
      nombre: o.nombre,
      tipo: o.tipo,
      unidades: o.unidades,
      comuna: o.comuna,
    })),
  );

  if (referencias.length === 0) {
    if (curvaPropia) {
      return escribirSoloDatoReal(
        supabase,
        obraObjetivo,
        curvaPropia,
        inicioObraPeriodo,
        session,
      );
    }
    return {
      estado: "error",
      obraId,
      obrasReferenciaUsadas: 0,
      mesesEstimados: 0,
      mesesSinDatoReferencia: 0,
      errores: [
        "No se encontraron obras similares (mismo tipo, unidades ±30%) con datos para comparar.",
      ],
    };
  }

  const curvasEscaladas: (number | null)[][] = [];
  const referenciasUsadas: string[] = [];

  for (const referencia of referencias) {
    const obraRef = todasLasObras?.find((o) => o.id === referencia.id);
    if (!obraRef?.inicio_obra || !referencia.unidades || !obraObjetivo.unidades)
      continue;

    const { data: snapshots } = await supabase
      .from("buk_dotacion_snapshots")
      .select("snapshot_date, activos")
      .eq("obra_id", referencia.id);

    if (!snapshots || snapshots.length === 0) continue;

    // Sumar activos de todos los cargos por fecha (un snapshot = 1 fila por cargo)
    const activosPorFecha = new Map<string, number>();
    for (const s of snapshots) {
      activosPorFecha.set(
        s.snapshot_date,
        (activosPorFecha.get(s.snapshot_date) ?? 0) + s.activos,
      );
    }
    const puntos = [...activosPorFecha.entries()].map(([fecha, activos]) => ({
      fecha: fechaLocalDesdeString(fecha),
      activos,
    }));

    // Re-indexa por FASE (obra gruesa / terminaciones, ancladas al mes de
    // CIERRE REAL de cada obra — ver curvaPorAvanceConFases/mesDeCierre)
    // en vez de por mes calendario crudo. Usa la duración y el fin_obra
    // PROPIOS de la obra de referencia (si los tiene) para construir su
    // curva real; si no tiene duración cargada, degrada a la del
    // objetivo (mismo comportamiento que antes de este cambio).
    const durObraRef = obraRef.dur_obra_meses ?? obraObjetivo.dur_obra_meses;
    const inicioObraRefLocal = fechaLocalDesdeString(obraRef.inicio_obra);
    const mesCierreRef = mesDeCierre(
      inicioObraRefLocal,
      obraRef.fin_obra ? fechaLocalDesdeString(obraRef.fin_obra) : null,
      durObraRef,
    );
    const curva = curvaPorAvanceConFases(
      puntos,
      inicioObraRefLocal,
      durObraRef,
      obraObjetivo.dur_obra_meses,
      { mesCierreRef, mesCierreObjetivo },
    );
    const curvaEscalada = escalarCurva(
      curva,
      referencia.unidades,
      obraObjetivo.unidades,
    );
    // Interpola huecos ANTES de promediar — estabiliza qué obras de
    // referencia aportan dato cada mes (causa raíz indirecta de saltos
    // como "Vista Llacolén B": -99 un mes, +90 al siguiente).
    const curvaInterpolada = interpolarHuecos(curvaEscalada);

    if (curvaInterpolada.some((v) => v != null)) {
      curvasEscaladas.push(curvaInterpolada);
      referenciasUsadas.push(referencia.id);
    }
  }

  if (curvasEscaladas.length === 0) {
    if (curvaPropia) {
      return escribirSoloDatoReal(
        supabase,
        obraObjetivo,
        curvaPropia,
        inicioObraPeriodo,
        session,
      );
    }
    return {
      estado: "error",
      obraId,
      obrasReferenciaUsadas: 0,
      mesesEstimados: 0,
      mesesSinDatoReferencia: 0,
      errores: [
        "Las obras similares encontradas no tienen histórico de Buk todavía (normal si el histórico es reciente) — no hay con qué estimar aún.",
      ],
    };
  }

  const curvaPromedio = promediarCurvas(
    curvasEscaladas,
    obraObjetivo.dur_obra_meses,
  );

  // Cap dinámico del limitador de saltos, relativo al pico de la curva
  // promedio (25%, con un piso de 3 personas) — evita que una obra chica
  // quede con un cap absurdamente bajo o una obra grande con uno
  // absurdamente alto. Guardado en `parametros` para poder ajustarlo sin
  // tocar código si el usuario lo ve muy suave o muy brusco.
  const pico = Math.max(0, ...curvaPromedio.map((p) => p.valor));
  const maxDeltaPorMes = Math.max(3, Math.round(0.25 * pico));

  const curvaCicloDeVida = aplicarCicloDeVida(curvaPromedio, {
    mesCierre: mesCierreObjetivo,
    finFaseObraGruesa,
    maxDeltaPorMes,
  });

  // Real gana sobre fórmula: superpone el dato real propio (si existe)
  // encima de la estimación por similitud, mes a mes — el dato real
  // nunca se toca ni se suaviza, solo se usa para los meses donde el
  // modelo no tiene ningún real propio con qué reemplazarlo.
  const curvaFinal: PuntoCurva[] = curvaCicloDeVida.map((punto, i) => {
    const real = curvaPropia?.[i];
    return real != null ? { valor: real, sinDatoReferencia: false } : punto;
  });
  const variacionNeta = aVariacionNeta(curvaFinal);
  const mesesSinDatoReferencia = variacionNeta.filter(
    (v, i) => v.sinDatoReferencia && curvaPropia?.[i] == null,
  ).length;

  const { data: forecastRun, error: runError } = await supabase
    .from("headcount_forecast_runs")
    .insert({
      obra_id: obraId,
      metodo: METODO_FORECAST_ACTUAL,
      obras_referencia: referenciasUsadas,
      parametros: {
        rangoUnidadesPct: 30,
        duracionMeses: obraObjetivo.dur_obra_meses,
        finObra: obraObjetivo.fin_obra,
        mesCierre: mesCierreObjetivo,
        finFaseObraGruesa,
        maxDeltaPorMes,
      },
      ejecutado_por: session?.user?.id ?? null,
    })
    .select("id")
    .single();

  if (runError || !forecastRun) {
    return {
      estado: "error",
      obraId,
      obrasReferenciaUsadas: referenciasUsadas.length,
      mesesEstimados: 0,
      mesesSinDatoReferencia: 0,
      errores: [
        `No se pudo registrar la corrida del modelo: ${runError?.message}`,
      ],
    };
  }

  // Aritmética de período por STRING, nunca por `Date` (ver periodo.ts) —
  // bug real corregido 25-ago-2026: `new Date(inicioObra).getMonth()`
  // corría 1 mes hacia atrás en este timezone, dejando la primera fila de
  // CADA obra con un período anterior a su propio `inicio_obra` real.
  const filas = variacionNeta.map((v, mesIndex) => {
    const periodo = sumarMesesAPeriodo(inicioObraPeriodo, mesIndex);
    const esReal = curvaPropia?.[mesIndex] != null;
    return {
      obra_id: obraId,
      periodo,
      variacion_neta: v.variacion,
      // Dotación absoluta acumulada de la curva FINAL (real donde existe,
      // ciclo de vida estimado donde no — ver merge arriba). Columna
      // `acumulado` existía en el schema desde el inicio, nunca se
      // poblaba — ver Auto-Blindaje 13-ago-2026.
      acumulado: curvaFinal[mesIndex].valor,
      // 'buk_real': dato real propio, gana sobre cualquier estimación.
      // 'modelo_estimado'/'sin_dato_referencia': distingue "el modelo
      // promedió obras de referencia reales" de "no había ninguna obra
      // de referencia con dato ese mes de avance".
      origen: esReal
        ? ("buk_real" as const)
        : v.sinDatoReferencia
          ? ("sin_dato_referencia" as const)
          : ("modelo_estimado" as const),
      // Los meses con dato real propio no son una corrida de MODELO —
      // no llevan forecast_run_id (mismo criterio que escribirSoloDatoReal).
      forecast_run_id: esReal ? null : forecastRun.id,
      created_by: session?.user?.id ?? null,
    };
  });

  // Nunca pisar un período cargado a mano — el propio merge de arriba ya
  // decide dónde va dato real vs. estimado en esta misma corrida, así que
  // 'buk_real' ya NO se protege acá (antes sí, cuando venía de una corrida
  // SEPARADA de `intentarUsarSnapshotPropio`).
  const { data: filasProtegidas } = await supabase
    .from("headcount_by_obra")
    .select("periodo")
    .eq("obra_id", obraId)
    .eq("origen", "manual");
  const periodosProtegidos = new Set(
    (filasProtegidas ?? []).map((f) => f.periodo),
  );
  const filasAEscribir = filas.filter(
    (f) => !periodosProtegidos.has(f.periodo),
  );

  if (filasAEscribir.length > 0) {
    const { error: upsertError } = await supabase
      .from("headcount_by_obra")
      .upsert(filasAEscribir, { onConflict: "obra_id,periodo" });
    if (upsertError)
      errores.push(`Error guardando estimación: ${upsertError.message}`);
  }
  await limpiarFilasHuerfanas(
    supabase,
    obraId,
    inicioObraPeriodo,
    sumarMesesAPeriodo(inicioObraPeriodo, obraObjetivo.dur_obra_meses - 1),
  );

  return {
    estado: errores.length > 0 ? "error" : "ok",
    obraId,
    obrasReferenciaUsadas: referenciasUsadas.length,
    // Solo los meses efectivamente escritos (excluye los protegidos por
    // ya tener dato manual/real de Buk — ver filasAEscribir arriba).
    mesesEstimados: filasAEscribir.length,
    mesesSinDatoReferencia,
    errores,
  };
}
