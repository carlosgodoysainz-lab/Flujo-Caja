import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchBukAreaNombre, fetchBukEmpleadosActivos } from "./client";
import { agruparDotacion } from "./aggregate";
import { matchObraByName } from "@/shared/lib/match-obra";

export interface BukSnapshotResult {
  estado: "ok" | "error";
  snapshotDate: string;
  cargosActualizados: number;
  gruposGuardados: number;
  obrasResueltas: number;
  /** Ver `oficina_central_snapshots` — RP contractual real (private_role de Buk). */
  rolPrivadoCount: number;
  /** RG (Rol General) cuya área no matcheó ninguna obra — también cuenta como Oficina Central. */
  rgSinObraCount: number;
  errores: string[];
}

/**
 * Corre el snapshot mensual de dotación. A diferencia del sync de
 * panel-relaciones-laborales (que hace UPSERT destructivo del estado
 * actual), este hace SIEMPRE INSERT de filas nuevas por
 * (snapshot_date, cargo, area) — para preservar histórico real (ver
 * TECH-SPEC §2.2, decisión explícita del usuario). Eso es "insert-only"
 * ENTRE meses distintos — nunca debe significar "insert sin límite" si
 * este mismo snapshot se corre 2 veces el MISMO día.
 *
 * BUG REAL corregido: el `UNIQUE (snapshot_date, obra_id, cargo_id)` de
 * la tabla no protege nada cuando `obra_id` es NULL (oficinas centrales,
 * gerencias — normal, muchas áreas de Buk no mapean a ninguna obra):
 * Postgres nunca considera dos NULL "iguales" para un constraint UNIQUE,
 * así que corrió 2 veces el mismo día y cada área sin obra quedó
 * duplicada — "Dotación total" salía ~2x lo real (1.646 en vez de ~800).
 * Fix: borrar cualquier snapshot YA guardado para esa misma fecha antes
 * de insertar el nuevo — corridas repetidas el mismo día se REEMPLAZAN,
 * nunca se acumulan; el histórico de fechas PASADAS queda intacto.
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

    // 1. Catálogo de cargos — upsert (no INSERT-only, es un catálogo, no
    // histórico). `familia_cargo` (ej. "Rol General") ya se lee de Buk
    // en `agruparDotacion` pero antes se descartaba en memoria — ahora se
    // persiste, tanto para cargos nuevos como para backfill de los que ya
    // estaban en el catálogo sin ese dato (columna ya existía, siempre en
    // NULL). Análisis de auto-blindaje 2026-08-13: esto habilita
    // segmentar dotación por familia de cargo (Rol General/Rol Particular)
    // directamente desde Buk en vez de solo por proporción histórica.
    const familiaCargoPorNombre = new Map<string, string | null>();
    for (const g of grupos) {
      if (!familiaCargoPorNombre.has(g.cargo))
        familiaCargoPorNombre.set(g.cargo, g.familiaCargo);
    }

    const cargosUnicos = [...new Set(grupos.map((g) => g.cargo))];
    const { data: catalogoExistente } = await supabase
      .from("buk_cargo_catalog")
      .select("id, nombre_buk, familia_cargo");
    const idPorNombre = new Map(
      (catalogoExistente ?? []).map((c) => [c.nombre_buk, c.id]),
    );

    const cargosNuevos = cargosUnicos.filter((c) => !idPorNombre.has(c));
    if (cargosNuevos.length > 0) {
      const { data: insertados, error } = await supabase
        .from("buk_cargo_catalog")
        .insert(
          cargosNuevos.map((nombre) => ({
            nombre_buk: nombre,
            familia_cargo: familiaCargoPorNombre.get(nombre) ?? null,
          })),
        )
        .select("id, nombre_buk");
      if (error)
        errores.push(
          `Error creando cargos nuevos en catálogo: ${error.message}`,
        );
      for (const c of insertados ?? []) idPorNombre.set(c.nombre_buk, c.id);
    }

    const cargosSinFamiliaAunConDato = (catalogoExistente ?? []).filter(
      (c) => !c.familia_cargo && familiaCargoPorNombre.get(c.nombre_buk),
    );
    for (const c of cargosSinFamiliaAunConDato) {
      const { error } = await supabase
        .from("buk_cargo_catalog")
        .update({ familia_cargo: familiaCargoPorNombre.get(c.nombre_buk) })
        .eq("id", c.id);
      if (error)
        errores.push(
          `Error actualizando familia_cargo de "${c.nombre_buk}": ${error.message}`,
        );
    }

    // 2. Resolver obra_id por area_id — best-effort, muchas áreas de Buk
    // NO van a mapear a una obra (oficinas centrales, gerencias, etc.),
    // eso es normal. Se resuelve el nombre de cada área única (1 llamada
    // a Buk por área, aceptable en un cron mensual) y se matchea contra
    // el catálogo de obras con el mismo helper que usa Fase 4.
    const { data: obras } = await supabase.from("obras").select("id, nombre");
    const areaIdsUnicos = [
      ...new Set(grupos.map((g) => g.areaId).filter((a): a is string => !!a)),
    ];
    const obraIdPorAreaId = new Map<string, string>();

    for (const areaId of areaIdsUnicos) {
      const nombreArea = await fetchBukAreaNombre(areaId);
      if (!nombreArea) continue;
      const match = matchObraByName(nombreArea, obras ?? []);
      if (match) obraIdPorAreaId.set(areaId, match.id);
    }

    // 3. Snapshots — insert-only ENTRE fechas distintas, pero si esta
    // MISMA fecha ya tiene snapshot (re-corrida el mismo día), se
    // reemplaza completo primero — ver nota arriba sobre por qué (el
    // UNIQUE constraint no protege combinaciones con obra_id NULL).
    const { error: deleteError } = await supabase
      .from("buk_dotacion_snapshots")
      .delete()
      .eq("snapshot_date", snapshotDate);
    if (deleteError)
      errores.push(
        `No se pudo limpiar el snapshot anterior de ${snapshotDate}: ${deleteError.message}`,
      );

    const filas = grupos.map((g) => ({
      snapshot_date: snapshotDate,
      cargo_id: idPorNombre.get(g.cargo) ?? null,
      obra_id: g.areaId ? (obraIdPorAreaId.get(g.areaId) ?? null) : null,
      activos: g.activos,
      altas: g.altas,
      bajas: g.bajas,
    }));

    const { error: insertError } = await supabase
      .from("buk_dotacion_snapshots")
      .insert(filas);
    if (insertError)
      errores.push(`Error guardando snapshots: ${insertError.message}`);

    // 4. "Oficina Central" real (RP + RG sin obra) — pedido explícito del
    // usuario 25-ago-2026, ver migración `oficina_central_snapshots`.
    // Reutiliza el mismo `empleados` y el mismo `obraIdPorAreaId` ya
    // calculados arriba — sin ninguna llamada extra a la API de Buk.
    let rolPrivadoCount = 0;
    let rgSinObraCount = 0;
    for (const emp of empleados) {
      if (emp.esRolPrivado) {
        rolPrivadoCount++;
        continue;
      }
      const tieneObra = emp.areaId ? obraIdPorAreaId.has(emp.areaId) : false;
      if (!tieneObra) rgSinObraCount++;
    }
    const { error: oficinaCentralError } = await supabase
      .from("oficina_central_snapshots")
      .upsert(
        {
          snapshot_date: snapshotDate,
          rol_privado_count: rolPrivadoCount,
          rg_sin_obra_count: rgSinObraCount,
        },
        { onConflict: "snapshot_date" },
      );
    if (oficinaCentralError)
      errores.push(
        `Error guardando snapshot de Oficina Central: ${oficinaCentralError.message}`,
      );

    await supabase.from("audit_log").insert({
      actor_id: null, // corrido por cron, no por un usuario
      accion: "buk_snapshot",
      entidad: "buk_dotacion_snapshots",
      metadata: {
        snapshotDate,
        grupos: grupos.length,
        cargosNuevos: cargosNuevos.length,
        areasResueltasAObra: obraIdPorAreaId.size,
        areasTotal: areaIdsUnicos.length,
        rolPrivadoCount,
        rgSinObraCount,
      },
    });

    return {
      estado: errores.length > 0 ? "error" : "ok",
      snapshotDate,
      cargosActualizados: cargosNuevos.length,
      gruposGuardados: filas.length,
      obrasResueltas: obraIdPorAreaId.size,
      rolPrivadoCount,
      rgSinObraCount,
      errores,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      estado: "error",
      snapshotDate,
      cargosActualizados: 0,
      gruposGuardados: 0,
      obrasResueltas: 0,
      rolPrivadoCount: 0,
      rgSinObraCount: 0,
      errores: [...errores, message],
    };
  }
}
