import "server-only";

/**
 * Cliente Buk — mismo patrón (fetch + header auth_token, paginado) que
 * panel-relaciones-laborales/src/lib/buk/api-client.ts, pero con campos
 * MÍNIMOS a propósito: este proyecto solo necesita conteos agregados por
 * cargo/obra para el histórico de dotación (ver TECH-SPEC §2.2) — NUNCA
 * nombre, RUT, email ni teléfono. `personId` se usa solo transitoriamente
 * en memoria durante el cálculo del snapshot, nunca se persiste.
 */

const BUK_BASE = process.env.BUK_API_URL ?? "https://maestra.buk.cl";
const BUK_KEY = process.env.BUK_API_KEY ?? "";
const PER_PAGE = 25;

interface BukApiPagination {
  count: number;
  total_pages: number;
  next: string | null;
}

interface BukApiCurrentJob {
  area_id: number | string | null;
  role: { name: string; role_family: { name: string } | null } | null;
}

interface BukApiRawEmployee {
  person_id: number;
  status: string;
  active_since: string | null;
  active_until: string | null;
  current_job: BukApiCurrentJob | null;
}

interface BukApiResponse {
  pagination: BukApiPagination;
  data: BukApiRawEmployee[];
}

export interface BukEmpleadoMinimo {
  personId: string;
  cargo: string | null;
  familiaCargo: string | null;
  areaId: string | null;
  activeSince: string | null;
}

async function fetchPage(
  status: "activo" | "inactivo",
  page: number,
): Promise<BukApiResponse> {
  const url = `${BUK_BASE}/api/v1/employees?per_page=${PER_PAGE}&status=${status}&page=${page}`;
  const res = await fetch(url, {
    headers: { auth_token: BUK_KEY, Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok)
    throw new Error(`Buk API ${res.status} en ${status} pág ${page}`);
  return res.json() as Promise<BukApiResponse>;
}

function mapMinimo(raw: BukApiRawEmployee): BukEmpleadoMinimo {
  const cj = raw.current_job;
  return {
    personId: String(raw.person_id),
    cargo: cj?.role?.name ?? null,
    familiaCargo: cj?.role?.role_family?.name ?? null,
    areaId: cj?.area_id != null ? String(cj.area_id) : null,
    activeSince: raw.active_since,
  };
}

/**
 * Trae solo empleados ACTIVOS (rápido, ~26 páginas). No incluye inactivos
 * a propósito — traer el historial completo de inactivos toma varios
 * minutos (ver comentario en el cliente hermano de panel-relaciones-laborales).
 * LIMITACIÓN CONOCIDA: esto significa que "bajas" no se puede calcular
 * todavía sin ese fetch lento — ver `aggregate.ts` y Auto-Blindaje.
 */
export async function fetchBukEmpleadosActivos(): Promise<BukEmpleadoMinimo[]> {
  if (!BUK_KEY) throw new Error("BUK_API_KEY no configurada en .env.local");

  const empleados: BukEmpleadoMinimo[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const response = await fetchPage("activo", page);
    totalPages = response.pagination.total_pages;
    empleados.push(...response.data.map(mapMinimo));
    page++;
  } while (page <= totalPages);

  return empleados;
}

interface BukApiArea {
  id: number;
  name: string;
  parent_area: { name: string } | null;
  department: { name: string } | null;
}

/**
 * Nombre del área (mismo endpoint que panel-relaciones-laborales) — se usa
 * para intentar mapear area_id de Buk a una obra por nombre (ver
 * `matchObraByName`), ya que Buk no expone directamente un obra_id.
 */
export async function fetchBukAreaNombre(
  areaId: string,
): Promise<string | null> {
  if (!BUK_KEY) return null;
  try {
    const res = await fetch(`${BUK_BASE}/api/v1/areas/${areaId}`, {
      headers: { auth_token: BUK_KEY, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const { data } = (await res.json()) as { data: BukApiArea };
    return data.name;
  } catch {
    return null;
  }
}

export async function bukApiDisponible(): Promise<boolean> {
  if (!BUK_KEY) return false;
  try {
    const res = await fetch(
      `${BUK_BASE}/api/v1/employees?per_page=1&status=activo&page=1`,
      {
        headers: { auth_token: BUK_KEY, Accept: "application/json" },
        signal: AbortSignal.timeout(5_000),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}
