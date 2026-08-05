import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchBukEmpleadosActivos } from "./client";
import { agruparDotacion } from "./aggregate";

export interface BukSnapshotResult {
  estado: "ok" | "error";
  snapshotDate: string;
  cargosActualizados: number;
  gruposGuardados: number;
  errores: string[];
}

/**
 * Corre el snapshot mensual de dotación. A diferencia del sync de
 * panel-relaciones-laborales (que hace UPSERT destructivo del estado
 * actual), este hace SIEMPRE INSERT de una fila nueva por
 * (snapshot_date, cargo, area) — para preservar histórico real (ver
 * TECH-SPEC §2.2, decisión explícita del usuario).
 */
export async function runBukSnapshot(
  fechaSnapshot: Date = new Date(),
): Promise<BukSnapshotResult> {
  const snapshotDate = fechaSnapshot.toISOString().slice(0, 10);
  const supabase = createServiceClient();
  const errores: string[] = [];

  try {
    const empleados = await fetchBukEmpleadosActivos();
    const grupos = agruparDotacion(empleados, fechaSnapshot);

    // 1. Catálogo de cargos — upsert (no INSERT-only, es un catálogo, no histórico)
    const cargosUnicos = [...new Set(grupos.map((g) => g.cargo))];
    const { data: catalogoExistente } = await supabase
      .from("buk_cargo_catalog")
      .select("id, nombre_buk");
    const idPorNombre = new Map(
      (catalogoExistente ?? []).map((c) => [c.nombre_buk, c.id]),
    );

    const cargosNuevos = cargosUnicos.filter((c) => !idPorNombre.has(c));
    if (cargosNuevos.length > 0) {
      const { data: insertados, error } = await supabase
        .from("buk_cargo_catalog")
        .insert(cargosNuevos.map((nombre) => ({ nombre_buk: nombre })))
        .select("id, nombre_buk");
      if (error)
        errores.push(
          `Error creando cargos nuevos en catálogo: ${error.message}`,
        );
      for (const c of insertados ?? []) idPorNombre.set(c.nombre_buk, c.id);
    }

    // 2. Resolver obra_id por area_id — best-effort, muchas áreas de Buk
    // no van a mapear 1:1 a una obra (oficinas centrales, gerencias, etc.)
    // — eso es normal, no es un error.
    const { data: obras } = await supabase.from("obras").select("id, nombre");

    // 3. Snapshots — SIEMPRE insert, nunca upsert.
    const filas = grupos.map((g) => ({
      snapshot_date: snapshotDate,
      cargo_id: idPorNombre.get(g.cargo) ?? null,
      obra_id: null as string | null, // ver nota: mapeo area_id->obra_id queda para cuando exista esa tabla de correspondencia
      activos: g.activos,
      altas: g.altas,
      bajas: g.bajas,
    }));

    const { error: insertError } = await supabase
      .from("buk_dotacion_snapshots")
      .insert(filas);
    if (insertError)
      errores.push(`Error guardando snapshots: ${insertError.message}`);

    await supabase.from("audit_log").insert({
      actor_id: null, // corrido por cron, no por un usuario
      accion: "buk_snapshot",
      entidad: "buk_dotacion_snapshots",
      metadata: {
        snapshotDate,
        grupos: grupos.length,
        cargosNuevos: cargosNuevos.length,
        obrasDisponibles: obras?.length ?? 0,
      },
    });

    return {
      estado: errores.length > 0 ? "error" : "ok",
      snapshotDate,
      cargosActualizados: cargosNuevos.length,
      gruposGuardados: filas.length,
      errores,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      estado: "error",
      snapshotDate,
      cargosActualizados: 0,
      gruposGuardados: 0,
      errores: [...errores, message],
    };
  }
}
