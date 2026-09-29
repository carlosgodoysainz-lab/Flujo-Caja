import "server-only";
import { evaluarControles, type ResultadoControl } from "../lib/controles";
import { reunirDatosControles } from "./reunir-datos";

/**
 * Acciones de corrección que el pre-vuelo puede ejecutar. Se inyectan desde
 * `refresh.ts` (que ya tiene los syncs importados) para no crear
 * dependencias circulares entre módulos.
 */
export interface AccionesCorreccion {
  /** Vuelve a leer la dotación en vivo de Buk. */
  repullBuk: () => Promise<void>;
  /** Vuelve a ingerir los archivos de pago de un mes (YYYY-MM-01). */
  reingerirMes: (periodo: string) => Promise<void>;
}

export interface ResultadoPreflight {
  antes: ResultadoControl[];
  despues: ResultadoControl[];
  /** Descripción legible de cada corrección que se ejecutó. */
  correcciones: string[];
}

const MAX_MESES_REINGESTA = 3;

/**
 * Pre-vuelo de "Actualizar reporte" (29-sep-2026, pedido del usuario:
 * "corrija antes de ejecutar el modelo"): corre los controles sobre lo que
 * se acaba de ingerir y, ANTES de calcular el modelo, ejecuta las únicas
 * correcciones que son seguras y no inventan datos:
 *
 *  - Lectura de Buk con salto > 5%  → vuelve a leer Buk una vez (descarta
 *    una lectura cortada o transitoria).
 *  - Documentos leídos parcialmente → vuelve a ingerir ese mes una vez
 *    (descarta un fallo transitorio de Graph).
 *
 * Lo demás (personas de Anticipo > dotación, aguinaldo sin salto, etc.) NO
 * se "corrige" en ejecución: son fallas del lector o de los datos de origen
 * y arreglarlas sin mirar sería inventar cifras. Se dejan a la vista.
 *
 * Nunca lanza: si algo falla al reunir datos o al corregir, lo informa en
 * `correcciones` y el refresh sigue.
 */
export async function ejecutarPreflight(
  acciones: AccionesCorreccion,
): Promise<ResultadoPreflight> {
  const correcciones: string[] = [];
  let antes: ResultadoControl[];
  try {
    antes = evaluarControles(await reunirDatosControles());
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    return {
      antes: [],
      despues: [],
      correcciones: [`No se pudieron ejecutar los controles: ${mensaje}`],
    };
  }

  const alerta = (id: ResultadoControl["id"]) =>
    antes.find((c) => c.id === id)?.estado === "alerta";

  if (alerta("salto_buk")) {
    try {
      await acciones.repullBuk();
      correcciones.push(
        "La dotación de Buk cambió más de 5% entre dos lecturas: se volvió a leer Buk una vez antes de calcular.",
      );
    } catch (error) {
      correcciones.push(
        `No se pudo releer Buk: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (alerta("documentos_parciales")) {
    try {
      const datos = await reunirDatosControles();
      const periodos = [
        ...new Set(
          datos.documentos
            .filter((d) => d.estado !== "ok")
            .map((d) => d.periodo),
        ),
      ]
        .sort()
        .slice(-MAX_MESES_REINGESTA);
      for (const periodo of periodos) await acciones.reingerirMes(periodo);
      if (periodos.length > 0) {
        correcciones.push(
          `Había documentos leídos parcialmente: se volvieron a ingerir ${periodos.map((p) => p.slice(0, 7)).join(", ")} una vez antes de calcular.`,
        );
      }
    } catch (error) {
      correcciones.push(
        `No se pudo reingerir documentos: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (correcciones.length === 0) {
    return { antes, despues: antes, correcciones };
  }
  try {
    const despues = evaluarControles(await reunirDatosControles());
    return { antes, despues, correcciones };
  } catch {
    return { antes, despues: antes, correcciones };
  }
}

/** Controles en solo lectura para el panel de /reporte. */
export async function obtenerControles(): Promise<ResultadoControl[]> {
  return evaluarControles(await reunirDatosControles());
}
