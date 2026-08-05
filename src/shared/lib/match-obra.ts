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

  return (
    obras.find((o) => {
      const nombreObra = normalize(o.nombre);
      const reNombreObraEnTexto = new RegExp(
        `\\b${escapeRegex(nombreObra)}\\b`,
      );
      const reTextoEnNombreObra = new RegExp(
        `\\b${escapeRegex(normalizado)}\\b`,
      );
      return (
        reNombreObraEnTexto.test(normalizado) ||
        reTextoEnNombreObra.test(nombreObra)
      );
    }) ?? null
  );
}
