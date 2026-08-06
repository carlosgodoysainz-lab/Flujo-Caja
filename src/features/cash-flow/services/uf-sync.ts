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
    // mindicador.cl confirmado real: a veces responde en ~7s, a veces no
    // responde NADA por 15s+ (verificado con curl -v: conexión TLS
    // establecida, request enviado, 0 bytes recibidos) — no es una caída
    // dura, es un servicio público lento/inconsistente bajo carga. 3
    // intentos con timeout creciente antes de rendirse; correr los años
    // en PARALELO (ver abajo) además de esto.
    const TIMEOUTS_MS = [15_000, 30_000, 45_000];
    for (const [i, timeoutMs] of TIMEOUTS_MS.entries()) {
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
        if (i === TIMEOUTS_MS.length - 1) {
          return {
            anio,
            serie: null,
            error: e instanceof Error ? e.message : String(e),
          };
        }
        // intento fallido, se reintenta con timeout más largo
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
