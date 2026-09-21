/**
 * Simula la lógica corregida de "vigencia" de estimarDotacionFaltante
 * (refresh.ts) sin correr el refresh completo — para confirmar el fix
 * antes de esperar 8+ minutos.
 */
import { createClient } from "@supabase/supabase-js";

const METODO_ACTUAL = "similar_obras_v6_ancla_real_piso_fisico";

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: yaConDato } = await supabase
    .from("headcount_by_obra")
    .select("obra_id, forecast_run_id");

  const runIds = [
    ...new Set((yaConDato ?? []).map((r) => r.forecast_run_id).filter(Boolean)),
  ];
  const { data: runs } = await supabase
    .from("headcount_forecast_runs")
    .select("id, metodo, ejecutado_at")
    .in("id", runIds as string[]);
  const metodoPorRun = new Map((runs ?? []).map((r) => [r.id, r.metodo]));
  const ejecutadoAtPorRun = new Map(
    (runs ?? []).map((r) => [r.id, r.ejecutado_at]),
  );

  const maxSnapshotPorObra = new Map<string, string>();
  const TAMANO = 1000;
  for (let desde = 0; ; desde += TAMANO) {
    const { data: pagina } = await supabase
      .from("buk_dotacion_snapshots")
      .select("obra_id, snapshot_date")
      .order("snapshot_date")
      .range(desde, desde + TAMANO - 1);
    if (!pagina || pagina.length === 0) break;
    for (const s of pagina) {
      if (!s.obra_id) continue;
      const actual = maxSnapshotPorObra.get(s.obra_id);
      if (!actual || s.snapshot_date > actual)
        maxSnapshotPorObra.set(s.obra_id, s.snapshot_date);
    }
    if (pagina.length < TAMANO) break;
  }
  console.log("Obras con al menos 1 snapshot:", maxSnapshotPorObra.size);

  const { data: obras } = await supabase.from("obras").select("id, nombre");
  const nombrePorObra = new Map((obras ?? []).map((o) => [o.id, o.nombre]));

  const obraIdsConRun = [
    ...new Set(
      (yaConDato ?? []).filter((r) => r.forecast_run_id).map((r) => r.obra_id),
    ),
  ];
  console.log(`\nObras con forecast_run_id (${obraIdsConRun.length}):`);
  let obsoletas = 0;
  for (const obraId of obraIdsConRun) {
    const runId = (yaConDato ?? []).find(
      (r) => r.obra_id === obraId,
    )?.forecast_run_id;
    if (!runId) continue;
    const metodo = metodoPorRun.get(runId);
    const ejecutadoAt = ejecutadoAtPorRun.get(runId);
    const maxSnapshot = maxSnapshotPorObra.get(obraId);
    const metodoVigente = metodo === METODO_ACTUAL;
    const datoObsoleto = !!(
      ejecutadoAt &&
      maxSnapshot &&
      maxSnapshot > ejecutadoAt.slice(0, 10)
    );
    const seReestimara = !metodoVigente || datoObsoleto;
    if (seReestimara) obsoletas++;
    const marca = seReestimara ? "🔴 SE RE-ESTIMARÁ" : "🟢 vigente";
    console.log(
      `${marca} | ${nombrePorObra.get(obraId)} | metodo=${metodo === METODO_ACTUAL ? "actual" : "viejo"} | ejecutado=${ejecutadoAt?.slice(0, 10)} | maxSnapshot=${maxSnapshot} | dato_obsoleto=${datoObsoleto}`,
    );
  }
  console.log(
    `\nTotal que se re-estimarán en el próximo "Actualizar reporte": ${obsoletas} de ${obraIdsConRun.length}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
