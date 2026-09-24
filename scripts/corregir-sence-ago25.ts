/**
 * Corrección puntual (24-sep-2026) — hallazgo del checkpoint de la Fase 3:
 * `cash_flow_monthly` tiene SENCE de 2025-08-01 = $1.354.905.679, idéntico
 * al Total Nómina de ese mes (bug de ingesta histórica de hace tiempo). El
 * Excel tradicional del usuario trae esa celda vacía = $0. Aplica el mismo
 * mecanismo que `overrideCashFlowValue` (override.ts): pone SENCE en $0,
 * marca `metodo_calculo = "manual_override"` (se preserva en refreshes
 * futuros) y registra `audit_log`.
 *
 * Uso: npx tsx --env-file=.env.local scripts/corregir-sence-ago25.ts
 */
import { createClient } from "@supabase/supabase-js";

const PERIODO = "2025-08-01";
const CONCEPTO = "sence";
const MONTO_CORRECTO = 0;
// Perfil de Carlos Godoy (carlos.godoy@maestra.cl) — quien pidió la
// corrección, 24-sep-2026.
const ACTOR_ID = "42bf702a-06dc-44cc-9885-78331d71c0d1";

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: anterior, error: errorLectura } = await supabase
    .from("cash_flow_monthly")
    .select("monto, es_real, metodo_calculo")
    .eq("periodo", PERIODO)
    .eq("concepto", CONCEPTO)
    .maybeSingle();
  if (errorLectura) throw new Error(errorLectura.message);
  if (!anterior) throw new Error(`No existe fila ${PERIODO}/${CONCEPTO}.`);

  console.log("Antes:", anterior);

  const { error: errorUpsert } = await supabase
    .from("cash_flow_monthly")
    .upsert(
      {
        periodo: PERIODO,
        concepto: CONCEPTO,
        monto: MONTO_CORRECTO,
        es_real: true,
        metodo_calculo: "manual_override",
        overridden_by: ACTOR_ID,
        overridden_at: new Date().toISOString(),
      },
      { onConflict: "periodo,concepto" },
    );
  if (errorUpsert) throw new Error(errorUpsert.message);

  const { error: errorAudit } = await supabase.from("audit_log").insert({
    actor_id: ACTOR_ID,
    accion: "override_cash_flow_value",
    entidad: "cash_flow_monthly",
    metadata: {
      periodo: PERIODO,
      concepto: CONCEPTO,
      montoAnterior: anterior.monto,
      metodoAnterior: anterior.metodo_calculo,
      montoNuevo: MONTO_CORRECTO,
      motivo:
        "Bug de ingesta histórica: SENCE quedó igual al Total Nómina del mes. El Excel tradicional trae esa celda vacía. Corregido vía script tras el checkpoint de comparación de la Fase 3.",
    },
  });
  if (errorAudit) throw new Error(errorAudit.message);

  const { data: despues } = await supabase
    .from("cash_flow_monthly")
    .select("monto, es_real, metodo_calculo, overridden_at")
    .eq("periodo", PERIODO)
    .eq("concepto", CONCEPTO)
    .single();
  console.log("Después:", despues);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
