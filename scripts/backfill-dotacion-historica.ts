// Reconstruye histórico REAL de dotación (activos/altas/bajas) por obra
// y Oficina Central usando GET /employees/active?date=YYYY-MM-DD — un
// endpoint de la API de Buk (confirmado en la documentación oficial:
// supportcenter.buk.cl/hc/es-419/articles/46220993138459, y probado en
// vivo: funciona para 2024-01-01, 2025-01-01, etc.) que devuelve el
// estado REAL de dotación en cualquier fecha pasada.
//
// Antes el único histórico real dependía del cron mensual (1 solo
// snapshot desde 2026-08-05) — esto siembra AÑOS de histórico real de
// una sola corrida, habilitando el modelo de curva y el análisis de
// correlación Construcción/Oficina Central con datos reales.
//
// PRIVACIDAD: usa `person_id` SOLO transitoriamente en memoria para
// detectar altas/bajas por diferencia de conjuntos entre 2 fechas
// consecutivas — nunca se persiste person_id, RUT, nombre ni ningún
// otro dato personal, solo conteos agregados por (fecha, obra).
//
// Idempotente: por cada fecha, borra sus propias filas (cargo_id IS
// NULL — "rollup" de este script) antes de insertar, sin tocar las
// filas per-cargo que escribe el cron real (sync.ts).
//
// Ejecutar con: npx tsx --env-file=.env.local scripts/backfill-dotacion-historica.ts
import { createClient } from "@supabase/supabase-js";
import { matchObraByName } from "../src/shared/lib/match-obra";

const BUK_BASE = process.env.BUK_API_URL ?? "https://maestra.buk.cl";
const BUK_KEY = process.env.BUK_API_KEY ?? "";
// Pedido explícito del usuario: analizar dotación desde 2018.
const FECHA_INICIO = new Date(2018, 0, 1);

interface EmpleadoHistorico {
  personId: string;
  areaId: string | null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reintenta con backoff — la API de Buk ocasionalmente tarda/timeoutea en páginas puntuales; sin esto, 1 timeout transitorio mataba las 3+ horas de corrida completas (visto en vivo: falló en el mes 13 de 103). */
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
        return res; // error del cliente (4xx que no es rate-limit) — no reintentar
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
  const limite = new Date(hoy.getFullYear(), hoy.getMonth(), 1); // excluye el mes actual (todavía en curso)
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

  const todasLasFechas = primerDiaDeCadaMesDesde(FECHA_INICIO);

  // Resume: si una corrida anterior ya dejó meses guardados (cargo_id IS
  // NULL = filas de este script), no los repite desde cero — retoma
  // desde el último mes ya hecho (se re-descarga SOLO ese mes, para
  // reconstruir `grupoAnterior` en memoria sin persistir person_id en
  // ningún lado; los meses anteriores a ese se saltan por completo).
  // Pedido explícito del usuario: "se pierde el backfill" si el proceso
  // se corta — con esto, retomar mañana es rápido, no repite 2+ horas.
  const { data: yaHechos } = await supabase
    .from("buk_dotacion_snapshots")
    .select("snapshot_date")
    .is("cargo_id", null)
    .in("snapshot_date", todasLasFechas)
    .order("snapshot_date", { ascending: false })
    .limit(1);
  const ultimoYaHecho = yaHechos?.[0]?.snapshot_date;
  const fechas = ultimoYaHecho
    ? todasLasFechas.filter((f) => f >= ultimoYaHecho)
    : todasLasFechas;

  if (ultimoYaHecho) {
    console.log(
      `Retomando: ${todasLasFechas.length - fechas.length} meses ya estaban guardados de una corrida anterior (hasta ${ultimoYaHecho}) — se saltan. Continuando ${fechas.length} meses desde ahí.\n`,
    );
  } else {
    console.log(
      `Reconstruyendo ${fechas.length} meses de histórico real (${fechas[0]} a ${fechas.at(-1)})...\n`,
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
        nombre = null; // degrada a "sin obra" — no vale la pena matar la corrida por 1 área
      }
      nombrePorAreaId.set(areaId, nombre);
    }
    const obraId = nombre
      ? (matchObraByName(nombre, obrasMatch)?.id ?? null)
      : null;
    obraIdPorAreaId.set(areaId, obraId);
    return obraId;
  }

  let grupoAnterior: Map<string, Set<string>> | null = null;
  const resumen: {
    fecha: string;
    total: number;
    construccion: number;
    oficina: number;
  }[] = [];

  const fechasFallidas: string[] = [];

  for (const fecha of fechas) {
    let empleados: EmpleadoHistorico[];
    try {
      empleados = await fetchActivosEnFecha(fecha);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(
        `  ${fecha}: FALLÓ tras reintentos (${msg}) — se salta, sigue con el siguiente mes.`,
      );
      fechasFallidas.push(fecha);
      continue; // grupoAnterior queda igual — el siguiente mes exitoso compara contra el último bueno conocido
    }

    const grupoActual = new Map<string, Set<string>>();
    for (const emp of empleados) {
      const obraId = emp.areaId ? await resolverObraDeArea(emp.areaId) : null;
      const clave = obraId ?? "oficina_central";
      if (!grupoActual.has(clave)) grupoActual.set(clave, new Set());
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
      cargo_id: null;
      activos: number;
      altas: number;
      bajas: number;
    }[] = [];
    for (const clave of clavesTodas) {
      const actual = grupoActual.get(clave) ?? new Set();
      const anterior = grupoAnterior?.get(clave) ?? new Set();
      let bajas = 0;
      let altas = 0;
      if (grupoAnterior) {
        for (const p of anterior) if (!personasActualesTotal.has(p)) bajas++;
        for (const p of actual) if (!anterior.has(p)) altas++;
      }
      filas.push({
        snapshot_date: fecha,
        obra_id: clave === "oficina_central" ? null : clave,
        cargo_id: null,
        activos: actual.size,
        altas,
        bajas,
      });
    }

    await supabase
      .from("buk_dotacion_snapshots")
      .delete()
      .eq("snapshot_date", fecha)
      .is("cargo_id", null);
    if (filas.length > 0) {
      const { error } = await supabase
        .from("buk_dotacion_snapshots")
        .insert(filas);
      if (error) console.error(`  Error guardando ${fecha}: ${error.message}`);
    }

    const construccion = filas
      .filter((f) => f.obra_id !== null)
      .reduce((s, f) => s + f.activos, 0);
    const oficina = filas.find((f) => f.obra_id === null)?.activos ?? 0;
    resumen.push({ fecha, total: empleados.length, construccion, oficina });
    console.log(
      `${fecha}: total=${empleados.length}  construcción=${construccion}  oficina=${oficina}`,
    );

    grupoAnterior = grupoActual;
  }

  console.log("\n=== Resumen ===");
  console.table(resumen);
  if (fechasFallidas.length > 0) {
    console.log(
      `\n${fechasFallidas.length} fecha(s) fallaron tras reintentos y quedaron sin backfillear: ${fechasFallidas.join(", ")}`,
    );
    console.log(
      "Volvé a correr el script — es idempotente, solo reprocesa lo que falta si agregás un filtro, o corre completo de nuevo sin costo de duplicar (delete-then-insert por fecha).",
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
