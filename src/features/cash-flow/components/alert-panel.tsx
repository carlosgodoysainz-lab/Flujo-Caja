import { createServiceClient } from "@/lib/supabase/service";

export async function AlertPanel() {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("headcount_by_obra")
    .select("obra_id, obras(nombre)")
    .eq("origen", "modelo_estimado");

  const obrasUnicas = [
    ...new Map(
      (data ?? []).map((d) => [
        d.obra_id,
        (d.obras as unknown as { nombre: string } | null)?.nombre,
      ]),
    ).values(),
  ].filter((n): n is string => !!n);

  if (obrasUnicas.length === 0) return null;

  return (
    <div className="rounded-lg border border-[var(--warn)]/30 bg-[var(--warn)]/5 p-4">
      <p className="text-sm font-medium text-[var(--warn)]">
        ⚠ {obrasUnicas.length} obra(s) con dotación estimada por el modelo (no
        manual/real)
      </p>
      <p className="mt-1 text-xs text-slate-500">{obrasUnicas.join(", ")}</p>
    </div>
  );
}
