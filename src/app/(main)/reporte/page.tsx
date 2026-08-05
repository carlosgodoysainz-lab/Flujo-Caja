import { auth, signOut } from "@/lib/auth";
import {
  getCashFlowSeries,
  getResumenKpis,
} from "@/features/cash-flow/services/queries";
import { KpiHero } from "@/features/cash-flow/components/kpi-hero";
import { TimelineChart } from "@/features/cash-flow/components/timeline-chart";
import { DetailTable } from "@/features/cash-flow/components/detail-table";
import { AlertPanel } from "@/features/cash-flow/components/alert-panel";
import { RefreshReportButton } from "@/features/cash-flow/components/refresh-report-button";
import { ExportReportButton } from "@/features/report-export/components/export-report-button";

export const dynamic = "force-dynamic";

// Rango del dashboard: 12 meses atrás -> 12 meses adelante desde hoy.
// El histórico completo (2022+) queda disponible ampliando el rango en
// una fase futura (filtros de UI) — para el MVP este rango cubre el caso
// de uso principal (¿cuánta caja necesito los próximos meses?).
function rangoDefault() {
  const hoy = new Date();
  const desde = new Date(hoy.getFullYear(), hoy.getMonth() - 12, 1);
  const hasta = new Date(hoy.getFullYear(), hoy.getMonth() + 12, 1);
  return { desde, hasta };
}

export default async function ReportePage() {
  const session = await auth();
  const { desde, hasta } = rangoDefault();

  const [serie, kpis] = await Promise.all([
    getCashFlowSeries(desde, hasta),
    getResumenKpis(desde, hasta),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Flujo de Caja Nómina
          </h1>
          <p className="text-sm text-slate-500">
            Sesión: {session?.user?.email}
          </p>
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button
            type="submit"
            className="text-sm text-slate-500 hover:underline"
          >
            Cerrar sesión
          </button>
        </form>
      </div>

      <div className="flex flex-wrap gap-3">
        <RefreshReportButton
          periodoDesde={desde.toISOString().slice(0, 10)}
          periodoHasta={hasta.toISOString().slice(0, 10)}
        />
        <ExportReportButton
          periodoDesde={desde.toISOString().slice(0, 10)}
          periodoHasta={hasta.toISOString().slice(0, 10)}
        />
      </div>

      <KpiHero kpis={kpis} />

      <AlertPanel />

      <section>
        <h2 className="mb-2 text-sm font-medium text-slate-700">
          Línea de tiempo — Total Nómina mensual
        </h2>
        <TimelineChart serie={serie} />
        <p className="mt-1 text-xs text-slate-400">
          <span className="inline-block h-2 w-2 rounded-sm bg-[var(--navy-brand)]" />{" "}
          Real ·{" "}
          <span className="inline-block h-2 w-2 rounded-sm border border-dashed border-[var(--gold)] bg-[var(--gold)]/20" />{" "}
          Proyectado
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-slate-700">
          Detalle por concepto
        </h2>
        <DetailTable serie={serie} />
      </section>
    </div>
  );
}
