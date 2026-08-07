"use server";

import { auth } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { syncObrasFromGespro } from "@/features/obras/services/sync";
import { syncPagosMensuales } from "./sync-pagos-mensuales";
import { syncUfSeries } from "./uf-sync";
import { syncFlujoCajaHistorico } from "./sync-flujo-caja-historico";
import { calcularMesCashFlow, type CashFlowConceptoCalculado } from "./engine";
import { ANTICIPO_PCT } from "./formulas";
import { getDotacionTotalPorPeriodo } from "@/features/headcount/services/dotacion-total";
import { runForecastModel } from "@/features/headcount/forecast-model/run";

/**
 * Métodos de cálculo que NUNCA se pisan en un refresh — ya sea porque un
 * humano lo cargó a mano (`manual_override`, ver override.ts) o porque
 * viene del Excel maestro de Flujo de Caja, el registro autoritativo que
 * Finanzas cierra mes a mes (`ingesta_excel_historico`, ver
 * sync-flujo-caja-historico.ts).
 */
const METODOS_PRESERVADOS = ["manual_override", "ingesta_excel_historico"];

/**
 * Aporte SENCE es un pago ANUAL — pedido explícito del usuario: "todos
 * los años en junio, pero solo por este año [2026] se realizará en
 * agosto, y son $20.000.000". Se usa SOLO como respaldo cuando no hay
 * `senceManual` cargado — nunca reemplaza el monto real cuando se sepa
 * exacto (ver engine.ts).
 */
const SENCE_MONTO_ANUAL = 20_000_000;
function senceMesEsperado(anio: number): number {
  return anio === 2026 ? 7 : 5; // 2026: agosto (excepción); resto: junio
}
function senceFallbackProyectado(mes: Date): number {
  return mes.getMonth() === senceMesEsperado(mes.getFullYear())
    ? SENCE_MONTO_ANUAL
    : 0;
}

export interface RefreshReportResult {
  reportSnapshotId: string | null;
  estado: "ok" | "parcial" | "error";
  documentosIngeridos: number;
  mesesRecalculados: number;
  obrasEstimadas: number;
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

/**
 * Razón real Remuneración RG / Remuneración total, promediada de los
 * últimos N meses reales — para "aperturar" el desglose RG/RP también en
 * los meses PROYECTADOS (pedido explícito del usuario, "como en el
 * Excel"), ya que el modelo costo-por-cabeza solo proyecta el total
 * combinado. `null` si no hay ningún mes real con el desglose todavía.
 */
async function proporcionRgHistorica(
  supabase: ReturnType<typeof createServiceClient>,
  antesDe: Date,
  n = 3,
): Promise<number | null> {
  const { data } = await supabase
    .from("cash_flow_monthly")
    .select("periodo, monto")
    .eq("concepto", "remuneracion_rg")
    .eq("es_real", true)
    .lt("periodo", antesDe.toISOString().slice(0, 10))
    .order("periodo", { ascending: false })
    .limit(n);

  if (!data || data.length === 0) return null;

  let sumaRg = 0;
  let sumaTotal = 0;
  for (const fila of data) {
    const total = await montoCashFlow(
      supabase,
      new Date(fila.periodo),
      "remuneracion",
    );
    if (!total) continue;
    sumaRg += Number(fila.monto);
    sumaTotal += total;
  }
  return sumaTotal > 0 ? sumaRg / sumaTotal : null;
}

/**
 * Corre el modelo de estimación de dotación (curva por obra similar, ver
 * forecast-model/run.ts) para toda obra que TODAVÍA no tenga ningún dato
 * de dotación (manual/real/estimado). Antes esto era un botón manual por
 * obra en /dotacion — con 33 obras nunca se corría, y el KPI "Obras con
 * dotación estimada" quedaba en 0 siempre (bug real: confirmado
 * `headcount_by_obra` con 0 filas pese a tener 524 snapshots reales de Buk
 * disponibles para comparar). Best-effort: una obra sin obras similares
 * con histórico real todavía (normal si es reciente) no cuenta como error
 * del refresh — se ve reflejado como "Sin dato" en /dotacion.
 */
async function estimarDotacionFaltante(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<{ obrasEstimadas: number; obrasSinDatoAun: number }> {
  const { data: obras } = await supabase
    .from("obras")
    .select("id")
    .not("inicio_obra", "is", null)
    .not("dur_obra_meses", "is", null);

  const { data: yaConDato } = await supabase
    .from("headcount_by_obra")
    .select("obra_id");
  const idsConDato = new Set((yaConDato ?? []).map((r) => r.obra_id));

  const faltantes = (obras ?? []).filter((o) => !idsConDato.has(o.id));
  let obrasEstimadas = 0;
  let obrasSinDatoAun = 0;
  for (const obra of faltantes) {
    const resultado = await runForecastModel(obra.id);
    if (resultado.estado === "ok") obrasEstimadas++;
    else obrasSinDatoAun++;
  }
  return { obrasEstimadas, obrasSinDatoAun };
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

  // El Excel maestro de Flujo de Caja (Finanzas, cerrado mes a mes) ANTES
  // del recálculo mes a mes — establece la base "real" autoritativa para
  // todo el histórico que cubre (corrige meses de 2025 que la ingesta
  // suelta de Pagos Mensuales traía incompletos, reportado por el
  // usuario). Sus valores quedan con metodo_calculo='ingesta_excel_historico',
  // preservados igual que un override manual (ver METODOS_PRESERVADOS).
  const flujoCajaHistoricoResult = await syncFlujoCajaHistorico();
  if (flujoCajaHistoricoResult.estado === "error") {
    errores.push({
      fuente: "Excel histórico Flujo de Caja",
      mensaje: flujoCajaHistoricoResult.errores.join("; "),
    });
  } else {
    documentosIngeridos += 1;
  }

  const { obrasEstimadas } = await estimarDotacionFaltante(supabase);

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

  // Un mes FUTURO (después del mes calendario actual) todavía no tiene
  // archivo de pago real — no existe, no es un error. Antes se buscaba
  // igual y cada mes futuro del rango (hasta 12 meses adelante) aparecía
  // como "error" en la UI, alarmando sin motivo — el motor ya proyecta
  // esos meses por fórmula (ver engine.ts). Se saltan directamente, sin
  // gastar una búsqueda de Graph que sabemos que no puede encontrar nada.
  const hoy = new Date();
  const mesActual = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  for (const mes of meses) {
    if (mes > mesActual) continue;
    const pagosResult = await syncPagosMensuales(mes);
    documentosIngeridos += pagosResult.archivosProcesados.length;
    // El mes CALENDARIO ACTUAL (ej. agosto recién empezando) es normal que
    // todavía no tenga ningún archivo real — Pagos Mensuales se sube a
    // mediados de mes. Antes esto se reportaba como "error" en rojo cada
    // vez, alarmando sin motivo: el motor YA calcula la proyección por
    // fórmula para ese mes de todas formas (ver engine.ts), no es un dato
    // faltante que rompa nada. Solo se marca error si es un problema
    // real (ej. Graph, permisos) o si es un mes YA PASADO que debería
    // tener archivo y no lo tiene.
    const esMesActualSinArchivosAun =
      mes.getTime() === mesActual.getTime() &&
      pagosResult.archivosProcesados.length === 0;
    if (pagosResult.estado === "error" && !esMesActualSinArchivosAun) {
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
      senceFallbackProyectado: senceFallbackProyectado(mes),
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

    // Ningún método preservado (`manual_override` o
    // `ingesta_excel_historico` — ver METODOS_PRESERVADOS) se pisa en el
    // refresh: se preserva el valor cargado a mano o desde el Excel
    // maestro, y el total se recalcula sobre esos valores finales.
    for (const concepto of CONCEPTOS_CALCULADOS) {
      const existente = await filaExistente(supabase, mes, concepto);
      if (
        existente?.metodoCalculo &&
        METODOS_PRESERVADOS.includes(existente.metodoCalculo)
      ) {
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

    // Desglose Remuneración/Anticipo en RG/RP — filas SOLO informativas
    // (nunca se suman aparte al Total Nómina, ya están dentro de
    // calculadoPorConcepto.remuneracion/anticipo). Real cuando hay dato
    // real ingerido (SharePoint o Excel histórico, vía el preserve-check
    // de abajo); si no, split proporcional usando la razón real de los
    // últimos meses — pedido explícito del usuario, "como en el Excel".
    const remuneracionRgReal = await sumaLineItems(supabase, mes, [
      "remuneracion_rg",
    ]);
    const remuneracionRpReal = await sumaLineItems(supabase, mes, [
      "remuneracion_rp",
    ]);
    const anticipoRgReal = await sumaLineItems(supabase, mes, ["anticipo_rg"]);
    const anticipoRpReal = await sumaLineItems(supabase, mes, ["anticipo_rp"]);

    let remuneracionRgFila: CashFlowConceptoCalculado | null = null;
    let remuneracionRpFila: CashFlowConceptoCalculado | null = null;
    if (calculadoPorConcepto.remuneracion.esReal) {
      remuneracionRgFila = {
        monto: remuneracionRgReal ?? 0,
        esReal: true,
        metodoCalculo: "ingesta_real",
      };
      remuneracionRpFila = {
        monto: remuneracionRpReal ?? 0,
        esReal: true,
        metodoCalculo: "ingesta_real",
      };
    } else {
      const proporcionRg = await proporcionRgHistorica(supabase, mes);
      if (proporcionRg != null) {
        const rg = Math.round(
          calculadoPorConcepto.remuneracion.monto * proporcionRg,
        );
        remuneracionRgFila = {
          monto: rg,
          esReal: false,
          metodoCalculo: "split_proporcional_historico",
        };
        remuneracionRpFila = {
          monto: calculadoPorConcepto.remuneracion.monto - rg,
          esReal: false,
          metodoCalculo: "split_proporcional_historico",
        };
      }
    }

    let anticipoRgFila: CashFlowConceptoCalculado | null = null;
    let anticipoRpFila: CashFlowConceptoCalculado | null = null;
    if (calculadoPorConcepto.anticipo.esReal) {
      anticipoRgFila = {
        monto: anticipoRgReal ?? 0,
        esReal: true,
        metodoCalculo: "ingesta_real",
      };
      anticipoRpFila = {
        monto: anticipoRpReal ?? 0,
        esReal: true,
        metodoCalculo: "ingesta_real",
      };
    } else if (remuneracionRgFila) {
      // Misma fórmula que calcularAnticipoProyectado, pero aplicada solo
      // a la porción RG de Remuneración — el residual va a RP para que
      // RG+RP siga sumando exacto el Anticipo total ya calculado.
      const rg = Math.round(remuneracionRgFila.monto * ANTICIPO_PCT);
      anticipoRgFila = {
        monto: rg,
        esReal: false,
        metodoCalculo: "formula_24pct_remuneracion_rg",
      };
      anticipoRpFila = {
        monto: calculadoPorConcepto.anticipo.monto - rg,
        esReal: false,
        metodoCalculo: "residual_anticipo_total_menos_rg",
      };
    }

    // Preservar RG/RP también si ya vienen de un método protegido (Excel
    // histórico / override) — igual que los conceptos principales arriba.
    const existenteRemuneracionRg = await filaExistente(
      supabase,
      mes,
      "remuneracion_rg",
    );
    if (
      existenteRemuneracionRg?.metodoCalculo &&
      METODOS_PRESERVADOS.includes(existenteRemuneracionRg.metodoCalculo)
    ) {
      remuneracionRgFila = {
        monto: existenteRemuneracionRg.monto,
        esReal: existenteRemuneracionRg.esReal,
        metodoCalculo: existenteRemuneracionRg.metodoCalculo,
      };
    }
    const existenteRemuneracionRp = await filaExistente(
      supabase,
      mes,
      "remuneracion_rp",
    );
    if (
      existenteRemuneracionRp?.metodoCalculo &&
      METODOS_PRESERVADOS.includes(existenteRemuneracionRp.metodoCalculo)
    ) {
      remuneracionRpFila = {
        monto: existenteRemuneracionRp.monto,
        esReal: existenteRemuneracionRp.esReal,
        metodoCalculo: existenteRemuneracionRp.metodoCalculo,
      };
    }
    const existenteAnticipoRg = await filaExistente(
      supabase,
      mes,
      "anticipo_rg",
    );
    if (
      existenteAnticipoRg?.metodoCalculo &&
      METODOS_PRESERVADOS.includes(existenteAnticipoRg.metodoCalculo)
    ) {
      anticipoRgFila = {
        monto: existenteAnticipoRg.monto,
        esReal: existenteAnticipoRg.esReal,
        metodoCalculo: existenteAnticipoRg.metodoCalculo,
      };
    }
    const existenteAnticipoRp = await filaExistente(
      supabase,
      mes,
      "anticipo_rp",
    );
    if (
      existenteAnticipoRp?.metodoCalculo &&
      METODOS_PRESERVADOS.includes(existenteAnticipoRp.metodoCalculo)
    ) {
      anticipoRpFila = {
        monto: existenteAnticipoRp.monto,
        esReal: existenteAnticipoRp.esReal,
        metodoCalculo: existenteAnticipoRp.metodoCalculo,
      };
    }

    const conceptos = [
      { concepto: "anticipo", ...calculadoPorConcepto.anticipo },
      { concepto: "remuneracion", ...calculadoPorConcepto.remuneracion },
      { concepto: "reliquidacion", ...calculadoPorConcepto.reliquidacion },
      { concepto: "finiquito", ...calculadoPorConcepto.finiquito },
      { concepto: "cotizacion", ...calculadoPorConcepto.cotizacion },
      { concepto: "sence", ...calculadoPorConcepto.sence },
      ...(remuneracionRgFila
        ? [{ concepto: "remuneracion_rg", ...remuneracionRgFila }]
        : []),
      ...(remuneracionRpFila
        ? [{ concepto: "remuneracion_rp", ...remuneracionRpFila }]
        : []),
      ...(anticipoRgFila
        ? [{ concepto: "anticipo_rg", ...anticipoRgFila }]
        : []),
      ...(anticipoRpFila
        ? [{ concepto: "anticipo_rp", ...anticipoRpFila }]
        : []),
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
    obrasEstimadas,
    errores,
  };
}
