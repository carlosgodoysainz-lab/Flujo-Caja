"use server";

import { auth } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { syncObrasFromGespro } from "@/features/obras/services/sync";
import { syncPagosMensuales } from "./sync-pagos-mensuales";
import { syncUfSeries } from "./uf-sync";
import { calcularMesCashFlow, type CashFlowConceptoCalculado } from "./engine";
import { getDotacionTotalPorPeriodo } from "@/features/headcount/services/dotacion-total";

export interface RefreshReportResult {
  reportSnapshotId: string | null;
  estado: "ok" | "parcial" | "error";
  documentosIngeridos: number;
  mesesRecalculados: number;
  errores: { fuente: string; mensaje: string }[];
}

const CONCEPTOS_CALCULADOS = [
  "anticipo",
  "remuneracion",
  "reliquidacion",
  "finiquito",
  "cotizacion",
  "sence",
] as const;

function mesAnteriorA(mes: Date): Date {
  return new Date(mes.getFullYear(), mes.getMonth() - 1, 1);
}

async function sumaLineItems(
  supabase: ReturnType<typeof createServiceClient>,
  periodo: Date,
  conceptos: string[],
): Promise<number | null> {
  const { data } = await supabase
    .from("payroll_line_items")
    .select("monto")
    .eq("periodo", periodo.toISOString().slice(0, 10))
    .in("concepto", conceptos);

  if (!data || data.length === 0) return null;
  return data.reduce((acc, row) => acc + Number(row.monto), 0);
}

/** Monto ya guardado en `cash_flow_monthly` para un concepto/mes — usado para leer la Remuneración del mes anterior (real o ya proyectada) y así encadenar el modelo costo-por-cabeza mes a mes. */
async function montoCashFlow(
  supabase: ReturnType<typeof createServiceClient>,
  periodo: Date,
  concepto: string,
): Promise<number | null> {
  const { data } = await supabase
    .from("cash_flow_monthly")
    .select("monto")
    .eq("periodo", periodo.toISOString().slice(0, 10))
    .eq("concepto", concepto)
    .maybeSingle();
  return data ? Number(data.monto) : null;
}

/** Fila existente de `cash_flow_monthly` para un concepto/mes — para no pisar un override manual (ver `override.ts`) en el próximo refresh. */
async function filaExistente(
  supabase: ReturnType<typeof createServiceClient>,
  periodo: Date,
  concepto: string,
): Promise<{
  monto: number;
  esReal: boolean;
  metodoCalculo: string | null;
} | null> {
  const { data } = await supabase
    .from("cash_flow_monthly")
    .select("monto, es_real, metodo_calculo")
    .eq("periodo", periodo.toISOString().slice(0, 10))
    .eq("concepto", concepto)
    .maybeSingle();
  if (!data) return null;
  return {
    monto: Number(data.monto),
    esReal: data.es_real,
    metodoCalculo: data.metodo_calculo,
  };
}

async function promedioRemuneracionReal(
  supabase: ReturnType<typeof createServiceClient>,
  antesDe: Date,
  n = 3,
): Promise<number> {
  const { data } = await supabase
    .from("cash_flow_monthly")
    .select("monto")
    .eq("concepto", "remuneracion")
    .eq("es_real", true)
    .lt("periodo", antesDe.toISOString().slice(0, 10))
    .order("periodo", { ascending: false })
    .limit(n);

  if (!data || data.length === 0) return 0;
  return data.reduce((acc, row) => acc + Number(row.monto), 0) / data.length;
}

/** Promedio de los últimos 6 meses con Finiquito REAL ingerido — metodología pedida explícitamente por el usuario (reemplaza la fórmula del Excel real, que era 7%×Remuneración). 0 si no hay 6 meses reales todavía. */
async function promedioFiniquitoReal6m(
  supabase: ReturnType<typeof createServiceClient>,
  antesDe: Date,
): Promise<number> {
  const { data } = await supabase
    .from("cash_flow_monthly")
    .select("monto")
    .eq("concepto", "finiquito")
    .eq("es_real", true)
    .lt("periodo", antesDe.toISOString().slice(0, 10))
    .order("periodo", { ascending: false })
    .limit(6);

  if (!data || data.length === 0) return 0;
  return data.reduce((acc, row) => acc + Number(row.monto), 0) / data.length;
}

/**
 * El refresh completo del reporte — botón "Actualizar reporte" en /reporte
 * (ver TECH-SPEC §3.4). Orquesta: sync de obras (Fase 3) + sync de pagos
 * mensuales (Fase 4, incluye Anticipo desde Fase 10) + recálculo del motor
 * de flujo de caja (engine.ts) para cada mes del rango pedido — respetando
 * SIEMPRE cualquier override manual ya guardado (ver `override.ts`), nunca
 * lo pisa con un valor de fórmula.
 */
export async function refreshCashFlowReport(
  periodoDesde: Date,
  periodoHasta: Date,
): Promise<RefreshReportResult> {
  const session = await auth();
  const supabase = createServiceClient();
  const errores: RefreshReportResult["errores"] = [];
  let documentosIngeridos = 0;

  const obrasResult = await syncObrasFromGespro();
  if (obrasResult.estado === "error") {
    errores.push({
      fuente: "Plan de Obras Gespro",
      mensaje: obrasResult.errores.join("; "),
    });
  } else {
    documentosIngeridos += 1;
  }

  const ufResult = await syncUfSeries(periodoDesde, periodoHasta);
  if (ufResult.estado === "error") {
    errores.push({
      fuente: "Serie UF (mindicador.cl)",
      mensaje: ufResult.errores.join("; "),
    });
  }

  const meses: Date[] = [];
  const cursor = new Date(
    periodoDesde.getFullYear(),
    periodoDesde.getMonth(),
    1,
  );
  while (cursor <= periodoHasta) {
    meses.push(new Date(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }

  for (const mes of meses) {
    const pagosResult = await syncPagosMensuales(mes);
    documentosIngeridos += pagosResult.archivosProcesados.length;
    if (pagosResult.estado === "error") {
      errores.push({
        fuente: `Pagos Mensuales ${pagosResult.periodo}`,
        mensaje: pagosResult.errores.join("; "),
      });
    }
  }

  // Dotación total (variable "Q" del modelo de Remuneración) para todo el
  // rango de una sola pasada — incluye 1 mes antes de periodoDesde porque
  // el primer mes del rango necesita la dotación de SU mes anterior.
  const dotacionPorPeriodo = await getDotacionTotalPorPeriodo(
    mesAnteriorA(periodoDesde),
    periodoHasta,
  );

  let mesesRecalculados = 0;
  for (const mes of meses) {
    const periodoStr = mes.toISOString().slice(0, 10);
    const anterior = mesAnteriorA(mes);

    const anticipoReal = await sumaLineItems(supabase, mes, [
      "anticipo_rg",
      "anticipo_rp",
    ]);
    const remuneracionReal = await sumaLineItems(supabase, mes, [
      "remuneracion_rg",
      "remuneracion_rp",
    ]);
    const reliquidacionReal = await sumaLineItems(supabase, mes, [
      "reliquidacion",
    ]);
    const finiquitoReal = await sumaLineItems(supabase, mes, ["finiquito"]);

    const remuneracionMesAnterior = await montoCashFlow(
      supabase,
      anterior,
      "remuneracion",
    );
    const dotacionMesAnterior =
      dotacionPorPeriodo.get(anterior.toISOString().slice(0, 10))?.total ??
      null;
    const dotacionActual = dotacionPorPeriodo.get(periodoStr)?.total ?? null;
    const costoPromedioPorCabezaMesAnterior =
      remuneracionMesAnterior != null && dotacionMesAnterior
        ? remuneracionMesAnterior / dotacionMesAnterior
        : null;

    const remuneracionFallbackPromedioHistorico =
      await promedioRemuneracionReal(supabase, mes);
    const finiquitoFallbackPromedio6m = await promedioFiniquitoReal6m(
      supabase,
      mes,
    );

    // Aporte SENCE: SIEMPRE manual — si ya hay un valor cargado a mano
    // para este mes (override o carga anterior con dato real), se
    // preserva; nunca se calcula por fórmula.
    const senceFilaExistente = await filaExistente(supabase, mes, "sence");
    const senceManual = senceFilaExistente?.esReal
      ? senceFilaExistente.monto
      : null;

    const calculado = calcularMesCashFlow({
      remuneracionReal,
      reliquidacionReal,
      finiquitoReal,
      anticipoReal,
      senceManual,
      costoPromedioPorCabezaMesAnterior,
      dotacionActual,
      remuneracionFallbackPromedioHistorico,
      finiquitoFallbackPromedio6m,
    });

    const calculadoPorConcepto: Record<string, CashFlowConceptoCalculado> = {
      anticipo: calculado.anticipo,
      remuneracion: calculado.remuneracion,
      reliquidacion: calculado.reliquidacion,
      finiquito: calculado.finiquito,
      cotizacion: calculado.cotizacion,
      sence: calculado.sence,
    };

    // Ningún override manual (`metodo_calculo === 'manual_override'`, ver
    // override.ts) se pisa en el refresh — se preserva el valor cargado a
    // mano y el total se recalcula sobre esos valores finales.
    for (const concepto of CONCEPTOS_CALCULADOS) {
      const existente = await filaExistente(supabase, mes, concepto);
      if (existente?.metodoCalculo === "manual_override") {
        calculadoPorConcepto[concepto] = {
          monto: existente.monto,
          esReal: existente.esReal,
          metodoCalculo: existente.metodoCalculo,
        };
      }
    }

    const totalNomina = CONCEPTOS_CALCULADOS.reduce(
      (acc, c) => acc + calculadoPorConcepto[c].monto,
      0,
    );

    const conceptos = [
      { concepto: "anticipo", ...calculadoPorConcepto.anticipo },
      { concepto: "remuneracion", ...calculadoPorConcepto.remuneracion },
      { concepto: "reliquidacion", ...calculadoPorConcepto.reliquidacion },
      { concepto: "finiquito", ...calculadoPorConcepto.finiquito },
      { concepto: "cotizacion", ...calculadoPorConcepto.cotizacion },
      { concepto: "sence", ...calculadoPorConcepto.sence },
      {
        // "Real" a nivel de mes = el mes ya ocurrió (hay remuneración real
        // ingerida), aunque cotización siga siendo fórmula (nunca tiene
        // fuente real — ver TECH-SPEC §2.3). Antes esto quedaba SIEMPRE en
        // false, lo que rompía el KPI de "meses proyectados", el corte
        // real/proyectado del gráfico de área, y el estilo de la tabla.
        concepto: "total_nomina",
        monto: totalNomina,
        esReal: calculadoPorConcepto.remuneracion.esReal,
        metodoCalculo: "suma_conceptos",
      },
    ];

    const { error } = await supabase.from("cash_flow_monthly").upsert(
      conceptos.map((c) => ({
        periodo: periodoStr,
        concepto: c.concepto,
        monto: c.monto,
        es_real: c.esReal,
        metodo_calculo: c.metodoCalculo,
      })),
      { onConflict: "periodo,concepto" },
    );

    if (error) {
      errores.push({ fuente: `Cálculo ${periodoStr}`, mensaje: error.message });
    } else {
      mesesRecalculados++;
    }
  }

  const { data: snapshot, error: snapshotError } = await supabase
    .from("report_snapshots")
    .insert({
      generated_by: session?.user?.id ?? null,
      periodo_desde: periodoDesde.toISOString().slice(0, 10),
      periodo_hasta: periodoHasta.toISOString().slice(0, 10),
      estado: errores.length > 0 ? "parcial" : "ok",
      detalle_errores: errores.length > 0 ? errores : null,
    })
    .select("id")
    .single();

  if (snapshotError)
    errores.push({
      fuente: "report_snapshots",
      mensaje: snapshotError.message,
    });

  return {
    reportSnapshotId: snapshot?.id ?? null,
    estado:
      errores.length === 0 ? "ok" : mesesRecalculados > 0 ? "parcial" : "error",
    documentosIngeridos,
    mesesRecalculados,
    errores,
  };
}
