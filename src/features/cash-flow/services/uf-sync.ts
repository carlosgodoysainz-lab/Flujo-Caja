"use server";

import { createServiceClient } from "@/lib/supabase/service";

interface MindicadorPunto {
  fecha: string;
  valor: number;
}

/**
 * Sincroniza la serie de UF real desde mindicador.cl (API pública del
 * Banco Central/SII de Chile) — reemplaza el placeholder manual del
 * Excel original ("+1% mensual, dato real no disponible aún", ver
 * TECH-SPEC §7). Se llama automáticamente como parte del refresh
 * completo (Fase 7) y puede re-ejecutarse cuando se quiera.
 */
export async function syncUfSeries(
  periodoDesde: Date,
  periodoHasta: Date,
): Promise<{
  estado: "ok" | "error";
  puntosGuardados: number;
  errores: string[];
}> {
  const supabase = createServiceClient();
  const errores: string[] = [];
  let puntosGuardados = 0;

  const anioDesde = periodoDesde.getFullYear();
  const anioHasta = periodoHasta.getFullYear();

  for (let anio = anioDesde; anio <= anioHasta; anio++) {
    try {
      const res = await fetch(`https://mindicador.cl/api/uf/${anio}`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        errores.push(`mindicador.cl ${anio}: HTTP ${res.status}`);
        continue;
      }
      const json = (await res.json()) as { serie: MindicadorPunto[] };
      const filas = json.serie.map((p) => ({
        fecha: p.fecha.slice(0, 10),
        valor_uf: p.valor,
        es_real: true,
        fuente: "sii" as const,
      }));

      const { error } = await supabase
        .from("uf_series")
        .upsert(filas, { onConflict: "fecha" });
      if (error) {
        errores.push(`Error guardando UF ${anio}: ${error.message}`);
      } else {
        puntosGuardados += filas.length;
      }
    } catch (e) {
      errores.push(
        `mindicador.cl ${anio}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return {
    estado: errores.length > 0 && puntosGuardados === 0 ? "error" : "ok",
    puntosGuardados,
    errores,
  };
}
