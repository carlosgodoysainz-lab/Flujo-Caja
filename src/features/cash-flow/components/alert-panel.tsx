import { createServiceClient } from "@/lib/supabase/service";
import { detectarObrasSinPlan } from "@/features/plan-dotacion/services/resolver-dotacion";

/**
 * Obras vigentes sin ninguna fila cargada en el Plan de Dotación del
 * usuario (Fase 2, 24-sep-2026) — reemplaza la alerta anterior de "obras
 * con dotación estimada por el modelo" (el modelo estadístico se retiró).
 */
export async function AlertPanel() {
  const supabase = createServiceClient();
  const { data: obras } = await supabase
    .from("obras")
    .select("id, nombre, fin_obra");
  const { data: planRows } = await supabase
    .from("plan_dotacion")
    .select("obra_id")
    .eq("unidad", "obra");

  const hoyStr = new Date().toISOString().slice(0, 10);
  const obrasSinPlan = detectarObrasSinPlan({
    obras: (obras ?? []).map((o) => ({
      id: o.id as string,
      nombre: o.nombre as string,
      finObra: o.fin_obra as string | null,
    })),
    variaciones: (planRows ?? []).map((p) => ({
      obraId: p.obra_id as string,
      periodo: "",
      variacionNeta: 0,
    })),
    hoyStr,
  });

  const obrasUnicas = obrasSinPlan.map((o) => o.nombre);

  if (obrasUnicas.length === 0) return null;

  return (
    // Opacidad vía rgba() fijo, NO `bg-[var(--warn)]/NN` — ese patrón
    // (modificador de opacidad de Tailwind sobre una variable CSS definida
    // como hex, no como canales RGB separados) falla en silencio y deja el
    // fondo transparente. Mismo bug real que rompía el nav (ver
    // Auto-Blindaje) — rgb(122,82,9) = var(--warn) = #7a5209 (oscurecido
    // 18-ago-2026, auditoría /temple — el valor viejo #b8860b fallaba
    // contraste WCAG).
    <div
      className="rounded-lg border p-4"
      style={{
        borderColor: "rgba(122, 82, 9, 0.3)",
        backgroundColor: "rgba(122, 82, 9, 0.05)",
      }}
    >
      <p className="text-sm font-medium text-[var(--warn)]">
        ⚠ {obrasUnicas.length} obra(s) vigentes sin Plan de Dotación cargado —
        su dotación se mantiene plana
      </p>
      <p className="mt-1 text-xs text-slate-500">{obrasUnicas.join(", ")}</p>
    </div>
  );
}
