import { auth, signOut } from "@/lib/auth";
import {
  getCashFlowSeries,
  getResumenKpis,
  getUfPorPeriodo,
} from "@/features/cash-flow/services/queries";
import {
  getDotacionTotalPorPeriodo,
  getDotacionRgRpPorPeriodo,
} from "@/features/headcount/services/dotacion-total";
import { HeroConsolidado } from "@/features/cash-flow/components/hero-consolidado";
import { DetailTable } from "@/features/cash-flow/components/detail-table";
import { AlertPanel } from "@/features/cash-flow/components/alert-panel";
import { RefreshReportButton } from "@/features/cash-flow/components/refresh-report-button";
import { ExportReportButton } from "@/features/report-export/components/export-report-button";
import { MetodologiaCalculo } from "@/features/cash-flow/components/metodologia-calculo";

export const dynamic = "force-dynamic";

// Rango del dashboard: 3 meses atrás -> 12 meses adelante desde hoy.
// Pedido explícito del usuario (17-ago-2026): a Finanzas le interesa
// mucho más la proyección hacia adelante que el histórico profundo — 3
// meses de real alcanzan para dar contexto/continuidad sin enterrar la
// proyección entre demasiadas columnas de historia. Antes eran 12 meses
// atrás, mostraba casi 2 años de historia por cada mes de foco real. El
// histórico completo (2022+) sigue disponible ampliando el rango en una
// fase futura (filtros de UI).
function rangoDefault() {
  const hoy = new Date();
  const desde = new Date(hoy.getFullYear(), hoy.getMonth() - 3, 1);
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
  const dotacionPorPeriodo = await getDotacionTotalPorPeriodo(desde, hasta);
  const dotacionRgRpPorPeriodo = await getDotacionRgRpPorPeriodo(desde, hasta);

  return (
    // El hero navy va FULL-BLEED (ancho completo de la página, igual que
    // la banda navy del Carta Gantt de referencia) — a propósito FUERA del
    // contenedor centrado de abajo, que sigue acotado a max-w-6xl. Bug de
    // diseño real reportado: antes todo (incluido el hero) vivía dentro
    // de un único `mx-auto max-w-6xl`, así que en pantallas anchas el azul
    // quedaba como una caja angosta con blanco a los lados en vez de
    // ocupar todo el ancho como en la referencia.
    <div>
      <HeroConsolidado
        kpis={kpis}
        serie={serie}
        sesionEmail={session?.user?.email ?? null}
        onCerrarSesion={async () => {
          "use server";
          await signOut({ redirectTo: "/login" });
        }}
      />

      <div className="mx-auto max-w-6xl space-y-6 p-8">
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

        <AlertPanel />

        <section>
          <h2 className="mb-2 text-sm font-medium text-slate-700">
            Detalle por concepto
          </h2>
          <DetailTable
            serie={serie}
            ufPorPeriodo={ufPorPeriodo}
            dotacionPorPeriodo={dotacionPorPeriodo}
            dotacionRgRpPorPeriodo={dotacionRgRpPorPeriodo}
          />
        </section>

        <MetodologiaCalculo />
      </div>
    </div>
  );
}
