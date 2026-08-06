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

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function graphFetch(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const REINTENTOS_409 = [400, 1200]; // ms — backoff corto, ver nota abajo
  let intento = 0;

  while (true) {
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

    // 409 "resourceModified" (eTag mismatch) en /content: error REAL visto
    // en producción al descargar archivos que la búsqueda acababa de
    // indexar — típicamente transitorio (SharePoint todavía procesando el
    // eTag de un archivo recién tocado). Reintentar con una request nueva
    // (nuevo eTag) antes de rendirse, en vez de fallar al primer golpe.
    if (res.status === 409 && intento < REINTENTOS_409.length) {
      await esperar(REINTENTOS_409[intento]);
      intento++;
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Graph API ${path} → ${res.status}: ${body.slice(0, 300)}`,
      );
    }
    return res;
  }
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
  value: {
    hitsContainers: {
      hits?: MicrosoftSearchHit[];
      moreResultsAvailable?: boolean;
    }[];
  }[];
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
  opts?: { maxResultados?: number },
): Promise<GraphSearchHit[]> {
  const PAGE_SIZE = 50;
  // 50, no 25: con texto de búsqueda genérico (sin mes/año) hay carpetas
  // con 1 archivo por mes desde 2021+ — más de 25 en total — y la API
  // rankea por relevancia, no por fecha, así que el archivo más reciente
  // puede no estar en los primeros 25 (bug real confirmado en
  // producción). Para búsquedas SIN mes/año en el texto (ej. el Excel
  // maestro de Flujo de Caja, con 178+ archivos históricos coincidiendo)
  // el caller puede pedir `maxResultados` más alto — se pagina hasta
  // llegar ahí o hasta que la API no tenga más resultados.
  const maxResultados = opts?.maxResultados ?? PAGE_SIZE;
  const hits: GraphSearchHit[] = [];

  for (let from = 0; from < maxResultados; from += PAGE_SIZE) {
    const res = await graphFetch(accessToken, "/search/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            entityTypes: ["driveItem"],
            query: { queryString: query },
            from,
            size: Math.min(PAGE_SIZE, maxResultados - from),
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
    const contenedor = json.value?.[0]?.hitsContainers?.[0];
    const paginaHits = contenedor?.hits ?? [];
    hits.push(...paginaHits.map((h) => h.resource));

    if (paginaHits.length === 0 || !contenedor?.moreResultsAvailable) break;
  }

  return hits;
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
 * "u!" + base64url(webUrl) — algoritmo documentado por Microsoft para
 * convertir cualquier URL de compartir/abrir en un "shareId" resoluble
 * con `GET /shares/{shareId}/driveItem`. Ver
 * https://learn.microsoft.com/graph/api/shares-get
 */
function encodeShareUrl(webUrl: string): string {
  const base64 = Buffer.from(webUrl, "utf-8").toString("base64");
  const base64Url = base64
    .replace(/=+$/, "")
    .replace(/\//g, "_")
    .replace(/\+/g, "-");
  return `u!${base64Url}`;
}

/**
 * Resuelve un `driveItem` completo (con `parentReference.driveId`/`path`)
 * a partir de SOLO su `webUrl` — que la API de Microsoft Search SIEMPRE
 * devuelve, a diferencia de `parentReference` (bug real confirmado en
 * producción: `parentReference` puede venir vacío en la respuesta de
 * `/search/query` incluso pidiéndolo explícito en `fields`). Fallback
 * robusto para cuando eso pasa — nunca falla por depender de un campo que
 * la API no garantiza.
 */
export async function resolveDriveItemFromWebUrl(
  accessToken: string,
  webUrl: string,
): Promise<{
  id: string;
  parentReference: { driveId: string; path?: string };
} | null> {
  try {
    const shareId = encodeShareUrl(webUrl);
    const res = await graphFetch(
      accessToken,
      `/shares/${shareId}/driveItem?$select=id,parentReference`,
    );
    const json = (await res.json()) as {
      id: string;
      parentReference?: { driveId?: string; path?: string };
    };
    if (!json.parentReference?.driveId) return null;
    return {
      id: json.id,
      parentReference: {
        driveId: json.parentReference.driveId,
        path: json.parentReference.path,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Garantiza que un hit tenga `parentReference.driveId` — lo resuelve vía
 * `resolveDriveItemFromWebUrl` si la búsqueda no lo trajo. Usar SIEMPRE
 * antes de descargar un archivo elegido por `pickLatestMatch`.
 */
export async function ensureDriveId(
  accessToken: string,
  hit: GraphSearchHit,
): Promise<GraphSearchHit> {
  if (hit.parentReference?.driveId) return hit;
  const resuelto = await resolveDriveItemFromWebUrl(accessToken, hit.webUrl);
  if (!resuelto) return hit;
  return {
    ...hit,
    id: resuelto.id,
    parentReference: {
      driveId: resuelto.parentReference.driveId,
      path: resuelto.parentReference.path ?? hit.parentReference?.path,
    },
  };
}

/**
 * De una lista de resultados de búsqueda, elige el más reciente
 * (`lastModifiedDateTime` real, NUNCA por nombre) cuya ruta de carpeta
 * padre y nombre matcheen los patrones dados.
 *
 * `folderIncludes` se compara contra `parentReference.path` cuando existe
 * y, si no, contra el `webUrl` decodificado (bug real: `parentReference`
 * puede venir vacío desde `/search/query` — ver `ensureDriveId` — pero
 * `webUrl` SIEMPRE viene, y contiene la misma ruta URL-encoded).
 */
export function pickLatestMatch(
  hits: GraphSearchHit[],
  opts: { folderIncludes?: string; nameExtension?: string },
): GraphSearchHit | null {
  const rutaDe = (hit: GraphSearchHit): string => {
    if (hit.parentReference?.path) return hit.parentReference.path;
    try {
      return decodeURIComponent(hit.webUrl);
    } catch {
      return hit.webUrl;
    }
  };

  const filtered = hits.filter((hit) => {
    if (
      opts.folderIncludes &&
      !rutaDe(hit).toLowerCase().includes(opts.folderIncludes.toLowerCase())
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
