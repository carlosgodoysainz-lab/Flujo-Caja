/**
 * Script de investigación manual — NO es parte de la app. Rastrea el
 * origen de una variación neta sospechosa en headcount_by_obra para 1+
 * obras: filas de headcount_by_obra, el forecast_run que las generó, y
 * los snapshots reales de Buk alrededor del mes en cuestión.
 *
 * Uso: npx tsx --env-file=.env.local scripts/investigar-caida-headcount.ts "Vista Llacolén B" "Lira Parque"
 */
import { createClient } from "@supabase/supabase-js";

async function main() {
  const nombres = process.argv.slice(2);
  if (nombres.length === 0) {
    console.error(
      'Uso: npx tsx --env-file=.env.local scripts/investigar-caida-headcount.ts "Nombre Obra" [...]',
    );
    process.exit(1);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: obras } = await supabase.from("obras").select("*");
  for (const nombreBuscado of nombres) {
    const obra = (obras ?? []).find((o) =>
      o.nombre.toLowerCase().includes(nombreBuscado.toLowerCase()),
    );
    console.log(`\n\n========== ${nombreBuscado} ==========`);
    if (!obra) {
      console.log(
        "No encontrada. Obras disponibles:",
        (obras ?? []).map((o) => o.nombre),
      );
      continue;
    }
    console.log("Obra:", obra.nombre, "| id:", obra.id);
    console.log(
      "inicio_obra:",
      obra.inicio_obra,
      "| fin_obra:",
      obra.fin_obra,
      "| dur_obra_meses:",
      obra.dur_obra_meses,
      "| unidades:",
      obra.unidades,
      "| tipo:",
      obra.tipo,
      "| activa:",
      obra.activa,
    );

    const { data: filas } = await supabase
      .from("headcount_by_obra")
      .select(
        "periodo, variacion_neta, acumulado, origen, forecast_run_id, created_at",
      )
      .eq("obra_id", obra.id)
      .order("periodo", { ascending: true });

    console.log("\n--- headcount_by_obra (todas las filas) ---");
    for (const f of filas ?? []) {
      console.log(
        `${f.periodo.slice(0, 7)} | variacion_neta=${f.variacion_neta} | acumulado=${f.acumulado} | origen=${f.origen} | forecast_run_id=${f.forecast_run_id ?? "-"}`,
      );
    }

    const runIds = [
      ...new Set((filas ?? []).map((f) => f.forecast_run_id).filter(Boolean)),
    ];
    if (runIds.length > 0) {
      const { data: runs } = await supabase
        .from("headcount_forecast_runs")
        .select("*")
        .in("id", runIds as string[]);
      console.log("\n--- headcount_forecast_runs usados por esta obra ---");
      for (const r of runs ?? []) {
        console.log(JSON.stringify(r, null, 2));
      }
    }

    const { data: snapshots } = await supabase
      .from("buk_dotacion_snapshots")
      .select("snapshot_date, activos, cargo_id")
      .eq("obra_id", obra.id)
      .order("snapshot_date", { ascending: true });
    console.log(
      `\n--- buk_dotacion_snapshots propios (${snapshots?.length ?? 0} filas) ---`,
    );
    // Agrupar por fecha, sumar activos.
    const porFecha = new Map<string, number>();
    for (const s of snapshots ?? []) {
      porFecha.set(
        s.snapshot_date,
        (porFecha.get(s.snapshot_date) ?? 0) + s.activos,
      );
    }
    for (const [fecha, total] of [...porFecha.entries()].sort()) {
      console.log(`${fecha}: ${total} activos`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
