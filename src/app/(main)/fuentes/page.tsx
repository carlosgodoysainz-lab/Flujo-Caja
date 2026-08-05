import { createServiceClient } from "@/lib/supabase/service";
import { SyncObrasButton } from "@/features/obras/components/sync-obras-button";
import { SyncPagosMensualesForm } from "@/features/cash-flow/components/sync-pagos-mensuales-form";

// Sin esto, Next.js prerenderiza la página en build time y congela el
// conteo de obras/última sync para siempre (bug real detectado en build:
// esta ruta salía como estática "○" en vez de dinámica "ƒ").
export const dynamic = "force-dynamic";

export default async function FuentesPage() {
  const supabase = createServiceClient();
  const { count: obrasCount } = await supabase
    .from("obras")
    .select("*", { count: "exact", head: true });
  const { data: ultimaObra } = await supabase
    .from("obras")
    .select("fuente_archivo, fuente_actualizado_at")
    .order("fuente_actualizado_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { count: lineItemsCount } = await supabase
    .from("payroll_line_items")
    .select("*", { count: "exact", head: true });

  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold text-slate-900">
        Fuentes de datos
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Estado de la última sincronización por fuente. Anticipos vía PDF quedan
        fuera del MVP (Fase 10, post-MVP) — ver TECH-SPEC §2.3.
      </p>

      <section className="mt-8 rounded-lg border border-slate-200 p-5">
        <h2 className="font-medium text-slate-900">Plan de Obras Gespro</h2>
        <p className="mt-1 text-sm text-slate-500">
          {obrasCount ?? 0} obras en catálogo
          {ultimaObra?.fuente_archivo && (
            <>
              {" "}
              · última sync desde{" "}
              <code className="text-xs">{ultimaObra.fuente_archivo}</code>
              {ultimaObra.fuente_actualizado_at &&
                ` (${new Date(ultimaObra.fuente_actualizado_at).toLocaleString("es-CL")})`}
            </>
          )}
        </p>
        <div className="mt-4">
          <SyncObrasButton />
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-slate-200 p-5">
        <h2 className="font-medium text-slate-900">
          Pagos Mensuales (Remuneraciones + Reliquidaciones)
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {lineItemsCount ?? 0} líneas ingeridas en total (todos los períodos)
        </p>
        <div className="mt-4">
          <SyncPagosMensualesForm />
        </div>
      </section>
    </div>
  );
}
