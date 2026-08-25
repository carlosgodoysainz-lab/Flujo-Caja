"use server";

import { auth } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import {
  parseHeadcountUpload,
  calcularAcumuladosDesdeSaldoInicial,
  type CeldaHeadcountManual,
} from "./parse-headcount-upload";

export interface HeadcountUploadResult {
  estado: "ok" | "parcial" | "error";
  celdasGuardadas: number;
  errores: string[];
  advertencias: string[];
}

const RESULTADO_VACIO: HeadcountUploadResult = {
  estado: "error",
  celdasGuardadas: 0,
  errores: [],
  advertencias: [],
};

/**
 * Server Action: sube el Excel "Proyección Headcount" ya editado y
 * persiste cada celda válida como `origen='manual'` en
 * `headcount_by_obra` — carga manual, pedido explícito del usuario
 * 25-ago-2026 (en vez de un formulario campo-por-campo): "sube el mismo
 * Excel que ya descargas, edita los números que necesites, vuelve a
 * subirlo". Las filas `manual` quedan protegidas para siempre (nunca las
 * pisa el modelo — ver `ORIGENES_PROTEGIDOS` en `refresh.ts` y el filtro
 * de upsert en `forecast-model/run.ts`).
 *
 * Nunca falla en silencio: siempre reporta cuántas celdas se guardaron y
 * la lista completa de errores/advertencias de fila, aunque solo una
 * parte del archivo sea válida (celdas independientes entre sí — una
 * celda inválida no bloquea las demás de la misma obra).
 */
export async function subirHeadcountManual(
  _prev: HeadcountUploadResult | null,
  formData: FormData,
): Promise<HeadcountUploadResult> {
  const session = await auth();
  const supabase = createServiceClient();

  const archivo = formData.get("archivo");
  if (!(archivo instanceof File) || archivo.size === 0) {
    return {
      ...RESULTADO_VACIO,
      errores: ["No se recibió ningún archivo (.xlsx)."],
    };
  }

  try {
    const buffer = await archivo.arrayBuffer();

    const { data: obras } = await supabase.from("obras").select("id, nombre");
    const obrasConocidas = new Map(
      (obras ?? []).map((o) => [o.id, o.nombre as string]),
    );

    const {
      celdas,
      errores: erroresParseo,
      advertenciasNombre,
    } = await parseHeadcountUpload(buffer, obrasConocidas);

    const erroresFormateados = erroresParseo.map(
      (e) => `${e.obra}${e.periodo ? ` (${e.periodo})` : ""}: ${e.motivo}`,
    );
    const advertenciasFormateadas = advertenciasNombre.map(
      (a) =>
        `Obra ID ${a.obraId}: el nombre en el archivo ("${a.nombreEnArchivo}") no coincide con el nombre real ("${a.nombreReal}") — se usó el ID, no el nombre.`,
    );

    if (celdas.length === 0) {
      return {
        estado: "error",
        celdasGuardadas: 0,
        errores:
          erroresFormateados.length > 0
            ? erroresFormateados
            : [
                "El archivo no tiene ninguna celda de mes con un valor editado.",
              ],
        advertencias: advertenciasFormateadas,
      };
    }

    // Saldo inicial real de Buk por obra (mismo dato que la columna
    // "Saldo Inicial (Buk)" del Excel descargado) — ancla el `acumulado`
    // encadenado. Sin snapshot propio, se asume 0 (se avisa en la
    // respuesta, nunca se esconde el supuesto).
    const obraIds = [...new Set(celdas.map((c) => c.obraId))];
    const { data: snapshots } = await supabase
      .from("buk_dotacion_snapshots")
      .select("obra_id, snapshot_date, activos")
      .in("obra_id", obraIds);
    const maxFechaPorObra = new Map<string, string>();
    for (const s of snapshots ?? []) {
      if (!s.obra_id) continue;
      const actual = maxFechaPorObra.get(s.obra_id);
      if (!actual || s.snapshot_date > actual)
        maxFechaPorObra.set(s.obra_id, s.snapshot_date);
    }
    const saldoInicialPorObra = new Map<string, number>();
    for (const s of snapshots ?? []) {
      if (!s.obra_id) continue;
      if (s.snapshot_date !== maxFechaPorObra.get(s.obra_id)) continue;
      saldoInicialPorObra.set(
        s.obra_id,
        (saldoInicialPorObra.get(s.obra_id) ?? 0) + s.activos,
      );
    }

    const celdasPorObra = new Map<string, CeldaHeadcountManual[]>();
    for (const c of celdas) {
      if (!celdasPorObra.has(c.obraId)) celdasPorObra.set(c.obraId, []);
      celdasPorObra.get(c.obraId)!.push(c);
    }

    const filasAEscribir: {
      obra_id: string;
      periodo: string;
      variacion_neta: number;
      acumulado: number;
      origen: "manual";
      forecast_run_id: null;
      created_by: string | null;
    }[] = [];

    for (const [obraId, celdasObra] of celdasPorObra) {
      const ordenadas = [...celdasObra].sort((a, b) =>
        a.periodo.localeCompare(b.periodo),
      );
      if (!saldoInicialPorObra.has(obraId)) {
        advertenciasFormateadas.push(
          `Obra ID ${obraId}: sin ningún snapshot propio de Buk — se asumió saldo inicial 0 antes del primer mes editado.`,
        );
      }
      const saldoInicial = saldoInicialPorObra.get(obraId) ?? 0;
      const acumuladoPorPeriodo = calcularAcumuladosDesdeSaldoInicial(
        saldoInicial,
        ordenadas,
      );
      for (const c of ordenadas) {
        filasAEscribir.push({
          obra_id: obraId,
          periodo: c.periodo,
          variacion_neta: c.variacionNeta,
          acumulado: acumuladoPorPeriodo.get(c.periodo)!,
          origen: "manual",
          forecast_run_id: null,
          created_by: session?.user?.id ?? null,
        });
      }
    }

    const { error: upsertError } = await supabase
      .from("headcount_by_obra")
      .upsert(filasAEscribir, { onConflict: "obra_id,periodo" });

    if (upsertError) {
      return {
        estado: "error",
        celdasGuardadas: 0,
        errores: [
          ...erroresFormateados,
          `Error guardando en la base de datos: ${upsertError.message}`,
        ],
        advertencias: advertenciasFormateadas,
      };
    }

    await supabase.from("audit_log").insert({
      actor_id: session?.user?.id ?? null,
      accion: "upload_headcount_manual",
      entidad: "headcount_by_obra",
      metadata: {
        celdasGuardadas: filasAEscribir.length,
        obras: obraIds.length,
        erroresDeFila: erroresParseo.length,
      },
    });

    return {
      estado: erroresFormateados.length > 0 ? "parcial" : "ok",
      celdasGuardadas: filasAEscribir.length,
      errores: erroresFormateados,
      advertencias: advertenciasFormateadas,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ...RESULTADO_VACIO, errores: [message] };
  }
}
