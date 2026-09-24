import { createServiceClient } from "@/lib/supabase/service";
import { getSaldoInicialPorObra } from "@/features/headcount/services/plan-obra-dotacion";
import {
  detectarObrasCerradasSinPlan,
  type AlertaObraCerrada,
  type PlanDotacionVariacion,
} from "./resolver-dotacion";

/**
 * Obras con fecha de término vencida, dotación real > 0 y sin plan de
 * cierre — misma regla que muestra /dotacion, para que el Excel exportado
 * lleve las mismas alertas (Fase 3, 24-sep-2026).
 */
export async function getAlertasObrasCerradasSinPlan(): Promise<
  AlertaObraCerrada[]
> {
  const supabase = createServiceClient();
  const { data: obras } = await supabase
    .from("obras")
    .select("id, nombre, fin_obra");

  // Paginado con `.range()` — mismo patrón que `getSaldoInicialPorObra`
  // (PostgREST trunca en silencio a ~1000 filas).
  const variaciones: PlanDotacionVariacion[] = [];
  const TAMANO_PAGINA = 1000;
  for (let desde = 0; ; desde += TAMANO_PAGINA) {
    const { data: pagina } = await supabase
      .from("plan_dotacion")
      .select("obra_id, periodo, variacion_neta")
      .range(desde, desde + TAMANO_PAGINA - 1);
    if (!pagina || pagina.length === 0) break;
    for (const r of pagina)
      variaciones.push({
        obraId: r.obra_id,
        periodo: r.periodo,
        variacionNeta: r.variacion_neta,
      });
    if (pagina.length < TAMANO_PAGINA) break;
  }

  return detectarObrasCerradasSinPlan({
    obras: (obras ?? []).map((o) => ({
      id: o.id as string,
      nombre: o.nombre as string,
      finObra: o.fin_obra as string | null,
    })),
    variaciones,
    dotacionRealPorObra: await getSaldoInicialPorObra(),
    hoyStr: new Date().toISOString().slice(0, 10),
  });
}
