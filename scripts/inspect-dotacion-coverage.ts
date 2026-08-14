// Inspección de cobertura real de datos de dotación — para diagnosticar
// si el modelo de curva de obras similares tiene suficiente histórico
// real de Buk para no caer en "0 silencioso" por falta de dato.
// Ejecutar con: npx tsx --env-file=.env.local scripts/inspect-dotacion-coverage.ts
import { createClient } from "@supabase/supabase-js";

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: snapshots } = await supabase
    .from("buk_dotacion_snapshots")
    .select("snapshot_date, obra_id, activos")
    .order("snapshot_date");

  const fechas = [...new Set((snapshots ?? []).map((s) => s.snapshot_date))];
  const obrasConSnapshot = new Set(
    (snapshots ?? []).filter((s) => s.obra_id).map((s) => s.obra_id),
  );
  console.log(`buk_dotacion_snapshots: ${snapshots?.length ?? 0} filas`);
  console.log(
    `Fechas de corte distintas: ${fechas.length} (${fechas[0]} a ${fechas.at(-1)})`,
  );
  console.log(
    `Obras distintas con al menos 1 snapshot: ${obrasConSnapshot.size}`,
  );

  const { data: obras } = await supabase
    .from("obras")
    .select("id, nombre, inicio_obra, dur_obra_meses, fin_obra");
  console.log(`\nTotal obras en catálogo: ${obras?.length ?? 0}`);
  const conFechas = (obras ?? []).filter(
    (o) => o.inicio_obra && o.dur_obra_meses,
  );
  console.log(
    `Obras con inicio_obra + dur_obra_meses (elegibles para curva): ${conFechas.length}`,
  );
  console.log(
    `Obras con AL MENOS 1 snapshot real de Buk: ${obrasConSnapshot.size} de ${conFechas.length} elegibles`,
  );

  const { data: hbo } = await supabase
    .from("headcount_by_obra")
    .select("obra_id, periodo, variacion_neta, origen");
  const estimados = (hbo ?? []).filter((h) => h.origen === "modelo_estimado");
  const estimadosEnCero = estimados.filter((h) => h.variacion_neta === 0);
  console.log(`\nheadcount_by_obra: ${hbo?.length ?? 0} filas totales`);
  console.log(`  origen='modelo_estimado': ${estimados.length}`);
  console.log(
    `  de esos, variacion_neta === 0: ${estimadosEnCero.length} (${estimados.length > 0 ? ((estimadosEnCero.length / estimados.length) * 100).toFixed(0) : 0}%)`,
  );
  const buk_real = (hbo ?? []).filter((h) => h.origen === "buk_real").length;
  const manual = (hbo ?? []).filter((h) => h.origen === "manual").length;
  console.log(`  origen='buk_real': ${buk_real}`);
  console.log(`  origen='manual': ${manual}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
