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

/**
 * Búsqueda de archivos por texto libre, en todo lo que el usuario puede
 * ver (propio + compartido con él). El filtrado por carpeta/nombre es
 * client-side (ver `pickLatestMatch`) porque el naming real en SharePoint
 * es inconsistente (confirmado: singular/plural, sufijos, "Nueva carpeta").
 */
export async function searchFiles(
  accessToken: string,
  query: string,
): Promise<GraphSearchHit[]> {
  const res = await graphFetch(
    accessToken,
    `/me/drive/root/search(q='${encodeURIComponent(query)}')`,
  );
  const json = await res.json();
  return (json.value ?? []) as GraphSearchHit[];
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
