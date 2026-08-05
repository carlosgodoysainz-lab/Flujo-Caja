import "server-only";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export class GraphAuthExpiredError extends Error {
  constructor(
    message = "Sesión de Graph API expirada — vuelve a iniciar sesión con Microsoft",
  ) {
    super(message);
    this.name = "GraphAuthExpiredError";
  }
}

export interface GraphSearchHit {
  id: string;
  name: string;
  webUrl: string;
  lastModifiedDateTime: string;
  parentReference?: { driveId?: string; path?: string };
}

async function graphFetch(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (res.status === 401) {
    throw new GraphAuthExpiredError();
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Graph API ${path} → ${res.status}: ${body.slice(0, 300)}`);
  }
  return res;
}

interface MicrosoftSearchHit {
  resource: {
    id: string;
    name: string;
    webUrl: string;
    lastModifiedDateTime: string;
    parentReference?: { driveId?: string; path?: string };
  };
}

interface MicrosoftSearchResponse {
  value: { hitsContainers: { hits?: MicrosoftSearchHit[] }[] }[];
}

/**
 * Búsqueda de archivos por texto libre — usa la API de Microsoft Search
 * (`/search/query`), NO `/me/drive/root/search`.
 *
 * BUG REAL corregido: `/me/drive/root/search` solo busca en el OneDrive
 * PERSONAL por defecto del usuario. Las carpetas reales ("Recursos Humanos
 * General", "Plan de Obra") son bibliotecas de SharePoint de EQUIPO
 * sincronizadas al explorador de archivos — viven en un drive distinto
 * (`/sites/{siteId}/drive`), así que `/me/drive/root/search` nunca las
 * encontraba (0 resultados, confirmado en producción). La API de Microsoft
 * Search sí cubre SharePoint + OneDrive + lo compartido con el usuario,
 * en una sola llamada — es el mismo endpoint que usa el conector MCP de
 * Microsoft 365 (ya validado contra datos reales en esta sesión).
 */
export async function searchFiles(
  accessToken: string,
  query: string,
): Promise<GraphSearchHit[]> {
  const res = await graphFetch(accessToken, "/search/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          entityTypes: ["driveItem"],
          query: { queryString: query },
          from: 0,
          // 50, no 25: con texto de búsqueda genérico (sin mes/año) hay
          // carpetas con 1 archivo por mes desde 2021+ — más de 25 en
          // total — y la API rankea por relevancia, no por fecha, así que
          // el archivo más reciente puede no estar en los primeros 25
          // (bug real confirmado en producción). El caller (ver
          // sync-pagos-mensuales.ts) además acota la búsqueda por mes/año
          // en el propio texto — este tamaño es una segunda red de
          // seguridad, no la única defensa.
          size: 50,
          // SIN esto, `resource.parentReference` viene vacío en algunas
          // respuestas — y sin `parentReference.path`/`driveId` no se
          // puede filtrar por carpeta ni descargar el archivo (bug real
          // confirmado: la sync de Plan de Obras Gespro fallaba SIEMPRE
          // porque el filtro por carpeta nunca encontraba `path`).
          fields: [
            "id",
            "name",
            "webUrl",
            "lastModifiedDateTime",
            "parentReference",
          ],
        },
      ],
    }),
  });

  const json = (await res.json()) as MicrosoftSearchResponse;
  const hits = json.value?.[0]?.hitsContainers?.[0]?.hits ?? [];
  return hits.map((h) => h.resource);
}

export async function downloadFileContent(
  accessToken: string,
  driveId: string,
  itemId: string,
): Promise<Buffer> {
  const res = await graphFetch(
    accessToken,
    `/drives/${driveId}/items/${itemId}/content`,
  );
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * De una lista de resultados de búsqueda, elige el más reciente
 * (`lastModifiedDateTime` real, NUNCA por nombre) cuya ruta de carpeta
 * padre y nombre matcheen los patrones dados.
 */
export function pickLatestMatch(
  hits: GraphSearchHit[],
  opts: { folderIncludes?: string; nameExtension?: string },
): GraphSearchHit | null {
  const filtered = hits.filter((hit) => {
    if (
      opts.folderIncludes &&
      !hit.parentReference?.path
        ?.toLowerCase()
        .includes(opts.folderIncludes.toLowerCase())
    ) {
      return false;
    }
    if (
      opts.nameExtension &&
      !hit.name.toLowerCase().endsWith(opts.nameExtension.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  if (filtered.length === 0) return null;

  return filtered.sort(
    (a, b) =>
      new Date(b.lastModifiedDateTime).getTime() -
      new Date(a.lastModifiedDateTime).getTime(),
  )[0];
}
