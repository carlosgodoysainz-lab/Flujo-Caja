export interface ObraParaSimilitud {
  id: string;
  nombre: string;
  tipo: string;
  unidades: number | null;
  comuna: string | null;
}

/**
 * Encuentra obras históricas similares a la obra objetivo — método
 * heurístico (no ML), ver TECH-SPEC §3.3 y BLUEPRINT Fase 6.
 *
 * Criterios: mismo tipo (obligatorio), unidades dentro de ±30% (si ambas
 * obras tienen ese dato — si falta, no descarta por ese criterio), y
 * ordenadas priorizando misma comuna primero.
 */
export function obrasSimilares(
  objetivo: ObraParaSimilitud,
  historicas: ObraParaSimilitud[],
): ObraParaSimilitud[] {
  const candidatas = historicas
    .filter((o) => o.id !== objetivo.id)
    .filter((o) => o.tipo === objetivo.tipo)
    .filter((o) => {
      if (
        objetivo.unidades == null ||
        o.unidades == null ||
        objetivo.unidades === 0
      )
        return true;
      const ratio = o.unidades / objetivo.unidades;
      return ratio >= 0.7 && ratio <= 1.3;
    });

  return [...candidatas].sort((a, b) => {
    const aMismaComuna = a.comuna && a.comuna === objetivo.comuna ? 0 : 1;
    const bMismaComuna = b.comuna && b.comuna === objetivo.comuna ? 0 : 1;
    return aMismaComuna - bMismaComuna;
  });
}
