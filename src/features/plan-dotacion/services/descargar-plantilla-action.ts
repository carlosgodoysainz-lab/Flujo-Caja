"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { generarPlantillaPlanDotacion } from "./generar-plantilla";
import { getSaldoInicialPorObra } from "@/features/headcount/services/plan-obra-dotacion";

export interface DescargarPlantillaResult {
  estado: "ok" | "error";
  /** Base64 — Server Actions no serializan Buffer directo al cliente. */
  archivoBase64?: string;
  nombreArchivo?: string;
  errores: string[];
}

const MESES_ADELANTE = 15;

/**
 * Genera la plantilla "Plan Dotación Obras.xlsx" para descargar desde
 * /dotación — precargada con las obras vigentes de Gespro, la dotación
 * real de hoy (informativa), el plan vigente (si ya hay uno cargado en
 * `plan_dotacion`) y los eventos existentes.
 */
export async function descargarPlantillaPlanDotacion(): Promise<DescargarPlantillaResult> {
  const supabase = createServiceClient();

  try {
    const { data: obras } = await supabase
      .from("obras")
      .select("id, nombre, fin_obra")
      .order("nombre");

    const { data: planRows } = await supabase
      .from("plan_dotacion")
      .select("obra_id, periodo, variacion_neta");

    const { data: eventoRows } = await supabase
      .from("plan_eventos")
      .select(
        "periodo, concepto, modo, monto, obra_id, poblacion, descripcion",
      );

    const obraNombrePorId = new Map(
      (obras ?? []).map((o) => [o.id as string, o.nombre as string]),
    );

    const planExistentePorClave = new Map<string, number>();
    for (const fila of planRows ?? []) {
      const clave = `${fila.obra_id ?? ""}::${fila.periodo}`;
      planExistentePorClave.set(clave, fila.variacion_neta);
    }

    const eventosExistentes = (eventoRows ?? []).map((e) => ({
      periodo: e.periodo as string,
      concepto: e.concepto as "remuneracion" | "anticipo",
      modo: e.modo as "monto_total" | "por_persona",
      monto: Number(e.monto),
      obraNombre: e.obra_id ? (obraNombrePorId.get(e.obra_id) ?? null) : null,
      poblacion: e.poblacion as "rg" | "rp" | null,
      descripcion: e.descripcion as string | null,
    }));

    const dotacionRealPorObra = await getSaldoInicialPorObra();

    const hoy = new Date();
    const periodos: string[] = [];
    for (let i = 0; i < MESES_ADELANTE; i++) {
      const mes = new Date(hoy.getFullYear(), hoy.getMonth() + i, 1);
      periodos.push(mes.toISOString().slice(0, 10));
    }

    const buffer = await generarPlantillaPlanDotacion({
      obras: (obras ?? []).map((o) => ({
        id: o.id as string,
        nombre: o.nombre as string,
        finObra: o.fin_obra as string | null,
      })),
      planExistentePorClave,
      eventosExistentes,
      dotacionRealPorObra,
      periodos,
      generadoEn: hoy,
    });

    return {
      estado: "ok",
      archivoBase64: buffer.toString("base64"),
      nombreArchivo: `Plan Dotacion Obras ${hoy.toISOString().slice(0, 10)}.xlsx`,
      errores: [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { estado: "error", errores: [message] };
  }
}
