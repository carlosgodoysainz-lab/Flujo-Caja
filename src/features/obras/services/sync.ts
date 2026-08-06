"use server";

import { auth } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import {
  downloadFileContent,
  ensureDriveId,
  pickLatestMatch,
  searchFiles,
} from "@/features/ingestion/graph/client";
import { parseGesproWorkbook } from "./gespro-parser";
import type { ObraRaw } from "../types";

export interface SyncObrasResult {
  estado: "ok" | "parcial" | "error";
  obrasSincronizadas: number;
  errores: string[];
  archivoUsado?: string;
}

function toObraRow(obra: ObraRaw) {
  return {
    codigo_gespro: obra.codigoGespro,
    nombre: obra.nombre,
    comuna: obra.comuna,
    tipo: obra.tipo,
    cliente: obra.cliente,
    unidades: obra.unidades,
    inicio_obra: obra.inicioObra?.toISOString().slice(0, 10) ?? null,
    fin_obra: obra.finObra?.toISOString().slice(0, 10) ?? null,
    dur_obra_meses: obra.durObraMeses,
  };
}

/**
 * Sincroniza el catálogo de obras desde el Excel Plan de Obras Gespro más
 * reciente en SharePoint (búsqueda por patrón, no por ruta fija — ver
 * TECH-SPEC §2.2). Server Action invocada desde el botón "Sincronizar
 * ahora" en /fuentes (Fase 3) y como parte del refresh completo (Fase 7).
 */
export async function syncObrasFromGespro(): Promise<SyncObrasResult> {
  const session = await auth();
  if (!session?.graphAccessToken) {
    return {
      estado: "error",
      obrasSincronizadas: 0,
      errores: ["Sesión de Microsoft no disponible — vuelve a iniciar sesión."],
    };
  }

  const supabase = createServiceClient();

  try {
    // "Gespro" alcanza para acotar bien sin depender del nombre exacto del
    // archivo (que incluye la fecha del corte, ej. "20260803 Plan de Obras
    // Nuevo Gespro.xlsx" — cambia cada semana).
    const hits = await searchFiles(session.graphAccessToken, "Gespro");
    const encontrado = pickLatestMatch(hits, {
      folderIncludes: "Plan de Obra",
      nameExtension: ".xlsx",
    });

    if (!encontrado) {
      return {
        estado: "error",
        obrasSincronizadas: 0,
        errores: [
          "No se encontró ningún Excel de Plan de Obras Gespro en SharePoint (carpeta 'Plan de Obra').",
        ],
      };
    }

    // La búsqueda puede no traer `parentReference.driveId` (bug real
    // confirmado — ver ensureDriveId) — resolverlo vía webUrl antes de
    // intentar descargar, no asumir que ya viene.
    const match = await ensureDriveId(session.graphAccessToken, encontrado);
    if (!match.parentReference?.driveId) {
      return {
        estado: "error",
        obrasSincronizadas: 0,
        errores: [
          `Se encontró "${match.name}" pero no se pudo resolver su ubicación exacta en SharePoint (driveId) — puede ser un problema temporal de permisos o indexación.`,
        ],
      };
    }

    const buffer = await downloadFileContent(
      session.graphAccessToken,
      match.parentReference.driveId,
      match.id,
    );
    const { obras, errores: erroresParseo } = await parseGesproWorkbook(buffer);

    if (obras.length === 0) {
      return {
        estado: "error",
        obrasSincronizadas: 0,
        errores: [
          "El archivo se descargó pero no se pudo extraer ninguna obra válida.",
          ...erroresParseo.map((e) => `Fila ${e.fila}: ${e.motivo}`),
        ],
        archivoUsado: match.name,
      };
    }

    const { error: upsertError } = await supabase.from("obras").upsert(
      obras.map((o) => ({
        ...toObraRow(o),
        fuente_archivo: match.name,
        fuente_actualizado_at: new Date().toISOString(),
      })),
      // NUNCA "codigo_gespro" — confirmado contra el archivo real que ese
      // código se repite entre obras distintas (ver migración
      // 20260805000002). `nombre` es la clave 100% única real.
      { onConflict: "nombre" },
    );

    if (upsertError) {
      return {
        estado: "error",
        obrasSincronizadas: 0,
        errores: [`Error guardando en base de datos: ${upsertError.message}`],
        archivoUsado: match.name,
      };
    }

    await supabase.from("audit_log").insert({
      actor_id: session.user?.id ?? null,
      accion: "sync_obras_gespro",
      entidad: "obras",
      metadata: {
        archivo: match.name,
        obras: obras.length,
        errores_parseo: erroresParseo.length,
      },
    });

    return {
      estado: erroresParseo.length > 0 ? "parcial" : "ok",
      obrasSincronizadas: obras.length,
      errores: erroresParseo.map((e) => `Fila ${e.fila}: ${e.motivo}`),
      archivoUsado: match.name,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { estado: "error", obrasSincronizadas: 0, errores: [message] };
  }
}
