// Análisis pedido por el usuario: entender el comportamiento real de
// dotación Construcción (obra) vs. Oficina Central (áreas de apoyo) y
// buscar la correlación entre ambas — el Plan de Obra mueve fuerte la
// dotación de Construcción, pero ¿cuánto arrastra a Oficina Central?
//
// Autocontenido (no importa client.ts/sync.ts — tienen `import
// "server-only"`, bloquea fuera del pipeline de Next). Solo lee campos
// agregados/no personales de Buk (cargo, familia_cargo, area_id) — nunca
// RUT, nombre, sueldo. Combina:
//   (a) snapshot EN VIVO de hoy (vía API real de Buk)
//   (b) histórico ya guardado en `buk_dotacion_snapshots` (Supabase)
//
// Ejecutar con: npx tsx --env-file=.env.local scripts/analizar-correlacion-dotacion.ts
import { createClient } from "@supabase/supabase-js";
import { matchObraByName } from "../src/shared/lib/match-obra";

const BUK_BASE = process.env.BUK_API_URL ?? "https://maestra.buk.cl";
const BUK_KEY = process.env.BUK_API_KEY ?? "";

interface BukEmpleado {
  cargo: string | null;
  familiaCargo: string | null;
  areaId: string | null;
}

async function fetchTodosActivos(): Promise<BukEmpleado[]> {
  const empleados: BukEmpleado[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const res = await fetch(
      `${BUK_BASE}/api/v1/employees?per_page=25&status=activo&page=${page}`,
      {
        headers: { auth_token: BUK_KEY, Accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!res.ok) throw new Error(`Buk API ${res.status} en página ${page}`);
    const json = await res.json();
    totalPages = json.pagination?.total_pages ?? 1;
    for (const raw of json.data ?? []) {
      const cj = raw.current_job;
      empleados.push({
        cargo: cj?.role?.name ?? null,
        familiaCargo: cj?.role?.role_family?.name ?? null,
        areaId: cj?.area_id != null ? String(cj.area_id) : null,
      });
    }
    page++;
  } while (page <= totalPages);
  return empleados;
}

async function fetchNombreArea(areaId: string): Promise<string | null> {
  try {
    const res = await fetch(`${BUK_BASE}/api/v1/areas/${areaId}`, {
      headers: { auth_token: BUK_KEY, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const { data } = (await res.json()) as { data: { name: string } };
    return data.name;
  } catch {
    return null;
  }
}

function pearson(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length < 3) return null;
  const n = a.length;
  const mediaA = a.reduce((s, v) => s + v, 0) / n;
  const mediaB = b.reduce((s, v) => s + v, 0) / n;
  let cov = 0,
    varA = 0,
    varB = 0;
  for (let i = 0; i < n; i++) {
    cov += (a[i] - mediaA) * (b[i] - mediaB);
    varA += (a[i] - mediaA) ** 2;
    varB += (b[i] - mediaB) ** 2;
  }
  if (varA === 0 || varB === 0) return null;
  return cov / Math.sqrt(varA * varB);
}

async function main() {
  if (!BUK_KEY) throw new Error("BUK_API_KEY no configurada en .env.local");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  console.log("=== 1. Snapshot EN VIVO de hoy (API real de Buk) ===");
  const empleados = await fetchTodosActivos();
  console.log(`Empleados activos totales: ${empleados.length}`);

  const { data: obras } = await supabase.from("obras").select("id, nombre");
  const obrasMatch = (obras ?? []).map((o) => ({ id: o.id, nombre: o.nombre }));

  const areaIdsUnicos = [
    ...new Set(empleados.map((e) => e.areaId).filter((a): a is string => !!a)),
  ];
  const nombrePorAreaId = new Map<string, string | null>();
  for (const areaId of areaIdsUnicos) {
    nombrePorAreaId.set(areaId, await fetchNombreArea(areaId));
  }
  const esConstruccionPorAreaId = new Map<string, boolean>();
  for (const [areaId, nombre] of nombrePorAreaId) {
    esConstruccionPorAreaId.set(
      areaId,
      nombre ? matchObraByName(nombre, obrasMatch) !== null : false,
    );
  }

  let construccionActivos = 0;
  let oficinaCentralActivos = 0;
  const porFamiliaConstruccion = new Map<string, number>();
  const porFamiliaOficina = new Map<string, number>();
  for (const e of empleados) {
    const esConstruccion = e.areaId
      ? (esConstruccionPorAreaId.get(e.areaId) ?? false)
      : false;
    const familia = e.familiaCargo ?? "(sin familia de cargo)";
    if (esConstruccion) {
      construccionActivos++;
      porFamiliaConstruccion.set(
        familia,
        (porFamiliaConstruccion.get(familia) ?? 0) + 1,
      );
    } else {
      oficinaCentralActivos++;
      porFamiliaOficina.set(familia, (porFamiliaOficina.get(familia) ?? 0) + 1);
    }
  }

  console.log(
    `\nConstrucción (área matcheada a una obra): ${construccionActivos}`,
  );
  for (const [fam, n] of [...porFamiliaConstruccion.entries()].sort(
    (a, b) => b[1] - a[1],
  ))
    console.log(`  ${fam}: ${n}`);

  console.log(
    `\nOficina Central / Soporte (sin match a obra): ${oficinaCentralActivos}`,
  );
  for (const [fam, n] of [...porFamiliaOficina.entries()].sort(
    (a, b) => b[1] - a[1],
  ))
    console.log(`  ${fam}: ${n}`);

  console.log(
    "\n=== 2. Serie histórica (buk_dotacion_snapshots ya guardado) ===",
  );
  const { data: snapshots } = await supabase
    .from("buk_dotacion_snapshots")
    .select("snapshot_date, obra_id, activos")
    .order("snapshot_date");

  const porFecha = new Map<string, { construccion: number; oficina: number }>();
  for (const s of snapshots ?? []) {
    const entry = porFecha.get(s.snapshot_date) ?? {
      construccion: 0,
      oficina: 0,
    };
    if (s.obra_id) entry.construccion += s.activos;
    else entry.oficina += s.activos;
    porFecha.set(s.snapshot_date, entry);
  }
  const fechasOrdenadas = [...porFecha.keys()].sort();
  console.log(`Meses de histórico disponibles: ${fechasOrdenadas.length}`);
  for (const f of fechasOrdenadas) {
    const e = porFecha.get(f)!;
    console.log(
      `  ${f}: Construcción=${e.construccion}  Oficina Central=${e.oficina}`,
    );
  }

  if (fechasOrdenadas.length >= 3) {
    const construccionSerie = fechasOrdenadas.map(
      (f) => porFecha.get(f)!.construccion,
    );
    const oficinaSerie = fechasOrdenadas.map((f) => porFecha.get(f)!.oficina);
    const deltaConstruccion = construccionSerie
      .slice(1)
      .map((v, i) => v - construccionSerie[i]);
    const deltaOficina = oficinaSerie
      .slice(1)
      .map((v, i) => v - oficinaSerie[i]);
    const corr = pearson(deltaConstruccion, deltaOficina);
    console.log(
      `\nCorrelación (Pearson) entre variación mensual de Construcción y de Oficina Central: ${
        corr !== null ? corr.toFixed(2) : "insuficientes datos"
      }`,
    );
    console.log(
      "(1 = se mueven juntas siempre · 0 = independientes · -1 = inversas — con pocos meses de histórico, tomar como orientativo, no concluyente)",
    );
  } else {
    console.log(
      "\nMenos de 3 meses de histórico real — no hay suficientes puntos para calcular correlación todavía. Se necesita esperar a que el cron mensual acumule más snapshots.",
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
