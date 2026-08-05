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
    // Opacidad vía rgba() fijo, NO `bg-[var(--warn)]/NN` — ese patrón
    // (modificador de opacidad de Tailwind sobre una variable CSS definida
    // como hex, no como canales RGB separados) falla en silencio y deja el
    // fondo transparente. Mismo bug real que rompía el nav (ver
    // Auto-Blindaje) — rgb(184,134,11) = var(--warn) = #b8860b.
    <div
      className="rounded-lg border p-4"
      style={{
        borderColor: "rgba(184, 134, 11, 0.3)",
        backgroundColor: "rgba(184, 134, 11, 0.05)",
      }}
    >
      <p className="text-sm font-medium text-[var(--warn)]">
        ⚠ {obrasUnicas.length} obra(s) con dotación estimada por el modelo (no
        manual/real)
      </p>
      <p className="mt-1 text-xs text-slate-500">{obrasUnicas.join(", ")}</p>
    </div>
  );
}
