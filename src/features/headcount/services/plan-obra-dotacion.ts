import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { periodoDeFecha, sumarMesesAPeriodo } from "./periodo";

export interface PlanObraDotacionFila {
  obraId: string;
  obraNombre: string;
  comuna: string | null;
  tipo: string | null;
  cliente: string | null;
  unidades: number | null;
  inicioObra: string | null;
  finObra: string | null;
  durObraMeses: number | null;
  /** YYYY-MM-01 */
  periodo: string;
  /** Dotación real (suma de `buk_dotacion_snapshots.activos` de esa obra ese mes) — `null` si no hay snapshot real ese mes. */
  dotacionReal: number | null;
  /**
   * Dotación absoluta PROYECTADA para ese mes — el "saldo" acumulado
   * (altas−bajas mes a mes desde el inicio de la curva, ver
   * `forecast-model/curve.ts`), no solo el delta. `null` si esa fila
   * nunca se estimó (obra sin ningún dato todavía).
   */
  dotacionProyectada: number | null;
  /** Altas − bajas de ese mes — real (manual/buk_real) o estimado (modelo de curva por obra similar). `null` si no hay ningún dato. */
  variacionNeta: number | null;
  origenVariacion:
    "manual" | "buk_real" | "modelo_estimado" | "sin_dato_referencia" | null;
}

/**
 * Plan de obra (Gespro, vía `obras`) + dotación REAL por obra (Buk) +
 * flujo de dotación ESTIMADA (altas−bajas del modelo de curva, ver
 * `forecast-model/run.ts`) — pedido explícito del usuario para el Excel
 * descargable: "una hoja con el plan de obra actualizado en función al
 * Gespro acompañado con la dotación real por obra y flujo de dotación
 * estimada... considera el crecimiento de dotación que tienen las
 * obras... el modelo en términos de la duración de obra, flujo de
 * ingreso y flujo de salidas".
 *
 * Una fila por (obra, período) dentro del rango pedido Y dentro de la
 * duración real de la obra (`inicio_obra` → `inicio_obra + dur_obra_meses`)
 * — formato "tidy", pensado para que Finanzas pueda filtrar/pivotear en
 * el Excel directamente.
 */
export async function getPlanObraConDotacion(
  periodoDesde: Date,
  periodoHasta: Date,
): Promise<PlanObraDotacionFila[]> {
  const supabase = createServiceClient();

  const { data: obras } = await supabase
    .from("obras")
    .select(
      "id, nombre, comuna, tipo, cliente, unidades, inicio_obra, fin_obra, dur_obra_meses",
    )
    .order("inicio_obra");

  if (!obras || obras.length === 0) return [];

  // BUG REAL corregido 24-sep-2026: sin `.range()`, PostgREST trunca en
  // silencio al tope server-side (~1000 filas) — `buk_dotacion_snapshots`
  // tiene ~23.000, el mismo patrón de bug ya encontrado y corregido 3
  // veces en otros archivos (ver `dotacion-total.ts`, `refresh.ts`). Fix:
  // paginar con `.range()` hasta agotar la tabla.
  const snapshots: {
    obra_id: string | null;
    snapshot_date: string;
    activos: number;
  }[] = [];
  const TAMANO_PAGINA_SNAPSHOTS = 1000;
  for (let desde = 0; ; desde += TAMANO_PAGINA_SNAPSHOTS) {
    const { data: pagina } = await supabase
      .from("buk_dotacion_snapshots")
      .select("obra_id, snapshot_date, activos")
      .not("obra_id", "is", null)
      .range(desde, desde + TAMANO_PAGINA_SNAPSHOTS - 1);
    if (!pagina || pagina.length === 0) break;
    snapshots.push(...pagina);
    if (pagina.length < TAMANO_PAGINA_SNAPSHOTS) break;
  }

  const dotacionRealPorObraYPeriodo = new Map<string, number>();
  for (const s of snapshots ?? []) {
    if (!s.obra_id) continue;
    const key = `${s.obra_id}::${periodoDeFecha(s.snapshot_date)}`;
    dotacionRealPorObraYPeriodo.set(
      key,
      (dotacionRealPorObraYPeriodo.get(key) ?? 0) + s.activos,
    );
  }

  const { data: variaciones } = await supabase
    .from("headcount_by_obra")
    .select("obra_id, periodo, variacion_neta, acumulado, origen");
  const variacionPorObraYPeriodo = new Map<
    string,
    {
      variacionNeta: number;
      acumulado: number | null;
      origen: "manual" | "buk_real" | "modelo_estimado" | "sin_dato_referencia";
    }
  >();
  for (const v of variaciones ?? []) {
    const key = `${v.obra_id}::${periodoDeFecha(v.periodo)}`;
    variacionPorObraYPeriodo.set(key, {
      variacionNeta: v.variacion_neta,
      acumulado: v.acumulado,
      origen: v.origen,
    });
  }

  const desde = periodoDeFecha(periodoDesde.toISOString().slice(0, 10));
  const hasta = periodoDeFecha(periodoHasta.toISOString().slice(0, 10));

  const filas: PlanObraDotacionFila[] = [];
  for (const obra of obras) {
    if (!obra.inicio_obra) continue;
    const inicioPeriodo = periodoDeFecha(obra.inicio_obra);
    const duracion = obra.dur_obra_meses ?? 24; // fallback defensivo si no hay duración cargada

    for (
      let mes = 0, guard = 0;
      mes < duracion && guard < 240;
      mes++, guard++
    ) {
      const periodo = sumarMesesAPeriodo(inicioPeriodo, mes);
      if (periodo < desde || periodo > hasta) continue;

      const key = `${obra.id}::${periodo}`;
      const variacion = variacionPorObraYPeriodo.get(key);

      filas.push({
        obraId: obra.id,
        obraNombre: obra.nombre,
        comuna: obra.comuna,
        tipo: obra.tipo,
        cliente: obra.cliente,
        unidades: obra.unidades,
        inicioObra: obra.inicio_obra,
        finObra: obra.fin_obra,
        durObraMeses: obra.dur_obra_meses,
        periodo,
        dotacionReal: dotacionRealPorObraYPeriodo.get(key) ?? null,
        dotacionProyectada: variacion?.acumulado ?? null,
        variacionNeta: variacion?.variacionNeta ?? null,
        origenVariacion: variacion?.origen ?? null,
      });
    }
  }

  return filas;
}

/**
 * Nivel real MÁS RECIENTE de Buk por obra (suma de `activos` del último
 * `snapshot_date` disponible, por obra) — usado como "Saldo Inicial
 * (Buk)" en la hoja "Proyección Headcount" (pedido explícito del usuario
 * 25-ago-2026, para carga manual vía Excel): referencia visual del nivel
 * real mientras el usuario edita, no participa en ningún cálculo del
 * modelo. Una obra sin ningún snapshot propio no aparece en el mapa
 * (nunca se inventa un 0).
 */
export async function getSaldoInicialPorObra(): Promise<Map<string, number>> {
  const supabase = createServiceClient();
  // BUG REAL corregido 24-sep-2026: mismo patrón de truncamiento silencioso
  // que `getPlanObraConDotacion` — ver ese comentario. Paginado con
  // `.range()`.
  const snapshots: {
    obra_id: string | null;
    snapshot_date: string;
    activos: number;
  }[] = [];
  const TAMANO_PAGINA_SNAPSHOTS = 1000;
  for (let desde = 0; ; desde += TAMANO_PAGINA_SNAPSHOTS) {
    const { data: pagina } = await supabase
      .from("buk_dotacion_snapshots")
      .select("obra_id, snapshot_date, activos")
      .not("obra_id", "is", null)
      .range(desde, desde + TAMANO_PAGINA_SNAPSHOTS - 1);
    if (!pagina || pagina.length === 0) break;
    snapshots.push(...pagina);
    if (pagina.length < TAMANO_PAGINA_SNAPSHOTS) break;
  }

  const maxFechaPorObra = new Map<string, string>();
  for (const s of snapshots ?? []) {
    if (!s.obra_id) continue;
    const actual = maxFechaPorObra.get(s.obra_id);
    if (!actual || s.snapshot_date > actual) {
      maxFechaPorObra.set(s.obra_id, s.snapshot_date);
    }
  }

  const resultado = new Map<string, number>();
  for (const s of snapshots ?? []) {
    if (!s.obra_id) continue;
    if (s.snapshot_date !== maxFechaPorObra.get(s.obra_id)) continue;
    resultado.set(s.obra_id, (resultado.get(s.obra_id) ?? 0) + s.activos);
  }
  return resultado;
}
