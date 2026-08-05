import type { CashFlowSeriePunto } from "../services/queries";

function formatMesCorto(periodo: string): string {
  const [anio, mes] = periodo.split("-");
  const nombre = new Date(Number(anio), Number(mes) - 1, 1).toLocaleDateString(
    "es-CL",
    { month: "short" },
  );
  return `${nombre.replace(".", "")} ${anio.slice(2)}`;
}

/**
 * Línea de tiempo mensual con scroll horizontal — análoga al Gantt de
 * "Carta Gantt Plan de Obras" (barra por mes, color por real/proyectado,
 * línea de "hoy"). Sin librería de charts: barras CSS simples alcanzan
 * para este volumen de datos (≤ ~54 meses).
 */
export function TimelineChart({ serie }: { serie: CashFlowSeriePunto[] }) {
  const porMes = new Map<string, { monto: number; esReal: boolean }>();
  for (const punto of serie) {
    if (punto.concepto === "total_nomina") {
      porMes.set(punto.periodo, { monto: punto.monto, esReal: punto.esReal });
    }
  }

  const meses = [...porMes.entries()].sort(([a], [b]) => a.localeCompare(b));
  const maxMonto = Math.max(...meses.map(([, v]) => v.monto), 1);
  const hoyStr = new Date().toISOString().slice(0, 7);

  if (meses.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        Sin datos calculados todavía — usa "Actualizar reporte".
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div
        className="flex items-end gap-1 pb-2"
        style={{ minWidth: meses.length * 28 }}
      >
        {meses.map(([periodo, { monto, esReal }]) => {
          const alturaPct = Math.max((monto / maxMonto) * 100, 2);
          const esHoy = periodo.slice(0, 7) === hoyStr;
          return (
            <div
              key={periodo}
              className="flex w-6 flex-col items-center gap-1"
              title={`${periodo}: ${monto.toLocaleString("es-CL")}`}
            >
              <div className="flex h-24 w-full items-end">
                <div
                  className={`w-full rounded-t ${esReal ? "bg-[var(--navy-brand)]" : "border border-dashed border-[var(--gold)] bg-[var(--gold)]/20"}`}
                  style={{ height: `${alturaPct}%` }}
                />
              </div>
              <span
                className={`text-[10px] ${esHoy ? "font-bold text-[var(--fucsia)]" : "text-slate-400"}`}
              >
                {formatMesCorto(periodo)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
