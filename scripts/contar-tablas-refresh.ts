import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function contar(tabla: string) {
  const { count } = await supabase
    .from(tabla)
    .select("*", { count: "exact", head: true });
  console.log(`${tabla}: ${count}`);
}

async function main() {
  await contar("cash_flow_monthly");
  await contar("payroll_line_items");
  await contar("beneficios_line_items");
}
main();
