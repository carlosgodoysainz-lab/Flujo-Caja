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
   * Dotación absoluta PROYECTADA para ese mes — el real más reciente de
   * la obra (Buk) más la variación acumulada del Plan de Dotación desde
   * ahí. `null` si esa obra todavía no tiene ningún real propio desde el
   * que proyectar (obra muy nueva, sin snapshot de Buk todavía).
   */
  dotacionProyectada: number | null;
  /** Altas − bajas de ese mes según el Plan de Dotación del usuario. `null` si esa obra no tiene plan cargado para ese mes. */
  variacionNeta: number | null;
  /** `'plan'` si el usuario cargó una variación para ese mes; `'sin_plan'` si no. */
  origenVariacion: "plan" | "sin_plan" | null;
}

/**
 * Plan de obra (Gespro, vía `obras`) + dotación REAL por obra (Buk) +
 * Plan de Dotación del usuario (altas−bajas, ver `plan_dotacion` — Fase 2,
 * 24-sep-2026) — para el Excel descargable: "una hoja con el plan de obra
 * actualizado en función al Gespro acompañado con la dotación real por
 * obra y el flujo de dotación planificado".
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
  for (const s of snapshots) {
    if (!s.obra_id) continue;
    const key = `${s.obra_id}::${periodoDeFecha(s.snapshot_date)}`;
    dotacionRealPorObraYPeriodo.set(
      key,
      (dotacionRealPorObraYPeriodo.get(key) ?? 0) + s.activos,
    );
  }

  // Último período REAL por obra — punto de anclaje para proyectar hacia
  // adelante con el plan (mismo criterio que `getDotacionTotalPorPeriodo`,
  // ahora a nivel de obra individual).
  const ultimoRealPorObra = new Map<
    string,
    { periodo: string; total: number }
  >();
  for (const [key, total] of dotacionRealPorObraYPeriodo) {
    const [obraId, periodo] = key.split("::");
    const actual = ultimoRealPorObra.get(obraId);
    if (!actual || periodo > actual.periodo) {
      ultimoRealPorObra.set(obraId, { periodo, total });
    }
  }

  // Plan de Dotación del usuario (Fase 2, 24-sep-2026) — fuente única de
  // la variación FUTURA, reemplaza al modelo estadístico (headcount_by_obra).
  const { data: planRows } = await supabase
    .from("plan_dotacion")
    .select("obra_id, periodo, variacion_neta")
    .eq("unidad", "obra");
  const variacionPorObraYPeriodo = new Map<string, number>();
  for (const v of planRows ?? []) {
    if (!v.obra_id) continue;
    variacionPorObraYPeriodo.set(
      `${v.obra_id}::${periodoDeFecha(v.periodo)}`,
      v.variacion_neta,
    );
  }

  const desde = periodoDeFecha(periodoDesde.toISOString().slice(0, 10));
  const hasta = periodoDeFecha(periodoHasta.toISOString().slice(0, 10));

  const filas: PlanObraDotacionFila[] = [];
  for (const obra of obras) {
    if (!obra.inicio_obra) continue;
    const inicioPeriodo = periodoDeFecha(obra.inicio_obra);
    const duracion = obra.dur_obra_meses ?? 24; // fallback defensivo si no hay duración cargada
    const ultimoReal = ultimoRealPorObra.get(obra.id) ?? null;
    let acumuladoProyectado = ultimoReal?.total ?? null;

    // Recorre TODOS los meses de la obra (no solo los del rango pedido) —
    // el acumulado necesita continuidad desde el último real, aunque
    // `periodoDesde` empiece más adelante; solo se descarta la FILA fuera
    // de rango, nunca el paso de acumulación.
    for (
      let mes = 0, guard = 0;
      mes < duracion && guard < 240;
      mes++, guard++
    ) {
      const periodo = sumarMesesAPeriodo(inicioPeriodo, mes);
      const key = `${obra.id}::${periodo}`;
      const dotacionReal = dotacionRealPorObraYPeriodo.get(key) ?? null;
      const variacionNeta = variacionPorObraYPeriodo.get(key) ?? null;

      let dotacionProyectada: number | null;
      if (dotacionReal != null) {
        dotacionProyectada = dotacionReal;
      } else if (ultimoReal && periodo > ultimoReal.periodo) {
        acumuladoProyectado = (acumuladoProyectado ?? 0) + (variacionNeta ?? 0);
        dotacionProyectada = acumuladoProyectado;
      } else {
        dotacionProyectada = null;
      }

      if (periodo < desde || periodo > hasta) continue;

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
        dotacionReal,
        dotacionProyectada,
        variacionNeta,
        origenVariacion: variacionNeta != null ? "plan" : "sin_plan",
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
