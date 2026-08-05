import { auth, signOut } from "@/lib/auth";
import {
  getCashFlowSeries,
  getResumenKpis,
  getUfPorPeriodo,
} from "@/features/cash-flow/services/queries";
import { HeroConsolidado } from "@/features/cash-flow/components/hero-consolidado";
import { DetailTable } from "@/features/cash-flow/components/detail-table";
import { AlertPanel } from "@/features/cash-flow/components/alert-panel";
import { RefreshReportButton } from "@/features/cash-flow/components/refresh-report-button";
import { ExportReportButton } from "@/features/report-export/components/export-report-button";
import { MetodologiaCalculo } from "@/features/cash-flow/components/metodologia-calculo";

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
  const periodosDelDetalle = [...new Set(serie.map((p) => p.periodo))];
  const ufPorPeriodo = await getUfPorPeriodo(periodosDelDetalle);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-8">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Sesión: {session?.user?.email}</p>
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

      <HeroConsolidado kpis={kpis} serie={serie} />

      <AlertPanel />

      <section>
        <h2 className="mb-2 text-sm font-medium text-slate-700">
          Detalle por concepto
        </h2>
        <DetailTable serie={serie} ufPorPeriodo={ufPorPeriodo} />
      </section>

      <MetodologiaCalculo />
    </div>
  );
}
