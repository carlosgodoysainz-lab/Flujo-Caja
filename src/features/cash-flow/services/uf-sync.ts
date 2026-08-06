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
  const anios: number[] = [];
  for (let anio = anioDesde; anio <= anioHasta; anio++) anios.push(anio);

  async function fetchAnioConReintento(anio: number): Promise<{
    anio: number;
    serie: MindicadorPunto[] | null;
    error: string | null;
  }> {
    // 1 reintento con timeout más largo — visto en producción: los 3 años
    // del rango dieron timeout SEGUIDOS (secuencial, ~15s cada uno = 45s
    // total) contra la API pública de mindicador.cl, que puede estar lenta
    // o momentáneamente caída. Correr los años en PARALELO (ver abajo) ya
    // reduce el tiempo total de espera; el reintento cubre una lentitud
    // puntual de un solo año sin fallar el refresh completo por eso.
    for (const timeoutMs of [15_000, 25_000]) {
      try {
        const res = await fetch(`https://mindicador.cl/api/uf/${anio}`, {
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) {
          return { anio, serie: null, error: `HTTP ${res.status}` };
        }
        const json = (await res.json()) as { serie: MindicadorPunto[] };
        return { anio, serie: json.serie, error: null };
      } catch (e) {
        if (timeoutMs === 25_000) {
          return {
            anio,
            serie: null,
            error: e instanceof Error ? e.message : String(e),
          };
        }
        // primer intento falló, se reintenta con timeout más largo
      }
    }
    return { anio, serie: null, error: "no se pudo completar la solicitud" };
  }

  // En paralelo, no secuencial — antes 3 años con timeout = 45s de espera
  // acumulada; el fallo de un año no debe demorar la comprobación de los
  // otros.
  const resultados = await Promise.all(anios.map(fetchAnioConReintento));

  for (const { anio, serie, error } of resultados) {
    if (error || !serie) {
      errores.push(`mindicador.cl ${anio}: ${error ?? "sin datos"}`);
      continue;
    }
    const filas = serie.map((p) => ({
      fecha: p.fecha.slice(0, 10),
      valor_uf: p.valor,
      es_real: true,
      fuente: "sii" as const,
    }));

    const { error: dbError } = await supabase
      .from("uf_series")
      .upsert(filas, { onConflict: "fecha" });
    if (dbError) {
      errores.push(`Error guardando UF ${anio}: ${dbError.message}`);
    } else {
      puntosGuardados += filas.length;
    }
  }

  return {
    estado: errores.length > 0 && puntosGuardados === 0 ? "error" : "ok",
    puntosGuardados,
    errores,
  };
}
