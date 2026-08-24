"use server";

import { auth } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { syncObrasFromGespro } from "@/features/obras/services/sync";
import { syncPagosMensuales } from "./sync-pagos-mensuales";
import { syncCotizacionPrevired } from "./sync-cotizacion-previred";
import { syncBeneficiariosAnticipo } from "./sync-beneficiarios-anticipo";
import { syncUfSeries } from "./uf-sync";
import { getUfPorPeriodo } from "./queries";
import { syncFlujoCajaHistorico } from "./sync-flujo-caja-historico";
import { calcularMesCashFlow, type CashFlowConceptoCalculado } from "./engine";
import {
  getDotacionTotalPorPeriodo,
  dotacionRgRpDelMes,
  proporcionRgHistorica,
} from "@/features/headcount/services/dotacion-total";
import { runForecastModel } from "@/features/headcount/forecast-model/run";
import { runBukSnapshot } from "@/features/headcount/buk-sync/sync";
import { calcularBeneficiosDelMes, eventosPromedio6Meses } from "./beneficios";

/**
 * Métodos de cálculo que NUNCA se pisan en un refresh — ya sea porque un
 * humano lo cargó a mano (`manual_override`, ver override.ts) o porque
 * viene del Excel maestro de Flujo de Caja, el registro autoritativo que
 * Finanzas cierra mes a mes (`ingesta_excel_historico`, ver
 * sync-flujo-caja-historico.ts).
 */
const METODOS_PRESERVADOS = ["manual_override", "ingesta_excel_historico"];

/**
 * Aporte SENCE es un pago ANUAL de 500 UF, siempre el 30 de junio —
 * confirmado y corregido por el usuario el 13-ago-2026 ("el SENCE se
 * carga cada 30 junio 500 UF... el resto de los meses no está
 * pendiente, es $0... por el año 2026 se retrasó y tendrá que ser en
 * agosto"). El monto está en UF, no en pesos fijos — se convierte con
 * el valor de UF real de ese mes (ver `uf-sync.ts`), nunca queda
 * hardcodeado en CLP (así no se desactualiza con el tiempo, a
 * diferencia del $20.000.000 fijo que usaba la versión anterior). Se
 * usa SOLO como respaldo cuando no hay `senceManual` cargado — nunca
 * reemplaza el monto real cuando se sepa exacto (ver engine.ts).
 */
const SENCE_MONTO_UF = 500;
function senceMesEsperado(anio: number): number {
  return anio === 2026 ? 7 : 5; // 2026: agosto (excepción, se retrasó); resto: 30 de junio
}
/**
 * Fuera del mes de pago: $0 es el valor CORRECTO y final, no "pendiente"
 * — metodo_calculo lo refleja como `no_corresponde_pago_anual`, distinto
 * de `pendiente_ingreso_manual` (que sí implica que falta un dato).
 */
async function senceFallbackProyectado(
  supabase: ReturnType<typeof createServiceClient>,
  mes: Date,
): Promise<{ monto: number; metodoCalculo: string }> {
  if (mes.getMonth() !== senceMesEsperado(mes.getFullYear())) {
    return { monto: 0, metodoCalculo: "no_corresponde_pago_anual" };
  }
  const periodoStr = mes.toISOString().slice(0, 10);
  const ufPorPeriodo = await getUfPorPeriodo([periodoStr]);
  const valorUf = ufPorPeriodo.get(periodoStr);
  if (!valorUf) {
    // Mes de pago esperado, pero sin UF sincronizada todavía — acá sí
    // queda genuinamente pendiente (no se inventa el monto sin la UF real).
    return { monto: 0, metodoCalculo: "pendiente_ingreso_manual" };
  }
  return {
    monto: Math.round(SENCE_MONTO_UF * valorUf),
    metodoCalculo: "proyeccion_pago_anual",
  };
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
 * Promedio de los últimos N meses REALES de Anticipo RP — mismo patrón que
 * `promedioRemuneracionReal`/`promedioFiniquitoReal6m`. Bug real corregido
 * 20-ago-2026: el split de Anticipo RG/RP proyectado calculaba RP como
 * RESIDUAL (Total − RG), y como RG = 24% × Remuneración_RG, ese residual
 * equivale matemáticamente a 24% × Remuneración_RP también — pero la gente
 * que realmente pide Anticipo en RP (Anexo Oficina Central) es un grupo
 * chico y ESTABLE (~4 personas), no escala con toda la planilla RP.
 * Confirmado contra el Excel real de Finanzas: su Anticipo RP se mantiene
 * PLANO (~5,5M) en todos los meses proyectados, mientras el residual de
 * este código saltaba a 66M+ (usuario: "los anticipos del RP aumentan sin
 * lógica en la proyección... deberían mantener la constante"). Ahora RP
 * es el ANCLA (promedio histórico real) y RG absorbe el residual — al
 * revés de antes.
 */
async function promedioAnticipoRpReal(
  supabase: ReturnType<typeof createServiceClient>,
  antesDe: Date,
  n = 3,
): Promise<number> {
  const { data } = await supabase
    .from("cash_flow_monthly")
    .select("monto")
    .eq("concepto", "anticipo_rp")
    .eq("es_real", true)
    .lt("periodo", antesDe.toISOString().slice(0, 10))
    .order("periodo", { ascending: false })
    .limit(n);

  if (!data || data.length === 0) return 0;
  return data.reduce((acc, row) => acc + Number(row.monto), 0) / data.length;
}

/**
 * Promedio de los últimos N meses REALES de Remuneración RP ($) — mismo
 * patrón que `promedioAnticipoRpReal`, aplicado al split $ de
 * Remuneración. Bug real corregido 24-ago-2026: el split RG/RP de
 * Remuneración calculaba RP como RESIDUAL (Total − RG) usando
 * `proporcionRgHistorica` — y como esa razón se mantiene casi constante
 * pero el TOTAL de Remuneración sube/baja con el ciclo de obras, RP (una
 * población chica y estable, Anexo/Oficina Central) absorbía el 100% de
 * ese movimiento (usuario: "el RP los sigues mostrando con un alza
 * significativa de un mes para otro... mantenla constante"). Ahora RP es
 * el ANCLA (promedio histórico real) y RG absorbe el residual — mismo
 * criterio ya aplicado a Anticipo RP el 20-ago-2026 y a la dotación N° de
 * RP el 24-ago-2026 (ver `promedioDotacionRpReal` en dotacion-total.ts).
 * `null` si no hay ningún mes real todavía (cae al split proporcional
 * histórico, comportamiento anterior a este fix).
 */
async function promedioRemuneracionRpReal(
  supabase: ReturnType<typeof createServiceClient>,
  antesDe: Date,
  n = 3,
): Promise<number | null> {
  const { data } = await supabase
    .from("cash_flow_monthly")
    .select("monto")
    .eq("concepto", "remuneracion_rp")
    .eq("es_real", true)
    .lt("periodo", antesDe.toISOString().slice(0, 10))
    .order("periodo", { ascending: false })
    .limit(n);

  if (!data || data.length === 0) return null;
  return data.reduce((acc, row) => acc + Number(row.monto), 0) / data.length;
}

/** Valor real ya cargado en `beneficios_line_items` para el mes — key `tipoEvento::poblacion`, ver beneficios.ts. */
async function realBeneficiosDelMes(
  supabase: ReturnType<typeof createServiceClient>,
  mes: Date,
): Promise<Map<string, number>> {
  const { data } = await supabase
    .from("beneficios_line_items")
    .select("tipo_evento, poblacion, monto")
    .eq("periodo", mes.toISOString().slice(0, 10))
    .eq("es_real", true);

  const mapa = new Map<string, number>();
  for (const fila of data ?? []) {
    mapa.set(`${fila.tipo_evento}::${fila.poblacion}`, Number(fila.monto));
  }
  return mapa;
}

/** Promedio de los últimos 6 meses REALES de un tipo de evento/población — mismo patrón que `promedioFiniquitoReal6m`, generalizado para los eventos sin fecha fija del catálogo de beneficios (ver beneficios.ts). */
async function promedioBeneficioReal6m(
  supabase: ReturnType<typeof createServiceClient>,
  tipoEvento: string,
  poblacion: string,
  antesDe: Date,
): Promise<number> {
  const { data } = await supabase
    .from("beneficios_line_items")
    .select("monto")
    .eq("tipo_evento", tipoEvento)
    .eq("poblacion", poblacion)
    .eq("es_real", true)
    .lt("periodo", antesDe.toISOString().slice(0, 10))
    .order("periodo", { ascending: false })
    .limit(6);

  if (!data || data.length === 0) return 0;
  return data.reduce((acc, row) => acc + Number(row.monto), 0) / data.length;
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

/** Monto real ya guardado en `cash_flow_monthly` para un periodo/concepto, buscando directo por el string de periodo (evita reconstruir un `Date` desde un string que ya viene de la DB — riesgo de desfase de zona horaria). */
async function montoCashFlowPorPeriodoStr(
  supabase: ReturnType<typeof createServiceClient>,
  periodoStr: string,
  concepto: string,
): Promise<number | null> {
  const { data } = await supabase
    .from("cash_flow_monthly")
    .select("monto")
    .eq("periodo", periodoStr)
    .eq("concepto", concepto)
    .maybeSingle();
  return data ? Number(data.monto) : null;
}

/**
 * AUTO-APRENDIZAJE (24-ago-2026, pedido explícito del usuario: "los % fijos
 * pasan a recalcularse solos con los últimos meses reales"): % real de
 * `concepto`/Remuneración, promedio de los últimos N meses REALES de ambos
 * (mismo patrón que `promedioFiniquitoReal6m`/`promedioAnticipoRpReal`).
 * Usado para Anticipo y Reliquidación — Cotización usa
 * `cotizacionPctAprendido` (base de 3 sumandos, no solo Remuneración).
 * `null` si todavía no hay ningún mes real disponible — ahí
 * `calcularAnticipoProyectado`/`calcularReliquidacionProyectada` caen de
 * vuelta al % fijo (ver formulas.ts).
 */
async function pctSobreRemuneracionAprendido(
  supabase: ReturnType<typeof createServiceClient>,
  concepto: string,
  antesDe: Date,
  n = 6,
): Promise<number | null> {
  const { data } = await supabase
    .from("cash_flow_monthly")
    .select("periodo, monto")
    .eq("concepto", concepto)
    .eq("es_real", true)
    .lt("periodo", antesDe.toISOString().slice(0, 10))
    .order("periodo", { ascending: false })
    .limit(n);

  if (!data || data.length === 0) return null;

  let sumaConcepto = 0;
  let sumaRemuneracion = 0;
  for (const fila of data) {
    const remuneracion = await montoCashFlowPorPeriodoStr(
      supabase,
      fila.periodo,
      "remuneracion",
    );
    if (remuneracion == null || remuneracion === 0) continue;
    sumaConcepto += Number(fila.monto);
    sumaRemuneracion += remuneracion;
  }
  return sumaRemuneracion > 0 ? sumaConcepto / sumaRemuneracion : null;
}

/**
 * Mismo auto-aprendizaje que `pctSobreRemuneracionAprendido`, pero para
 * Cotización — su base es (Anticipo + Remuneración + Reliquidación), no
 * solo Remuneración (ver `calcularCotizacion`). Solo considera meses donde
 * Cotización es real (`ingesta_previred` o Excel histórico).
 */
async function cotizacionPctAprendido(
  supabase: ReturnType<typeof createServiceClient>,
  antesDe: Date,
  n = 6,
): Promise<number | null> {
  const { data } = await supabase
    .from("cash_flow_monthly")
    .select("periodo, monto")
    .eq("concepto", "cotizacion")
    .eq("es_real", true)
    .lt("periodo", antesDe.toISOString().slice(0, 10))
    .order("periodo", { ascending: false })
    .limit(n);

  if (!data || data.length === 0) return null;

  let sumaCotizacion = 0;
  let sumaBase = 0;
  for (const fila of data) {
    const anticipo = await montoCashFlowPorPeriodoStr(
      supabase,
      fila.periodo,
      "anticipo",
    );
    const remuneracion = await montoCashFlowPorPeriodoStr(
      supabase,
      fila.periodo,
      "remuneracion",
    );
    const reliquidacion = await montoCashFlowPorPeriodoStr(
      supabase,
      fila.periodo,
      "reliquidacion",
    );
    if (anticipo == null || remuneracion == null || reliquidacion == null)
      continue;
    const base = anticipo + remuneracion + reliquidacion;
    if (base === 0) continue;
    sumaCotizacion += Number(fila.monto);
    sumaBase += base;
  }
  return sumaBase > 0 ? sumaCotizacion / sumaBase : null;
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

  // Pull EN VIVO del estado actual de Buk — antes solo el cron mensual de
  // Vercel (que nunca ha corrido: el deploy todavía está pendiente) o los
  // backfills manuales llenaban `buk_dotacion_snapshots`, así que la fila
  // "Dotación" se quedaba estancada en el último mes que alguien hubiera
  // corrido a mano (encontrado en vivo 17-ago-2026: dotación real solo
  // hasta mayo pese a que Buk ya tenía jun/jul/parte de ago). Con esto,
  // cada "Actualizar reporte" deja un snapshot real "al día de hoy" —
  // corrige el mes en curso sin depender del cron.
  const bukSnapshotResult = await runBukSnapshot();
  if (bukSnapshotResult.estado === "error") {
    errores.push({
      fuente: "Snapshot Buk (dotación en vivo)",
      mensaje: bukSnapshotResult.errores.join("; "),
    });
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

    // Cotización real desde los comprobantes de pago de Previred — mismo
    // criterio de tolerancia que Pagos Mensuales: el mes calendario en
    // curso normalmente todavía no tiene el comprobante subido (Previred
    // se paga a mediados del mes siguiente), no es un error.
    const cotizacionResult = await syncCotizacionPrevired(mes);
    documentosIngeridos += cotizacionResult.comprobantesProcesados;
    const esMesActualSinComprobantesAun =
      mes.getTime() === mesActual.getTime() &&
      cotizacionResult.comprobantesProcesados === 0;
    if (cotizacionResult.estado === "error" && !esMesActualSinComprobantesAun) {
      errores.push({
        fuente: `Cotización Previred ${cotizacionResult.periodo}`,
        mensaje: cotizacionResult.errores.join("; "),
      });
    }

    // Beneficiarios REALES de Anticipo (personas, no divisiones) desde
    // los archivos de transferencia bancaria — pedido explícito del
    // usuario 24-ago-2026, ver sync-beneficiarios-anticipo.ts. Mismo
    // criterio de tolerancia que Pagos Mensuales/Cotización.
    const beneficiariosResult = await syncBeneficiariosAnticipo(mes);
    documentosIngeridos += beneficiariosResult.archivosProcesados;
    const esMesActualSinBeneficiariosAun =
      mes.getTime() === mesActual.getTime() &&
      beneficiariosResult.archivosProcesados === 0;
    if (
      beneficiariosResult.estado === "error" &&
      !esMesActualSinBeneficiariosAun
    ) {
      errores.push({
        fuente: `Beneficiarios Anticipo ${beneficiariosResult.periodo}`,
        mensaje: beneficiariosResult.errores.join("; "),
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
    const cotizacionReal = await sumaLineItems(supabase, mes, ["cotizacion"]);

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

    // Finiquito: SIEMPRE promedio de los últimos 6 meses reales — pedido
    // explícito del usuario 21-ago-2026, simplificando el modelo anterior
    // (correlación con bajas netas de dotación, pedido explícito del
    // 13-ago-2026, revertido el mismo día que se confirmó esto).
    const finiquitoFallback: { monto: number; metodoCalculo: string } = {
      monto: await promedioFiniquitoReal6m(supabase, mes),
      metodoCalculo: "promedio_ultimos_6_meses_reales",
    };

    // Auto-aprendizaje de los % fijos (24-ago-2026, pedido explícito del
    // usuario): Anticipo/Reliquidación/Cotización dejan de depender SOLO
    // de un % hardcodeado — se recalculan como el promedio real de los
    // últimos 6 meses reales cada vez que corre este refresh. `null`
    // mientras no haya suficiente historia real todavía (ver formulas.ts,
    // caen de vuelta al % fijo original).
    const anticipoPctAprendido = await pctSobreRemuneracionAprendido(
      supabase,
      "anticipo",
      mes,
    );
    const reliquidacionPctAprendido = await pctSobreRemuneracionAprendido(
      supabase,
      "reliquidacion",
      mes,
    );
    const cotizacionPctAprendidoMes = await cotizacionPctAprendido(
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

    // Beneficios/Bonos — RG (Convenio Lira Parque) y RP (Anexo Oficina
    // Central). Dotación reutilizando la dimensión RG/RP ya existente
    // (ver dotacionRgRpDelMes); cada evento del catálogo se resuelve real
    // > fórmula fecha-fija > promedio 6 meses > 0 (ver beneficios.ts).
    const { rg: dotacionRgMes, rp: dotacionRpMes } = await dotacionRgRpDelMes(
      supabase,
      mes,
      dotacionPorPeriodo,
    );
    const realPorEventoBeneficio = await realBeneficiosDelMes(supabase, mes);
    const promedio6mPorEvento = new Map<string, number>();
    for (const evento of eventosPromedio6Meses()) {
      const promedio = await promedioBeneficioReal6m(
        supabase,
        evento.tipoEvento,
        evento.poblacion,
        mes,
      );
      promedio6mPorEvento.set(
        `${evento.tipoEvento}::${evento.poblacion}`,
        promedio,
      );
    }
    const beneficiosCalculado = calcularBeneficiosDelMes({
      mes,
      dotacionRg: dotacionRgMes,
      dotacionRp: dotacionRpMes,
      realPorEvento: realPorEventoBeneficio,
      promedio6mPorEvento,
    });

    const calculado = calcularMesCashFlow({
      remuneracionReal,
      reliquidacionReal,
      finiquitoReal,
      anticipoReal,
      cotizacionReal,
      senceManual,
      senceFallback: await senceFallbackProyectado(supabase, mes),
      costoPromedioPorCabezaMesAnterior,
      dotacionActual,
      remuneracionFallbackPromedioHistorico,
      finiquitoFallback,
      beneficiosRg: beneficiosCalculado.rg,
      beneficiosRp: beneficiosCalculado.rp,
      anticipoPctAprendido,
      reliquidacionPctAprendido,
      cotizacionPctAprendido: cotizacionPctAprendidoMes,
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

    // Beneficios/Bonos se suman de forma IMPLÍCITA dentro de Remuneración
    // (ver engine.ts) — acá se reparten en el desglose RG/RP informativo
    // asignando cada población su propio monto exacto (no proporcional:
    // el Bono de Término de Negociación es 100% RG, por ejemplo), para
    // que RG+RP sigan sumando exacto la Remuneración total ya inflada.
    let remuneracionRgFila: CashFlowConceptoCalculado | null = null;
    let remuneracionRpFila: CashFlowConceptoCalculado | null = null;
    if (calculadoPorConcepto.remuneracion.esReal) {
      remuneracionRgFila = {
        monto: (remuneracionRgReal ?? 0) + beneficiosCalculado.rg.monto,
        esReal: true,
        metodoCalculo: "ingesta_real",
      };
      remuneracionRpFila = {
        monto: (remuneracionRpReal ?? 0) + beneficiosCalculado.rp.monto,
        esReal: true,
        metodoCalculo: "ingesta_real",
      };
    } else {
      // RP es el ANCLA (promedio de los últimos meses reales, ver
      // `promedioRemuneracionRpReal`) y RG absorbe el residual — al revés
      // de como era antes (bug real corregido 24-ago-2026: RP subía y
      // bajaba sin ningún dato real nuevo, arrastrado por el ciclo de
      // obras vía `proporcionRgHistorica`, pese a que su propia población
      // es chica y estable). Mismo criterio que Anticipo RG/RP.
      const rpPromedio = await promedioRemuneracionRpReal(supabase, mes);
      if (rpPromedio != null) {
        const rp = Math.round(rpPromedio) + beneficiosCalculado.rp.monto;
        remuneracionRpFila = {
          monto: rp,
          esReal: false,
          metodoCalculo: "promedio_ultimos_3_meses_reales",
        };
        remuneracionRgFila = {
          monto: calculadoPorConcepto.remuneracion.monto - rp,
          esReal: false,
          metodoCalculo: "residual_remuneracion_total_menos_rp",
        };
      } else {
        // Fallback final: sin NINGÚN mes real de Remuneración RP todavía
        // (compañía/obra muy nueva) — vuelve al split proporcional
        // histórico, comportamiento anterior a este fix.
        const proporcionRg = await proporcionRgHistorica(supabase, mes);
        if (proporcionRg != null) {
          const baseSinBeneficios =
            calculadoPorConcepto.remuneracion.monto -
            beneficiosCalculado.rg.monto -
            beneficiosCalculado.rp.monto;
          const rgBase = Math.round(baseSinBeneficios * proporcionRg);
          remuneracionRgFila = {
            monto: rgBase + beneficiosCalculado.rg.monto,
            esReal: false,
            metodoCalculo: "split_proporcional_historico",
          };
          remuneracionRpFila = {
            monto:
              calculadoPorConcepto.remuneracion.monto -
              remuneracionRgFila.monto,
            esReal: false,
            metodoCalculo: "split_proporcional_historico",
          };
        }
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
    } else {
      // RP es el ANCLA (promedio de los últimos meses reales, ver
      // `promedioAnticipoRpReal`) y RG absorbe el residual — al revés de
      // como era antes (bug real corregido 20-ago-2026, ver comentario de
      // esa función). RG+RP sigue sumando exacto el Anticipo total ya
      // calculado (24% × Remuneración, ver engine.ts).
      const rp = Math.round(await promedioAnticipoRpReal(supabase, mes));
      anticipoRpFila = {
        monto: rp,
        esReal: false,
        metodoCalculo: "promedio_ultimos_3_meses_reales",
      };
      anticipoRgFila = {
        monto: calculadoPorConcepto.anticipo.monto - rp,
        esReal: false,
        metodoCalculo: "residual_anticipo_total_menos_rp",
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

    // Guarda el detalle por evento — auditable, y necesario para que
    // futuros meses puedan promediar los "últimos 6 reales" de eventos
    // sin fecha fija (ver promedioBeneficioReal6m). Re-escribir una fila
    // ya real es un no-op: `calcularBeneficiosDelMes` la lee primero y
    // devuelve el mismo monto, nunca la reemplaza por fórmula.
    const { error: beneficiosError } = await supabase
      .from("beneficios_line_items")
      .upsert(
        beneficiosCalculado.lineItems.map((li) => ({
          periodo: periodoStr,
          poblacion: li.poblacion,
          tipo_evento: li.tipoEvento,
          monto: li.monto,
          es_real: li.esReal,
          metodo_calculo: li.metodoCalculo,
        })),
        { onConflict: "periodo,poblacion,tipo_evento" },
      );
    if (beneficiosError) {
      errores.push({
        fuente: `Beneficios ${periodoStr}`,
        mensaje: beneficiosError.message,
      });
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
