import { createClient } from "@supabase/supabase-js";

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data } = await supabase
    .from("cash_flow_monthly")
    .select("periodo, concepto, monto, es_real, metodo_calculo")
    .gte("periodo", "2025-09-01")
    .order("periodo", { ascending: true });

  const porPeriodoConcepto = new Map<string, number>();
  for (const r of data ?? []) {
    porPeriodoConcepto.set(`${r.periodo}::${r.concepto}`, r.monto);
  }
  const periodos = [...new Set((data ?? []).map((r) => r.periodo))].sort();

  console.log("periodo\tRemuneracion\tAnticipo\t%Ant\tReliquidacion\t%Reliq\tCotizacion\t%Cotiz\tFiniquito\t%Finiq/Remun");
  const anticipoPcts: number[] = [];
  const reliqPcts: number[] = [];
  const cotizPcts: number[] = [];
  const finiqPcts: number[] = [];
  for (const p of periodos) {
    const rem = porPeriodoConcepto.get(`${p}::remuneracion`);
    const ant = porPeriodoConcepto.get(`${p}::anticipo`);
    const reliq = porPeriodoConcepto.get(`${p}::reliquidacion`);
    const cotiz = porPeriodoConcepto.get(`${p}::cotizacion`);
    const finiq = porPeriodoConcepto.get(`${p}::finiquito`);
    if (rem == null) continue;
    const pctAnt = ant != null ? ant / rem : null;
    const pctReliq = reliq != null ? reliq / rem : null;
    const base = (ant ?? 0) + rem + (reliq ?? 0);
    const pctCotiz = cotiz != null ? cotiz / base : null;
    const pctFiniq = finiq != null ? finiq / rem : null;
    if (pctAnt != null) anticipoPcts.push(pctAnt);
    if (pctReliq != null) reliqPcts.push(pctReliq);
    if (pctCotiz != null) cotizPcts.push(pctCotiz);
    if (pctFiniq != null) finiqPcts.push(pctFiniq);
    console.log(
      `${p.slice(0,7)}\t${rem.toLocaleString("es-CL")}\t${ant?.toLocaleString("es-CL") ?? "-"}\t${pctAnt ? (pctAnt*100).toFixed(1)+"%" : "-"}\t${reliq?.toLocaleString("es-CL") ?? "-"}\t${pctReliq ? (pctReliq*100).toFixed(1)+"%" : "-"}\t${cotiz?.toLocaleString("es-CL") ?? "-"}\t${pctCotiz ? (pctCotiz*100).toFixed(1)+"%" : "-"}\t${finiq?.toLocaleString("es-CL") ?? "-"}\t${pctFiniq ? (pctFiniq*100).toFixed(1)+"%" : "-"}`
    );
  }
  const avg = (arr: number[]) => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null;
  console.log("\n=== Promedios reales (base de lo que el sistema auto-aprende) ===");
  console.log("Anticipo/Remuneración promedio:", avg(anticipoPcts.slice(-6)));
  console.log("Reliquidación/Remuneración promedio:", avg(reliqPcts.slice(-6)));
  console.log("Cotización/Base promedio:", avg(cotizPcts.slice(-6)));
  console.log("Finiquito/Remuneración promedio (informativo, ya no se usa como %):", avg(finiqPcts.slice(-6)));
}
main().catch((e) => { console.error(e); process.exit(1); });
