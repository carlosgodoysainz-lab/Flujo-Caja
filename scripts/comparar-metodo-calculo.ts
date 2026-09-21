import { createClient } from "@supabase/supabase-js";

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data } = await supabase
    .from("cash_flow_monthly")
    .select("periodo, concepto, monto, es_real, metodo_calculo")
    .order("periodo", { ascending: true });

  const porMetodo = new Map<string, number>();
  for (const r of data ?? []) {
    const m = r.metodo_calculo ?? "(null)";
    porMetodo.set(m, (porMetodo.get(m) ?? 0) + 1);
  }
  console.log("Filas de cash_flow_monthly por metodo_calculo:");
  for (const [m, n] of [...porMetodo.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n}\t${m}`);
  }

  const historico = (data ?? []).filter((r) => r.metodo_calculo === "ingesta_excel_historico");
  console.log(`\nFilas con ingesta_excel_historico: ${historico.length}`);
  if (historico.length > 0) {
    const periodos = [...new Set(historico.map((r) => r.periodo))].sort();
    console.log("Rango de periodos:", periodos[0], "a", periodos.at(-1));
    console.log("Conceptos presentes:", [...new Set(historico.map((r) => r.concepto))]);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
