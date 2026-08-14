export interface ObraParaMatch {
  id: string;
  nombre: string;
}

function normalize(s: string): string {
  return s
    .replace(/^obra\s+/i, "")
    .trim()
    .toLowerCase();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Alias manuales para nombres de área de Buk que NO coinciden ni exacta
 * ni parcialmente con el nombre de la obra en Gespro/`obras`, pero SÍ son
 * la misma obra en la realidad — descubierto auditando dotación en vivo
 * (13-ago-2026): "Obra Serrano Torre A" (Buk) vs. "Serrano A" (obras) no
 * comparten ninguna palabra en común ("torre" las separa), así que ni el
 * match exacto ni el parcial por palabra los conecta — 98 trabajadores de
 * obra quedaban cayendo al balde "Oficina Central" por esto. Clave =
 * nombre de área normalizado (sin prefijo "obra ", minúscula); valor =
 * nombre de la obra tal cual aparece en `obras.nombre`.
 */
const ALIAS_MANUAL: Record<string, string> = {
  "serrano torre a": "serrano a",
};

/**
 * Matching por nombre, tolerante a prefijos ("Obra X" -> "X"). Best-effort
 * a propósito — no toda área/división de Buk o SharePoint corresponde a
 * una obra (oficinas centrales, gerencias, etc.), eso es esperado.
 *
 * Exact match primero, y el fallback parcial usa límites de palabra
 * (`\b`), NUNCA substring crudo — un substring crudo confunde nombres
 * como "Lira I" vs "Lira II" (el primero es substring literal del
 * segundo), y esos nombres SÍ existen en las obras reales.
 */
export function matchObraByName(
  texto: string,
  obras: ObraParaMatch[],
): ObraParaMatch | null {
  const normalizado = normalize(texto);
  if (!normalizado) return null;

  const exacto = obras.find((o) => normalize(o.nombre) === normalizado);
  if (exacto) return exacto;

  const porPalabra = obras.find((o) => {
    const nombreObra = normalize(o.nombre);
    const reNombreObraEnTexto = new RegExp(`\\b${escapeRegex(nombreObra)}\\b`);
    const reTextoEnNombreObra = new RegExp(`\\b${escapeRegex(normalizado)}\\b`);
    return (
      reNombreObraEnTexto.test(normalizado) ||
      reTextoEnNombreObra.test(nombreObra)
    );
  });
  if (porPalabra) return porPalabra;

  const alias = ALIAS_MANUAL[normalizado];
  if (alias) {
    const porAlias = obras.find((o) => normalize(o.nombre) === alias);
    if (porAlias) return porAlias;
  }

  return null;
}
