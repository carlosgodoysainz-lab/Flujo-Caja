// Igual que backfill-dotacion-historica.ts, pero preservando el CARGO de
// cada trabajador (no solo el total por obra) — pedido explícito del
// usuario: "existe obra gruesa, terminaciones etc... se debe ir
// testeando mes a mes". Un corte en vivo (13-ago-2026) ya mostró que el
// mix de cargos cambia radicalmente por fase (Enfierrador/Carpintero en
// obra gruesa, Pintor/Yesero/Terminaciones más adelante) — esto siembra
// el histórico necesario para construir esa curva mes a mes por obra.
//
// Mismo costo de API que el backfill anterior (ya se pedía el cargo en
// cada respuesta, solo que se descartaba al agregar) — mismo tiempo de
// corrida esperado.
//
// Reemplaza las filas "rollup" (cargo_id IS NULL) del backfill anterior
// por filas reales por (fecha, obra, cargo) — evita doble conteo
// borrando TODAS las filas de esa fecha (rollup y por-cargo previas)
// antes de insertar el detalle nuevo.
//
// PRIVACIDAD: mismo criterio que siempre — person_id solo transitorio
// en memoria para altas/bajas, nunca se persiste. Cargo SÍ se persiste
// (no es dato personal, es la función/oficio, igual que ya hace el cron
// mensual real vía sync.ts).
//
// Ejecutar con: npx tsx --env-file=.env.local scripts/backfill-dotacion-por-cargo.ts
import { createClient } from "@supabase/supabase-js";
import { matchObraByName } from "../src/shared/lib/match-obra";

const BUK_BASE = process.env.BUK_API_URL ?? "https://maestra.buk.cl";
const BUK_KEY = process.env.BUK_API_KEY ?? "";
const FECHA_INICIO = new Date(2018, 0, 1);

interface EmpleadoHistorico {
  personId: string;
  areaId: string | null;
  cargo: string | null;
  familiaCargo: string | null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchConReintentos(
  url: string,
  intentos = 4,
): Promise<Response> {
  let ultimoError: unknown;
  for (let intento = 1; intento <= intentos; intento++) {
    try {
      const res = await fetch(url, {
        headers: { auth_token: BUK_KEY, Accept: "application/json" },
        signal: AbortSignal.timeout(60_000),
      });
      if (res.ok) return res;
      if (res.status >= 500 || res.status === 429) {
        ultimoError = new Error(`HTTP ${res.status}`);
      } else {
        return res;
      }
    } catch (e) {
      ultimoError = e;
    }
    await sleep(2000 * intento);
  }
  throw ultimoError instanceof Error
    ? ultimoError
    : new Error(`Fallo tras ${intentos} intentos: ${url}`);
}

async function fetchActivosEnFecha(
  fecha: string,
): Promise<EmpleadoHistorico[]> {
  const empleados: EmpleadoHistorico[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const res = await fetchConReintentos(
      `${BUK_BASE}/api/v1/employees/active?date=${fecha}&page_size=25&page=${page}`,
    );
    if (!res.ok)
      throw new Error(`Buk API ${res.status} en fecha ${fecha} página ${page}`);
    const json = await res.json();
    totalPages = json.pagination?.total_pages ?? 1;
    for (const raw of json.data ?? []) {
      empleados.push({
        personId: String(raw.person_id),
        areaId:
          raw.current_job?.area_id != null
            ? String(raw.current_job.area_id)
            : null,
        cargo: raw.current_job?.role?.name ?? null,
        familiaCargo: raw.current_job?.role?.role_family?.name ?? null,
      });
    }
    page++;
    await sleep(100);
  } while (page <= totalPages);
  return empleados;
}

function primerDiaDeCadaMesDesde(inicio: Date): string[] {
  const fechas: string[] = [];
  const hoy = new Date();
  const cursor = new Date(inicio.getFullYear(), inicio.getMonth(), 1);
  const limite = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  while (cursor < limite) {
    fechas.push(cursor.toISOString().slice(0, 10));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return fechas;
}

async function main() {
  if (!BUK_KEY) throw new Error("BUK_API_KEY no configurada en .env.local");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: obras } = await supabase.from("obras").select("id, nombre");
  const obrasMatch = (obras ?? []).map((o) => ({ id: o.id, nombre: o.nombre }));

  const fechas = primerDiaDeCadaMesDesde(FECHA_INICIO);

  // "Ya hecho" para ESTE script = tiene AL MENOS 1 fila con cargo_id NOT
  // NULL esa fecha (el rollup del backfill anterior, cargo_id IS NULL,
  // NO cuenta como hecho acá — se va a reemplazar).
  const { data: yaHechosData } = await supabase
    .from("buk_dotacion_snapshots")
    .select("snapshot_date")
    .not("cargo_id", "is", null)
    .in("snapshot_date", fechas);
  const fechasYaHechas = new Set(
    (yaHechosData ?? []).map((d) => d.snapshot_date),
  );

  if (fechasYaHechas.size > 0) {
    const faltantes = fechas.filter((f) => !fechasYaHechas.has(f));
    console.log(
      `Retomando: ${fechasYaHechas.size} de ${fechas.length} meses ya tenían detalle por cargo. Rellenando ${faltantes.length}: ${faltantes.join(", ")}\n`,
    );
  } else {
    console.log(
      `Reconstruyendo detalle por cargo — ${fechas.length} meses (${fechas[0]} a ${fechas.at(-1)})...\n`,
    );
  }

  const nombrePorAreaId = new Map<string, string | null>();
  const obraIdPorAreaId = new Map<string, string | null>();
  async function resolverObraDeArea(areaId: string): Promise<string | null> {
    if (obraIdPorAreaId.has(areaId)) return obraIdPorAreaId.get(areaId)!;
    let nombre: string | null = nombrePorAreaId.get(areaId) ?? null;
    if (!nombrePorAreaId.has(areaId)) {
      try {
        const res = await fetchConReintentos(
          `${BUK_BASE}/api/v1/areas/${areaId}`,
          2,
        );
        nombre = res.ok ? ((await res.json()).data?.name ?? null) : null;
      } catch {
        nombre = null;
      }
      nombrePorAreaId.set(areaId, nombre);
    }
    const obraId = nombre
      ? (matchObraByName(nombre, obrasMatch)?.id ?? null)
      : null;
    obraIdPorAreaId.set(areaId, obraId);
    return obraId;
  }

  // Catálogo de cargos — mismo patrón que buk-sync/sync.ts (upsert,
  // no INSERT-only, es un catálogo). Se resuelve una vez por cargo
  // nuevo encontrado en TODO el backfill, no por fecha.
  const { data: catalogoExistente } = await supabase
    .from("buk_cargo_catalog")
    .select("id, nombre_buk, familia_cargo");
  const cargoIdPorNombre = new Map<string, string>(
    (catalogoExistente ?? []).map((c) => [c.nombre_buk, c.id]),
  );
  const familiaCargoConocida = new Map<string, string | null>(
    (catalogoExistente ?? []).map((c) => [c.nombre_buk, c.familia_cargo]),
  );
  async function resolverCargoId(
    nombreCargo: string,
    familiaCargo: string | null,
  ): Promise<string> {
    const existente = cargoIdPorNombre.get(nombreCargo);
    if (existente) {
      if (!familiaCargoConocida.get(nombreCargo) && familiaCargo) {
        await supabase
          .from("buk_cargo_catalog")
          .update({ familia_cargo: familiaCargo })
          .eq("id", existente);
        familiaCargoConocida.set(nombreCargo, familiaCargo);
      }
      return existente;
    }
    const { data, error } = await supabase
      .from("buk_cargo_catalog")
      .insert({ nombre_buk: nombreCargo, familia_cargo: familiaCargo })
      .select("id")
      .single();
    if (error || !data) {
      // Carrera con otra inserción del mismo cargo (poco probable, pero
      // posible si se corre 2 veces) — reintenta leer.
      const { data: relectura } = await supabase
        .from("buk_cargo_catalog")
        .select("id")
        .eq("nombre_buk", nombreCargo)
        .single();
      if (relectura) {
        cargoIdPorNombre.set(nombreCargo, relectura.id);
        return relectura.id;
      }
      throw new Error(
        `No se pudo resolver cargo_id para "${nombreCargo}": ${error?.message}`,
      );
    }
    cargoIdPorNombre.set(nombreCargo, data.id);
    familiaCargoConocida.set(nombreCargo, familiaCargo);
    return data.id;
  }

  let grupoAnterior: Map<string, Set<string>> | null = null;
  const fechasFallidas: string[] = [];
  const resumen: { fecha: string; total: number; grupos: number }[] = [];

  for (const fecha of fechas) {
    let empleados: EmpleadoHistorico[];
    try {
      empleados = await fetchActivosEnFecha(fecha);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`  ${fecha}: FALLÓ tras reintentos (${msg}) — se salta.`);
      fechasFallidas.push(fecha);
      continue;
    }

    // clave = obraId("oficina_central" si no matchea) + "::" + cargo
    const grupoActual = new Map<string, Set<string>>();
    const cargoPorClave = new Map<
      string,
      { obraId: string | null; cargo: string; familiaCargo: string | null }
    >();
    for (const emp of empleados) {
      const obraId = emp.areaId ? await resolverObraDeArea(emp.areaId) : null;
      const cargo = emp.cargo ?? "Sin cargo";
      const clave = `${obraId ?? "oficina_central"}::${cargo}`;
      if (!grupoActual.has(clave)) {
        grupoActual.set(clave, new Set());
        cargoPorClave.set(clave, {
          obraId,
          cargo,
          familiaCargo: emp.familiaCargo,
        });
      }
      grupoActual.get(clave)!.add(emp.personId);
    }

    const personasActualesTotal = new Set(empleados.map((e) => e.personId));
    const clavesTodas = new Set([
      ...grupoActual.keys(),
      ...(grupoAnterior ? grupoAnterior.keys() : []),
    ]);

    const filas: {
      snapshot_date: string;
      obra_id: string | null;
      cargo_id: string;
      activos: number;
      altas: number;
      bajas: number;
    }[] = [];

    if (!fechasYaHechas.has(fecha)) {
      for (const clave of clavesTodas) {
        const actual = grupoActual.get(clave) ?? new Set();
        if (actual.size === 0) continue; // no reinsertar grupos ya extintos (evita filas con activos=0 sin utilidad)
        const anterior = grupoAnterior?.get(clave) ?? new Set();
        let bajas = 0;
        let altas = 0;
        if (grupoAnterior) {
          for (const p of anterior) if (!personasActualesTotal.has(p)) bajas++;
          for (const p of actual) if (!anterior.has(p)) altas++;
        }
        const info = cargoPorClave.get(clave);
        if (!info) continue; // clave solo existía en grupoAnterior, ya extinta — no hay a qué cargo asignarla hoy
        const cargoId = await resolverCargoId(info.cargo, info.familiaCargo);
        filas.push({
          snapshot_date: fecha,
          obra_id: info.obraId,
          cargo_id: cargoId,
          activos: actual.size,
          altas,
          bajas,
        });
      }

      // Borra TODO lo de esta fecha (rollup viejo Y cualquier detalle
      // por cargo de una corrida parcial anterior) antes de insertar —
      // evita doble conteo entre el rollup (cargo_id NULL) y el detalle.
      await supabase
        .from("buk_dotacion_snapshots")
        .delete()
        .eq("snapshot_date", fecha);
      if (filas.length > 0) {
        const { error } = await supabase
          .from("buk_dotacion_snapshots")
          .insert(filas);
        if (error)
          console.error(`  Error guardando ${fecha}: ${error.message}`);
      }
    }

    const yaEstaba = fechasYaHechas.has(fecha)
      ? " (ya tenía detalle, no se reescribe)"
      : "";
    console.log(
      `${fecha}: total=${empleados.length}  grupos(obra,cargo)=${filas.length || "n/a"}${yaEstaba}`,
    );
    resumen.push({ fecha, total: empleados.length, grupos: filas.length });

    grupoAnterior = grupoActual;
  }

  console.log("\n=== Resumen ===");
  console.table(resumen);
  if (fechasFallidas.length > 0) {
    console.log(
      `\n${fechasFallidas.length} fecha(s) fallaron: ${fechasFallidas.join(", ")} — volvé a correr el script para rellenarlas.`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
