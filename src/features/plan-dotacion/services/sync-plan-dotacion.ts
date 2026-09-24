"use server";

import { auth } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import {
  downloadFileContent,
  ensureDriveId,
  pickLatestMatch,
  searchFiles,
} from "@/features/ingestion/graph/client";
import { parsePlanDotacion } from "./parse-plan-dotacion";

export interface SyncPlanDotacionResult {
  estado: "ok" | "parcial" | "error";
  archivoUsado: string | null;
  filasPlan: number;
  filasEventos: number;
  errores: string[];
  advertencias: string[];
}

/**
 * Lee "Plan Dotación Obras.xlsx" desde SharePoint (carpeta "Flujo de
 * Caja/Plan Dotación") y REEMPLAZA por completo `plan_dotacion` y
 * `plan_eventos` con lo que trae el archivo — es la fuente única de la
 * dotación futura (Fase 2, 24-sep-2026), así que un reemplazo total es
 * correcto: si el usuario borró una celda, esa variación ya no debe
 * existir en la base (una celda vacía significa "sin plan ese mes", no
 * "0" — ver `parse-plan-dotacion.ts`).
 *
 * Se corre ANTES del cálculo mes a mes en `refresh.ts`, igual que
 * `syncObrasFromGespro`/`syncFlujoCajaHistorico`.
 */
export async function syncPlanDotacion(): Promise<SyncPlanDotacionResult> {
  const session = await auth();
  if (!session?.graphAccessToken) {
    return {
      estado: "error",
      archivoUsado: null,
      filasPlan: 0,
      filasEventos: 0,
      errores: ["Sesión de Microsoft no disponible — vuelve a iniciar sesión."],
      advertencias: [],
    };
  }

  const supabase = createServiceClient();

  try {
    const hits = await searchFiles(session.graphAccessToken, "Plan Dotación");
    const encontrado = pickLatestMatch(hits, {
      folderIncludes: "Plan Dotación",
      nameExtension: ".xlsx",
    });

    if (!encontrado) {
      return {
        estado: "error",
        archivoUsado: null,
        filasPlan: 0,
        filasEventos: 0,
        errores: [
          'No se encontró "Plan Dotación Obras.xlsx" en SharePoint (carpeta "Flujo de Caja/Plan Dotación") — descarga la plantilla desde /dotación y súbela ahí.',
        ],
        advertencias: [],
      };
    }

    const match = await ensureDriveId(session.graphAccessToken, encontrado);
    if (!match.parentReference?.driveId) {
      return {
        estado: "error",
        archivoUsado: encontrado.name,
        filasPlan: 0,
        filasEventos: 0,
        errores: [
          `Se encontró "${match.name}" pero no se pudo resolver su ubicación exacta en SharePoint.`,
        ],
        advertencias: [],
      };
    }

    const buffer = await downloadFileContent(
      session.graphAccessToken,
      match.parentReference.driveId,
      match.id,
    );

    const { data: obras } = await supabase.from("obras").select("id, nombre");
    const obrasConocidas = new Map(
      (obras ?? []).map((o) => [o.id as string, o.nombre as string]),
    );

    const {
      filas,
      eventos,
      errores: erroresParseo,
      advertencias,
    } = await parsePlanDotacion(buffer, obrasConocidas);

    const errores: string[] = erroresParseo.map(
      (e) => `${e.hoja} fila ${e.fila}: ${e.motivo}`,
    );

    // Reemplazo total — ver comentario de la función.
    await supabase.from("plan_dotacion").delete().not("id", "is", null);
    if (filas.length > 0) {
      const { error: insertPlanError } = await supabase
        .from("plan_dotacion")
        .insert(
          filas.map((f) => ({
            obra_id: f.obraId,
            unidad: f.obraId ? "obra" : "oficina_central",
            periodo: f.periodo,
            variacion_neta: f.variacionNeta,
            fuente_archivo: match.name,
            fuente_modificado_at: match.lastModifiedDateTime,
          })),
        );
      if (insertPlanError) {
        errores.push(
          `Error guardando el plan en base de datos: ${insertPlanError.message}`,
        );
      }
    }

    await supabase.from("plan_eventos").delete().not("id", "is", null);
    if (eventos.length > 0) {
      const { error: insertEventosError } = await supabase
        .from("plan_eventos")
        .insert(
          eventos.map((e) => ({
            periodo: e.periodo,
            concepto: e.concepto,
            modo: e.modo,
            monto: e.monto,
            obra_id: e.obraId,
            poblacion: e.poblacion,
            descripcion: e.descripcion,
            fuente_archivo: match.name,
          })),
        );
      if (insertEventosError) {
        errores.push(
          `Error guardando los eventos en base de datos: ${insertEventosError.message}`,
        );
      }
    }

    await supabase.from("plan_dotacion_lecturas").insert({
      fuente_archivo: match.name,
      fuente_modificado_at: match.lastModifiedDateTime,
      filas_plan: filas.length,
      filas_eventos: eventos.length,
      errores: errores.length > 0 ? errores : null,
      advertencias: advertencias.length > 0 ? advertencias : null,
    });

    return {
      estado: errores.length > 0 ? "parcial" : "ok",
      archivoUsado: match.name,
      filasPlan: filas.length,
      filasEventos: eventos.length,
      errores,
      advertencias,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      estado: "error",
      archivoUsado: null,
      filasPlan: 0,
      filasEventos: 0,
      errores: [message],
      advertencias: [],
    };
  }
}
