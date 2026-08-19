import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { getDotacionTotalPorPeriodo } from "@/features/headcount/services/dotacion-total";

export interface CashFlowSeriePunto {
  periodo: string;
  concepto: string;
  monto: number;
  esReal: boolean;
  /**
   * Cómo se resolvió el monto (ej. `no_corresponde_pago_anual`,
   * `pendiente_ingreso_manual`, `proyeccion_pago_anual` para SENCE) — la
   * UI lo usa para distinguir "$0 confirmado, no corresponde este mes" de
   * "falta ingresar el dato real", que antes se veían idénticos (ver
   * sence-editable-cell.tsx).
   */
  metodoCalculo: string | null;
}

export async function getCashFlowSeries(
  periodoDesde: Date,
  periodoHasta: Date,
): Promise<CashFlowSeriePunto[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("cash_flow_monthly")
    .select("periodo, concepto, monto, es_real, metodo_calculo")
    .gte("periodo", periodoDesde.toISOString().slice(0, 10))
    .lte("periodo", periodoHasta.toISOString().slice(0, 10))
    .order("periodo");

  return (data ?? []).map((d) => ({
    periodo: d.periodo,
    concepto: d.concepto,
    monto: Number(d.monto),
    esReal: d.es_real,
    metodoCalculo: d.metodo_calculo,
  }));
}

/** Crecimiento mensual asumido para proyectar la UF cuando todavía no hay dato real (mindicador.cl no publica meses futuros) — pedido explícito del usuario 18-ago-2026, reemplaza el placeholder de +1% mensual del Excel original (ver TECH-SPEC §7). */
export const UF_CRECIMIENTO_MENSUAL_PROYECTADO = 0.005;

function mesesEntrePeriodos(desde: string, hasta: string): number {
  const [anioDesde, mesDesde] = desde.split("-").map(Number);
  const [anioHasta, mesHasta] = hasta.split("-").map(Number);
  return (anioHasta - anioDesde) * 12 + (mesHasta - mesDesde);
}

/**
 * Valor de UF para el día exacto de cada período (siempre el 1° del mes,
 * mismo formato que `cash_flow_monthly.periodo`). Usado para la fila
 * "Total Nómina (UF)" de la tabla de detalle — ver `uf-sync.ts`.
 *
 * Real cuando `uf_series` ya tiene el dato (mindicador.cl); para períodos
 * futuros sin dato real todavía, proyecta desde el último UF real conocido
 * componiendo `UF_CRECIMIENTO_MENSUAL_PROYECTADO` (0,5%) mes a mes — pedido
 * explícito del usuario 18-ago-2026, en vez de dejar la celda vacía ("—").
 */
export async function getUfPorPeriodo(
  periodos: string[],
): Promise<Map<string, number>> {
  if (periodos.length === 0) return new Map();
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("uf_series")
    .select("fecha, valor_uf")
    .in("fecha", periodos);

  const resultado = new Map<string, number>(
    (data ?? []).map((d) => [d.fecha, Number(d.valor_uf)]),
  );

  const periodosFaltantes = periodos.filter((p) => !resultado.has(p));
  if (periodosFaltantes.length === 0) return resultado;

  const { data: ultimoReal } = await supabase
    .from("uf_series")
    .select("fecha, valor_uf")
    .eq("es_real", true)
    .order("fecha", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!ultimoReal) return resultado; // sin ningún UF real todavía — nada desde dónde proyectar

  const ultimaFechaReal = ultimoReal.fecha;
  const ultimoValorReal = Number(ultimoReal.valor_uf);

  for (const periodo of periodosFaltantes) {
    const meses = mesesEntrePeriodos(ultimaFechaReal, periodo);
    if (meses <= 0) continue; // no proyectar hacia atrás de la última UF real
    resultado.set(
      periodo,
      ultimoValorReal * Math.pow(1 + UF_CRECIMIENTO_MENSUAL_PROYECTADO, meses),
    );
  }

  return resultado;
}

export interface ResumenKpis {
  /** Mes CALENDARIO actual (hoy) — no el último del rango, que puede ser futuro. */
  totalMesActual: number;
  totalMesAnterior: number;
  variacionPct: number | null;
  /** La pregunta real de un flujo de caja de nómina: ¿cuánto necesito los próximos N meses? */
  totalProximosTresMeses: number;
  totalProximosDoceMeses: number;
  /** Mes de mayor requerimiento hacia adelante — para anticipar picos (aguinaldos, finiquitos masivos, etc.) */
  mesPico: { periodo: string; monto: number } | null;
  obrasConEstimacion: number;
  mesesProyectadosEnRango: number;
  /** Dotación TOTAL de la compañía del mes actual (no solo por obra) — ver dotacion-total.ts. `null` si no hay dato para ese mes todavía. */
  dotacionMesActual: number | null;
  dotacionMesActualEsReal: boolean;
}

function primerDiaMesActual(): string {
  const hoy = new Date();
  return new Date(hoy.getFullYear(), hoy.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
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
  const mesActualStr = primerDiaMesActual();
  const idxMesActual = periodosOrdenados.indexOf(mesActualStr);

  const totalMesActual = totalesPorMes.get(mesActualStr) ?? 0;
  const periodoAnterior =
    idxMesActual > 0 ? periodosOrdenados[idxMesActual - 1] : null;
  const totalMesAnterior = periodoAnterior
    ? totalesPorMes.get(periodoAnterior)!
    : 0;
  const variacionPct =
    totalMesAnterior > 0
      ? ((totalMesActual - totalMesAnterior) / totalMesAnterior) * 100
      : null;

  // "Próximos N meses" = desde el mes actual (inclusive) hacia adelante —
  // la métrica que de verdad responde "cuánta caja necesito reservar".
  const mesesFuturos =
    idxMesActual >= 0
      ? periodosOrdenados.slice(idxMesActual)
      : periodosOrdenados;
  const sumaRango = (n: number) =>
    mesesFuturos
      .slice(0, n)
      .reduce((acc, p) => acc + (totalesPorMes.get(p) ?? 0), 0);

  const totalProximosTresMeses = sumaRango(3);
  const totalProximosDoceMeses = sumaRango(12);

  let mesPico: ResumenKpis["mesPico"] = null;
  for (const p of mesesFuturos) {
    const monto = totalesPorMes.get(p) ?? 0;
    if (!mesPico || monto > mesPico.monto) mesPico = { periodo: p, monto };
  }

  const mesesProyectadosEnRango = [...esRealPorMes.values()].filter(
    (esReal) => !esReal,
  ).length;

  // BUG REAL corregido: esto contaba FILAS (una por obra POR MES — un
  // rango de 24 meses en 12 obras estimadas ya son 250+ filas), no obras
  // DISTINTAS — el KPI mostraba "254 obras con dotación estimada" cuando
  // en total la empresa tiene 33 obras. Contar `obra_id` único, no filas.
  const { data: filasEstimadas } = await supabase
    .from("headcount_by_obra")
    .select("obra_id")
    .eq("origen", "modelo_estimado");
  const obrasConEstimacion = new Set(
    (filasEstimadas ?? []).map((f) => f.obra_id),
  ).size;

  // Dotación TOTAL de la compañía (no solo la de obras estimadas) — la
  // misma fuente que alimenta la fila "Dotación (N°)" de la tabla de
  // detalle, para el mes calendario actual puntual.
  const dotacionPorPeriodo = await getDotacionTotalPorPeriodo(
    new Date(mesActualStr),
    new Date(mesActualStr),
  );
  const dotacionActual = dotacionPorPeriodo.get(mesActualStr) ?? null;

  return {
    totalMesActual,
    totalMesAnterior,
    variacionPct,
    totalProximosTresMeses,
    totalProximosDoceMeses,
    mesPico,
    obrasConEstimacion,
    mesesProyectadosEnRango,
    dotacionMesActual: dotacionActual?.total ?? null,
    dotacionMesActualEsReal: dotacionActual?.esReal ?? false,
  };
}
