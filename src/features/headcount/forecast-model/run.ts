"use server";

import { auth } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { obrasSimilares, type ObraParaSimilitud } from "./similarity";
import {
  aVariacionNeta,
  curvaPorAvance,
  escalarCurva,
  promediarCurvas,
} from "./curve";

export interface RunForecastModelResult {
  estado: "ok" | "error";
  obraId: string;
  obrasReferenciaUsadas: number;
  mesesEstimados: number;
  errores: string[];
}

/**
 * Estima la dotación mensual de una obra sin dato manual, comparándola
 * contra obras históricas similares con curva de dotación real en Buk.
 * Ver TECH-SPEC §3.3 y BLUEPRINT Fase 6 — método heurístico documentado,
 * no ML. Escribe en `headcount_by_obra` (origen='modelo_estimado') y
 * registra la corrida completa en `headcount_forecast_runs` para
 * trazabilidad (qué obras de referencia y qué método se usó).
 */
export async function runForecastModel(
  obraId: string,
): Promise<RunForecastModelResult> {
  const session = await auth();
  const supabase = createServiceClient();
  const errores: string[] = [];

  const { data: obraObjetivo } = await supabase
    .from("obras")
    .select("id, nombre, tipo, unidades, comuna, inicio_obra, dur_obra_meses")
    .eq("id", obraId)
    .single();

  if (!obraObjetivo) {
    return {
      estado: "error",
      obraId,
      obrasReferenciaUsadas: 0,
      mesesEstimados: 0,
      errores: ["Obra no encontrada."],
    };
  }
  if (!obraObjetivo.inicio_obra || !obraObjetivo.dur_obra_meses) {
    return {
      estado: "error",
      obraId,
      obrasReferenciaUsadas: 0,
      mesesEstimados: 0,
      errores: [
        "La obra no tiene fecha de inicio o duración — no se puede indexar la curva por mes de avance.",
      ],
    };
  }

  const { data: todasLasObras } = await supabase
    .from("obras")
    .select("id, nombre, tipo, unidades, comuna, inicio_obra");

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

    const curva = curvaPorAvance(
      puntos,
      new Date(obraRef.inicio_obra),
      obraObjetivo.dur_obra_meses,
    );
    const curvaEscalada = escalarCurva(
      curva,
      referencia.unidades,
      obraObjetivo.unidades,
    );

    if (curvaEscalada.some((v) => v != null)) {
      curvasEscaladas.push(curvaEscalada);
      referenciasUsadas.push(referencia.id);
    }
  }

  if (curvasEscaladas.length === 0) {
    return {
      estado: "error",
      obraId,
      obrasReferenciaUsadas: 0,
      mesesEstimados: 0,
      errores: [
        "Las obras similares encontradas no tienen histórico de Buk todavía (normal si el histórico es reciente) — no hay con qué estimar aún.",
      ],
    };
  }

  const curvaPromedio = promediarCurvas(
    curvasEscaladas,
    obraObjetivo.dur_obra_meses,
  );
  const variacionNeta = aVariacionNeta(curvaPromedio);

  const { data: forecastRun, error: runError } = await supabase
    .from("headcount_forecast_runs")
    .insert({
      obra_id: obraId,
      metodo: "similar_obras_v1",
      obras_referencia: referenciasUsadas,
      parametros: {
        rangoUnidadesPct: 30,
        duracionMeses: obraObjetivo.dur_obra_meses,
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
      errores: [
        `No se pudo registrar la corrida del modelo: ${runError?.message}`,
      ],
    };
  }

  const inicioObra = new Date(obraObjetivo.inicio_obra);
  const filas = variacionNeta.map((variacion, mesIndex) => {
    const periodo = new Date(
      inicioObra.getFullYear(),
      inicioObra.getMonth() + mesIndex,
      1,
    );
    return {
      obra_id: obraId,
      periodo: periodo.toISOString().slice(0, 10),
      variacion_neta: variacion,
      origen: "modelo_estimado" as const,
      forecast_run_id: forecastRun.id,
      created_by: session?.user?.id ?? null,
    };
  });

  const { error: upsertError } = await supabase
    .from("headcount_by_obra")
    .upsert(filas, { onConflict: "obra_id,periodo" });
  if (upsertError)
    errores.push(`Error guardando estimación: ${upsertError.message}`);

  return {
    estado: errores.length > 0 ? "error" : "ok",
    obraId,
    obrasReferenciaUsadas: referenciasUsadas.length,
    mesesEstimados: filas.length,
    errores,
  };
}
