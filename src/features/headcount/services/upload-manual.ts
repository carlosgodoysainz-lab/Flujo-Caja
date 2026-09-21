"use server";

import { auth } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import {
  parseHeadcountUpload,
  diffContraBaseDeDatos,
} from "./parse-headcount-upload";
import {
  recalcularAcumuladosObra,
  type FilaHeadcountExistente,
} from "./acumulado";

/**
 * Tope de seguridad SOLO para modo compatibilidad (archivo sin la hoja
 * técnica `_fcn_baseline` — descargado antes del fix del 21-sep-2026): si
 * el diff contra la base de datos encuentra más celdas distintas que esto,
 * ya no es plausible que sean "ediciones puntuales" — lo más probable es
 * que el modelo haya corrido entre la descarga y la subida (ver
 * `estimarDotacionFaltante` en `refresh.ts`, que re-estima obras en cada
 * refresh). Se bloquea en vez de fosilizar la grilla otra vez. Temporal
 * por diseño: cuando ya no circulen archivos pre-fix, este tope deja de
 * ser necesario.
 */
const MAX_CELDAS_MODO_COMPATIBILIDAD = 60;

export interface DetalleObraPreview {
  obra: string;
  cambios: { periodo: string; anterior: number | null; nuevo: number }[];
}

export interface HeadcountUploadResult {
  estado: "preview" | "ok" | "parcial" | "error";
  /** Solo relevante después de confirmar (`estado` ok/parcial/error). */
  celdasGuardadas: number;
  errores: string[];
  advertencias: string[];
  // --- Campos de preview (poblados solo cuando estado === "preview") ---
  detallePreview?: DetalleObraPreview[];
  celdasEditadas?: number;
  celdasSinCambios?: number;
  obrasAfectadas?: number;
  modoCompatibilidad?: boolean;
  generadoEnArchivo?: string | null;
}

const RESULTADO_VACIO: HeadcountUploadResult = {
  estado: "error",
  celdasGuardadas: 0,
  errores: [],
  advertencias: [],
};

/**
 * Server Action: sube el Excel "Proyección Headcount" ya editado — dos
 * pasos según `formData.get("confirmar")`:
 *
 * 1. **Análisis** (sin `confirmar`, no escribe nada): parsea, clasifica
 *    qué celdas son ediciones reales (ver `clasificarCeldas` en
 *    `parse-headcount-upload.ts` — el fix del bug real donde CUALQUIER
 *    celda con dato, incluidas las del modelo o de Buk, se marcaba como
 *    editada al re-subir, ver Auto-Blindaje 21-sep-2026) y devuelve
 *    `estado: "preview"` con el detalle para que el usuario confirme.
 * 2. **Confirmado** (`confirmar=1`): re-parsea (el archivo se vuelve a
 *    enviar; barato, evita guardar estado en el servidor) y escribe. Solo
 *    las celdas EDITADAS quedan como `origen='manual'` — el resto de la
 *    grilla sigue su curso normal (Buk real → modelo → sin dato).
 *
 * Nunca falla en silencio: siempre reporta cuántas celdas se detectaron/
 * guardaron y la lista completa de errores/advertencias de fila.
 */
export async function subirHeadcountManual(
  _prev: HeadcountUploadResult | null,
  formData: FormData,
): Promise<HeadcountUploadResult> {
  const session = await auth();
  const supabase = createServiceClient();

  const archivo = formData.get("archivo");
  if (!(archivo instanceof File) || archivo.size === 0) {
    return {
      ...RESULTADO_VACIO,
      errores: ["No se recibió ningún archivo (.xlsx)."],
    };
  }
  const confirmado = formData.get("confirmar") === "1";

  try {
    const buffer = await archivo.arrayBuffer();

    const { data: obras } = await supabase.from("obras").select("id, nombre");
    const obrasConocidas = new Map(
      (obras ?? []).map((o) => [o.id, o.nombre as string]),
    );

    const {
      celdas: candidatas,
      errores: erroresParseo,
      advertenciasNombre,
      baselinePresente,
      generadoEnArchivo,
      celdasSinCambios,
      celdasBorradas,
    } = await parseHeadcountUpload(buffer, obrasConocidas);

    const erroresFormateados = erroresParseo.map(
      (e) => `${e.obra}${e.periodo ? ` (${e.periodo})` : ""}: ${e.motivo}`,
    );
    const advertenciasFormateadas = advertenciasNombre.map(
      (a) =>
        `Obra ID ${a.obraId}: el nombre en el archivo ("${a.nombreEnArchivo}") no coincide con el nombre real ("${a.nombreReal}") — se usó el ID, no el nombre.`,
    );
    for (const b of celdasBorradas) {
      advertenciasFormateadas.push(
        `${b.obra} (${b.periodo.slice(0, 7)}): dejaste la celda en blanco — antes tenía ${b.valorAnterior}. Borrar no se interpreta como 0; si quieres cero, escribe 0. No se cambió nada en ese mes.`,
      );
    }

    if (candidatas.length === 0) {
      return {
        estado: "error",
        celdasGuardadas: 0,
        errores:
          erroresFormateados.length > 0
            ? erroresFormateados
            : baselinePresente
              ? [
                  "No editaste ninguna celda — el archivo coincide exactamente con lo que ya descargaste.",
                ]
              : ["El archivo no tiene ninguna celda de mes con un valor."],
        advertencias: advertenciasFormateadas,
      };
    }

    const obraIds = [...new Set(candidatas.map((c) => c.obraId))];

    // Historial completo de las obras afectadas — necesario tanto para el
    // diff de modo compatibilidad como para anclar el `acumulado` de cada
    // obra (ver `recalcularAcumuladosObra`).
    const { data: filasExistentesRaw } = await supabase
      .from("headcount_by_obra")
      .select(
        "obra_id, periodo, variacion_neta, acumulado, origen, forecast_run_id, created_by",
      )
      .in("obra_id", obraIds);

    const variacionExistentePorClave = new Map<string, number>(
      (filasExistentesRaw ?? []).map((f) => [
        `${f.obra_id}::${f.periodo}`,
        f.variacion_neta,
      ]),
    );

    let edicionesFinal = candidatas;
    const modoCompatibilidad = !baselinePresente;
    if (modoCompatibilidad) {
      edicionesFinal = diffContraBaseDeDatos(
        candidatas,
        variacionExistentePorClave,
      );
      if (edicionesFinal.length > MAX_CELDAS_MODO_COMPATIBILIDAD) {
        return {
          estado: "error",
          celdasGuardadas: 0,
          errores: [
            `Este archivo se descargó antes de la última actualización y no trae la marca que permite saber con certeza qué editaste. Comparado contra los datos actuales, hay ${edicionesFinal.length} celdas distintas — demasiadas para ser ediciones puntuales (es probable que el modelo haya cambiado después de que lo descargaste). Vuelve a descargar el Excel desde /reporte, rehaz tus ediciones y súbelo de nuevo.`,
          ],
          advertencias: advertenciasFormateadas,
        };
      }
    }

    // Saldo inicial real de Buk por obra — ancla el `acumulado` SOLO
    // cuando una obra no tiene ningún historial previo en
    // `headcount_by_obra` (ver `recalcularAcumuladosObra`). Con historial,
    // el ancla real es el mes anterior, nunca este snapshot de "hoy".
    const { data: snapshots } = await supabase
      .from("buk_dotacion_snapshots")
      .select("obra_id, snapshot_date, activos")
      .in("obra_id", obraIds);
    const maxFechaPorObra = new Map<string, string>();
    for (const s of snapshots ?? []) {
      if (!s.obra_id) continue;
      const actual = maxFechaPorObra.get(s.obra_id);
      if (!actual || s.snapshot_date > actual)
        maxFechaPorObra.set(s.obra_id, s.snapshot_date);
    }
    const saldoInicialPorObra = new Map<string, number>();
    for (const s of snapshots ?? []) {
      if (!s.obra_id) continue;
      if (s.snapshot_date !== maxFechaPorObra.get(s.obra_id)) continue;
      saldoInicialPorObra.set(
        s.obra_id,
        (saldoInicialPorObra.get(s.obra_id) ?? 0) + s.activos,
      );
    }

    const filasExistentesPorObra = new Map<string, FilaHeadcountExistente[]>();
    for (const f of filasExistentesRaw ?? []) {
      if (!filasExistentesPorObra.has(f.obra_id))
        filasExistentesPorObra.set(f.obra_id, []);
      filasExistentesPorObra.get(f.obra_id)!.push({
        periodo: f.periodo,
        variacionNeta: f.variacion_neta,
        acumulado: f.acumulado,
        origen: f.origen,
        forecastRunId: f.forecast_run_id,
      });
    }
    // Metadata (origen/forecast_run_id/created_by) de cada fila existente,
    // para preservarla en las filas que solo cambian de `acumulado`.
    const metadataExistentePorClave = new Map(
      (filasExistentesRaw ?? []).map((f) => [
        `${f.obra_id}::${f.periodo}`,
        {
          origen: f.origen as string,
          forecastRunId: f.forecast_run_id as string | null,
          createdBy: f.created_by as string | null,
        },
      ]),
    );

    const edicionesPorObra = new Map<string, Map<string, number>>();
    for (const c of edicionesFinal) {
      if (!edicionesPorObra.has(c.obraId))
        edicionesPorObra.set(c.obraId, new Map());
      edicionesPorObra.get(c.obraId)!.set(c.periodo, c.variacionNeta);
    }

    const detallePreview: DetalleObraPreview[] = [];
    const filasEdicion: {
      obra_id: string;
      periodo: string;
      variacion_neta: number;
      acumulado: number;
      origen: "manual";
      forecast_run_id: null;
      created_by: string | null;
    }[] = [];
    const filasSoloAcumulado: {
      obra_id: string;
      periodo: string;
      variacion_neta: number;
      acumulado: number;
      origen: string;
      forecast_run_id: string | null;
      created_by: string | null;
    }[] = [];
    let acumuladosRecalculados = 0;

    for (const [obraId, edicionesPeriodo] of edicionesPorObra) {
      if (!saldoInicialPorObra.has(obraId)) {
        advertenciasFormateadas.push(
          `Obra ID ${obraId}: sin ningún snapshot propio de Buk — se asumió saldo inicial 0 solo si es el primer mes con dato de la obra.`,
        );
      }
      const resultado = recalcularAcumuladosObra(
        filasExistentesPorObra.get(obraId) ?? [],
        edicionesPeriodo,
        saldoInicialPorObra.get(obraId) ?? 0,
      );
      if (resultado.advertencia)
        advertenciasFormateadas.push(resultado.advertencia);

      const nombreObra = obrasConocidas.get(obraId) ?? obraId;
      const cambios: DetalleObraPreview["cambios"] = [];

      for (const fila of resultado.filas) {
        if (fila.esEdicion) {
          const anterior =
            variacionExistentePorClave.get(`${obraId}::${fila.periodo}`) ??
            null;
          cambios.push({
            periodo: fila.periodo,
            anterior,
            nuevo: fila.variacionNeta,
          });
          filasEdicion.push({
            obra_id: obraId,
            periodo: fila.periodo,
            variacion_neta: fila.variacionNeta,
            acumulado: fila.acumulado,
            origen: "manual",
            forecast_run_id: null,
            created_by: session?.user?.id ?? null,
          });
        } else {
          acumuladosRecalculados++;
          const meta = metadataExistentePorClave.get(
            `${obraId}::${fila.periodo}`,
          );
          filasSoloAcumulado.push({
            obra_id: obraId,
            periodo: fila.periodo,
            variacion_neta: fila.variacionNeta,
            acumulado: fila.acumulado,
            origen: meta?.origen ?? "modelo_estimado",
            forecast_run_id: meta?.forecastRunId ?? null,
            created_by: meta?.createdBy ?? null,
          });
        }
      }
      if (cambios.length > 0)
        detallePreview.push({ obra: nombreObra, cambios });
    }

    if (!confirmado) {
      return {
        estado: "preview",
        celdasGuardadas: 0,
        errores: erroresFormateados,
        advertencias: advertenciasFormateadas,
        detallePreview,
        celdasEditadas: filasEdicion.length,
        celdasSinCambios: modoCompatibilidad
          ? candidatas.length - edicionesFinal.length + celdasSinCambios
          : celdasSinCambios,
        obrasAfectadas: detallePreview.length,
        modoCompatibilidad,
        generadoEnArchivo,
      };
    }

    const todasLasFilas = [...filasEdicion, ...filasSoloAcumulado];
    if (todasLasFilas.length === 0) {
      // No debería llegar acá desde la UI normal (el botón "Confirmar"
      // solo aparece después de un preview con celdas editadas), pero un
      // segundo submit del mismo formulario podría llegar con 0 ediciones
      // reales tras el diff de modo compatibilidad — no hay nada que
      // escribir.
      return {
        estado: "error",
        celdasGuardadas: 0,
        errores: ["No hay ninguna edición real que guardar."],
        advertencias: advertenciasFormateadas,
      };
    }
    const { error: upsertError } = await supabase
      .from("headcount_by_obra")
      .upsert(todasLasFilas, { onConflict: "obra_id,periodo" });

    if (upsertError) {
      return {
        estado: "error",
        celdasGuardadas: 0,
        errores: [
          ...erroresFormateados,
          `Error guardando en la base de datos: ${upsertError.message}`,
        ],
        advertencias: advertenciasFormateadas,
      };
    }

    await supabase.from("audit_log").insert({
      actor_id: session?.user?.id ?? null,
      accion: "upload_headcount_manual",
      entidad: "headcount_by_obra",
      metadata: {
        celdasEditadas: filasEdicion.length,
        celdasSinCambios,
        acumuladosRecalculados,
        obras: obraIds.length,
        erroresDeFila: erroresParseo.length,
        modoCompatibilidad,
        generadoEnArchivo,
      },
    });

    return {
      estado: erroresFormateados.length > 0 ? "parcial" : "ok",
      celdasGuardadas: filasEdicion.length,
      errores: erroresFormateados,
      advertencias: advertenciasFormateadas,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ...RESULTADO_VACIO, errores: [message] };
  }
}
