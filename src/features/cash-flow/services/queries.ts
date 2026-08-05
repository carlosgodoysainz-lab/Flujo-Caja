import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

export interface CashFlowSeriePunto {
  periodo: string;
  concepto: string;
  monto: number;
  esReal: boolean;
}

export async function getCashFlowSeries(
  periodoDesde: Date,
  periodoHasta: Date,
): Promise<CashFlowSeriePunto[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("cash_flow_monthly")
    .select("periodo, concepto, monto, es_real")
    .gte("periodo", periodoDesde.toISOString().slice(0, 10))
    .lte("periodo", periodoHasta.toISOString().slice(0, 10))
    .order("periodo");

  return (data ?? []).map((d) => ({
    periodo: d.periodo,
    concepto: d.concepto,
    monto: Number(d.monto),
    esReal: d.es_real,
  }));
}

export interface ResumenKpis {
  totalMesActual: number;
  totalMesAnterior: number;
  variacionPct: number | null;
  obrasConEstimacion: number;
  mesesProyectadosEnRango: number;
}

export async function getResumenKpis(
  periodoDesde: Date,
  periodoHasta: Date,
): Promise<ResumenKpis> {
  const supabase = createServiceClient();
  const serie = await getCashFlowSeries(periodoDesde, periodoHasta);

  const totalesPorMes = new Map<string, number>();
  const esRealPorMes = new Map<string, boolean>();
  for (const punto of serie) {
    if (punto.concepto === "total_nomina") {
      totalesPorMes.set(punto.periodo, punto.monto);
      esRealPorMes.set(punto.periodo, punto.esReal);
    }
  }

  const periodosOrdenados = [...totalesPorMes.keys()].sort();
  const ultimoPeriodo = periodosOrdenados[periodosOrdenados.length - 1];
  const penultimoPeriodo = periodosOrdenados[periodosOrdenados.length - 2];

  const totalMesActual = ultimoPeriodo ? totalesPorMes.get(ultimoPeriodo)! : 0;
  const totalMesAnterior = penultimoPeriodo
    ? totalesPorMes.get(penultimoPeriodo)!
    : 0;
  const variacionPct =
    totalMesAnterior > 0
      ? ((totalMesActual - totalMesAnterior) / totalMesAnterior) * 100
      : null;

  const mesesProyectadosEnRango = [...esRealPorMes.values()].filter(
    (esReal) => !esReal,
  ).length;

  const { count: obrasConEstimacion } = await supabase
    .from("headcount_by_obra")
    .select("obra_id", { count: "exact", head: true })
    .eq("origen", "modelo_estimado");

  return {
    totalMesActual,
    totalMesAnterior,
    variacionPct,
    obrasConEstimacion: obrasConEstimacion ?? 0,
    mesesProyectadosEnRango,
  };
}
