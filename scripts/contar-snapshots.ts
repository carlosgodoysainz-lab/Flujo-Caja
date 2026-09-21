import { createClient } from "@supabase/supabase-js";

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { count } = await supabase
    .from("buk_dotacion_snapshots")
    .select("*", { count: "exact", head: true });
  console.log("total filas en buk_dotacion_snapshots:", count);

  const { data } = await supabase
    .from("buk_dotacion_snapshots")
    .select("obra_id, snapshot_date");
  console.log(
    "filas devueltas por un select sin .range()/.limit():",
    data?.length,
  );
}

main();
