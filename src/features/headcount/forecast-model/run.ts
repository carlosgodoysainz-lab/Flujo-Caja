"use server";

import { auth } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { obrasSimilares, type ObraParaSimilitud } from "./similarity";
import {
  aplicarCicloDeVida,
  aVariacionNeta,
  curvaPorAvanceConFases,
  escalarCurva,
  interpolarHuecos,
  mesDeCierre,
  promediarCurvas,
} from "./curve";

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

  const { data: todasLasObras } = await supabase
    .from("obras")
    .select(
      "id, nombre, tipo, unidades, comuna, inicio_obra, fin_obra, dur_obra_meses",
    );

  // Mes de cierre REAL de la obra objetivo (ver mesDeCierre) — ancla el
  // punto de "mitad" del modelo a fin_obra en vez de a dur/2 fijo.
  const mesCierreObjetivo = mesDeCierre(
    new Date(obraObjetivo.inicio_obra),
    obraObjetivo.fin_obra ? new Date(obraObjetivo.fin_obra) : null,
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
      fecha: new Date(fecha),
      activos,
    }));

    // Re-indexa por FASE (obra gruesa / terminaciones, ancladas al mes de
    // CIERRE REAL de cada obra — ver curvaPorAvanceConFases/mesDeCierre)
    // en vez de por mes calendario crudo. Usa la duración y el fin_obra
    // PROPIOS de la obra de referencia (si los tiene) para construir su
    // curva real; si no tiene duración cargada, degrada a la del
    // objetivo (mismo comportamiento que antes de este cambio).
    const durObraRef = obraRef.dur_obra_meses ?? obraObjetivo.dur_obra_meses;
    const mesCierreRef = mesDeCierre(
      new Date(obraRef.inicio_obra),
      obraRef.fin_obra ? new Date(obraRef.fin_obra) : null,
      durObraRef,
    );
    const curva = curvaPorAvanceConFases(
      puntos,
      new Date(obraRef.inicio_obra),
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

  const curvaFinal = aplicarCicloDeVida(curvaPromedio, {
    mesCierre: mesCierreObjetivo,
    finFaseObraGruesa,
    maxDeltaPorMes,
  });
  const variacionNeta = aVariacionNeta(curvaFinal);
  const mesesSinDatoReferencia = variacionNeta.filter(
    (v) => v.sinDatoReferencia,
  ).length;

  const { data: forecastRun, error: runError } = await supabase
    .from("headcount_forecast_runs")
    .insert({
      obra_id: obraId,
      metodo: "similar_obras_v3_ciclo_vida",
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

  const inicioObra = new Date(obraObjetivo.inicio_obra);
  const filas = variacionNeta.map((v, mesIndex) => {
    const periodo = new Date(
      inicioObra.getFullYear(),
      inicioObra.getMonth() + mesIndex,
      1,
    );
    return {
      obra_id: obraId,
      periodo: periodo.toISOString().slice(0, 10),
      variacion_neta: v.variacion,
      // Dotación absoluta acumulada de la curva FINAL (ya con arranque +
      // suavizado + cierre aplicados, no la curva promedio cruda) —
      // permite ver "cuánta gente habrá en esta obra" en vez de solo el
      // delta mes a mes (columna `acumulado` existía en el schema desde
      // el inicio, nunca se poblaba — ver Auto-Blindaje 13-ago-2026).
      acumulado: curvaFinal[mesIndex].valor,
      // Distingue "el modelo promedió obras de referencia reales" de
      // "no había ninguna obra de referencia con dato ese mes de avance"
      // — antes ambos casos quedaban como 'modelo_estimado' indistinguibles.
      origen: v.sinDatoReferencia
        ? ("sin_dato_referencia" as const)
        : ("modelo_estimado" as const),
      forecast_run_id: forecastRun.id,
      created_by: session?.user?.id ?? null,
    };
  });

  // Nunca pisar un período que ya tenga dato REAL/manual cargado — bug
  // preexistente que la rampa de cierre agravaba (podía escribir una
  // baja ficticia encima de un mes con dato real de Buk). Este check ya
  // lo hace `estimarDotacionFaltante` (refresh.ts) al filtrar obras
  // completas, pero el botón manual de esta página no.
  const { data: filasProtegidas } = await supabase
    .from("headcount_by_obra")
    .select("periodo")
    .eq("obra_id", obraId)
    .in("origen", ["manual", "buk_real"]);
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
