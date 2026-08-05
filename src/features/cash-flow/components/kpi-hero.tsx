import type { ResumenKpis } from "../services/queries";

function formatCLP(monto: number): string {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(monto);
}

export function KpiHero({ kpis }: { kpis: ResumenKpis }) {
  const variacionLabel =
    kpis.variacionPct === null
      ? "—"
      : `${kpis.variacionPct >= 0 ? "▲" : "▼"} ${Math.abs(kpis.variacionPct).toFixed(1)}%`;
  const variacionColor =
    kpis.variacionPct === null
      ? "text-slate-400"
      : kpis.variacionPct >= 0
        ? "text-[var(--err)]"
        : "text-[var(--ok)]";

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <div className="rounded-lg border border-slate-200 p-4">
        <p className="text-xs text-slate-500">Total nómina (mes actual)</p>
        <p className="mt-1 text-xl font-semibold text-slate-900">
          {formatCLP(kpis.totalMesActual)}
        </p>
      </div>
      <div className="rounded-lg border border-slate-200 p-4">
        <p className="text-xs text-slate-500">Variación vs. mes anterior</p>
        <p className={`mt-1 text-xl font-semibold ${variacionColor}`}>
          {variacionLabel}
        </p>
      </div>
      <div className="rounded-lg border border-slate-200 p-4">
        <p className="text-xs text-slate-500">Obras con dotación estimada</p>
        <p className="mt-1 text-xl font-semibold text-[var(--warn)]">
          {kpis.obrasConEstimacion}
        </p>
      </div>
      <div className="rounded-lg border border-slate-200 p-4">
        <p className="text-xs text-slate-500">Meses proyectados en el rango</p>
        <p className="mt-1 text-xl font-semibold text-slate-900">
          {kpis.mesesProyectadosEnRango}
        </p>
      </div>
    </div>
  );
}
