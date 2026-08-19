"use server";

import { auth } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { overrideSchema } from "./override-schema";

export interface OverrideResult {
  estado: "ok" | "error";
  errores: string[];
}

/**
 * Ajuste manual de un valor de cash_flow_monthly — Blueprint T-4.2.4
 * (implementada en Fase 9 al cerrar la auditoría de trazabilidad, ver
 * TECH-SPEC §6.4). Todo override queda registrado en `audit_log` Y en
 * las columnas `overridden_by`/`overridden_at` de la fila misma — doble
 * trazabilidad para un dato financiero sensible.
 */
export async function overrideCashFlowValue(
  periodo: Date,
  concepto: string,
  monto: number,
): Promise<OverrideResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { estado: "error", errores: ["Sesión no disponible."] };
  }

  const parsed = overrideSchema.safeParse({ periodo, concepto, monto });
  if (!parsed.success) {
    return {
      estado: "error",
      errores: parsed.error.issues.map((i) => i.message),
    };
  }

  const supabase = createServiceClient();
  const periodoStr = parsed.data.periodo.toISOString().slice(0, 10);

  const { data: anterior } = await supabase
    .from("cash_flow_monthly")
    .select("monto, es_real, metodo_calculo")
    .eq("periodo", periodoStr)
    .eq("concepto", parsed.data.concepto)
    .maybeSingle();

  const { error } = await supabase.from("cash_flow_monthly").upsert(
    {
      periodo: periodoStr,
      concepto: parsed.data.concepto,
      monto: parsed.data.monto,
      es_real: true,
      metodo_calculo: "manual_override",
      overridden_by: session.user.id,
      overridden_at: new Date().toISOString(),
    },
    { onConflict: "periodo,concepto" },
  );

  if (error) {
    return { estado: "error", errores: [error.message] };
  }

  await supabase.from("audit_log").insert({
    actor_id: session.user.id,
    accion: "override_cash_flow_value",
    entidad: "cash_flow_monthly",
    metadata: {
      periodo: periodoStr,
      concepto: parsed.data.concepto,
      montoAnterior: anterior?.monto ?? null,
      metodoAnterior: anterior?.metodo_calculo ?? null,
      montoNuevo: parsed.data.monto,
    },
  });

  return { estado: "ok", errores: [] };
}
