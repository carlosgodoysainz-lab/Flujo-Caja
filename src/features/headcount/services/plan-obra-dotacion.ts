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
  // paginar con `.range()` hasta agotar la tabla. BUG REAL corregido
  // 24-sep-2026: sin `.order()` antes de `.range()`, Postgres no garantiza
  // el mismo orden entre llamadas — cada página puede saltarse o repetir
  // filas (confirmado: una obra con 148 filas reales traía solo 25 así).
  // El orden en sí no importa para el cálculo, solo que sea ESTABLE.
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
      .order("snapshot_date")
      .order("obra_id")
      .range(desde, desde + TAMANO_PAGINA_SNAPSHOTS - 1);
    if (!pagina || pagina.length === 0) break;
    snapshots.push(...pagina);
    if (pagina.length < TAMANO_PAGINA_SNAPSHOTS) break;
  }

  // BUG REAL corregido 24-sep-2026 (visto en vivo: agosto-2026 salía con
  // dotación imposible — 1.167, 1.229, 1.315 en obras de unas 200-300
  // unidades): sumaba TODOS los snapshots de una obra dentro del mismo
  // mes calendario, y agosto tenía más de 1 snapshot (el cron mensual +
  // un pull en vivo de "Actualizar reporte" más tarde ese mismo mes) —
  // sumar 2 fotos de la misma gente duplica a quien sigue activo en
  // ambas. Mismo bug ya corregido 17-ago-2026 en `dotacion-total.ts`
  // (`getDotacionTotalPorPeriodo`), nunca replicado acá: primero se suma
  // `activos` por FECHA EXACTA, después cada mes se queda con la fecha
  // más reciente que caiga en ese mes — nunca con la suma de varias.
  const sumaPorObraYFechaExacta = new Map<string, number>();
  for (const s of snapshots) {
    if (!s.obra_id) continue;
    const key = `${s.obra_id}::${s.snapshot_date}`;
    sumaPorObraYFechaExacta.set(
      key,
      (sumaPorObraYFechaExacta.get(key) ?? 0) + s.activos,
    );
  }
  const maxFechaPorObraYPeriodo = new Map<string, string>();
  for (const key of sumaPorObraYFechaExacta.keys()) {
    const [obraId, fecha] = key.split("::");
    const periodoKey = `${obraId}::${periodoDeFecha(fecha)}`;
    const actual = maxFechaPorObraYPeriodo.get(periodoKey);
    if (!actual || fecha > actual)
      maxFechaPorObraYPeriodo.set(periodoKey, fecha);
  }
  const dotacionRealPorObraYPeriodo = new Map<string, number>();
  let periodoGlobalMasReciente = "";
  for (const [periodoKey, fecha] of maxFechaPorObraYPeriodo) {
    const [obraId] = periodoKey.split("::");
    const periodo = periodoDeFecha(fecha);
    dotacionRealPorObraYPeriodo.set(
      `${obraId}::${periodo}`,
      sumaPorObraYFechaExacta.get(`${obraId}::${fecha}`) ?? 0,
    );
    if (periodo > periodoGlobalMasReciente) periodoGlobalMasReciente = periodo;
  }

  // Último período REAL por obra — punto de anclaje para proyectar hacia
  // adelante con el plan (mismo criterio que `getDotacionTotalPorPeriodo`,
  // ahora a nivel de obra individual).
  //
  // BUG REAL corregido 24-sep-2026: anclar SIEMPRE en el máximo histórico
  // de la obra (sin importar qué tan viejo) hacía que una obra que dejó de
  // aparecer en Buk (obra cerrada, o área renombrada/eliminada) siguiera
  // proyectando hacia adelante desde su última dotación conocida, aunque
  // fuera de hace años (ej. "General Mackenna 1": último real de
  // 2023-03-01, obra que en Gespro recién parte en 2028).
  //
  // Tolerancia de 3 meses (24-sep-2026, auditoría de este mismo fix):
  // la primera versión anclaba a 0 apenas la obra quedaba 1 mes detrás del
  // período global más reciente — eso confunde "la obra cerró" con "Buk
  // no tuvo novedades para esta obra puntual ese mes" (el snapshot mensual
  // reescribe TODAS las obras activas de una vez, pero una obra sin
  // movimiento ese mes puede simplemente no generar fila). Con 3+ meses
  // consecutivos sin ningún dato real, ya no es un hueco puntual — recién
  // ahí se asume vigente = 0. Una obra que JAMÁS tuvo dato real sigue sin
  // anclaje (no se inventa un 0), igual que antes.
  const TOLERANCIA_MESES_SIN_DATO_REAL = 3;
  const umbralAnclaje = sumarMesesAPeriodo(
    periodoGlobalMasReciente,
    -TOLERANCIA_MESES_SIN_DATO_REAL,
  );
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
  for (const [obraId, historico] of ultimoRealPorObra) {
    if (historico.periodo < umbralAnclaje) {
      ultimoRealPorObra.set(obraId, {
        periodo: periodoGlobalMasReciente,
        total: 0,
      });
    }
  }

  // Plan de Dotación del usuario (Fase 2, 24-sep-2026) — fuente única de
  // la variación FUTURA, reemplaza al modelo estadístico (headcount_by_obra).
  const { data: planRows } = await supabase
    .from("plan_dotacion")
    .select("obra_id, periodo, variacion_neta")
    .eq("unidad", "obra");
  const variacionPorObraYPeriodo = new Map<string, number>();
  const rangoPlanPorObra = new Map<string, { desde: string; hasta: string }>();
  for (const v of planRows ?? []) {
    if (!v.obra_id) continue;
    const periodo = periodoDeFecha(v.periodo);
    variacionPorObraYPeriodo.set(`${v.obra_id}::${periodo}`, v.variacion_neta);
    const rango = rangoPlanPorObra.get(v.obra_id);
    rangoPlanPorObra.set(v.obra_id, {
      desde: !rango || periodo < rango.desde ? periodo : rango.desde,
      hasta: !rango || periodo > rango.hasta ? periodo : rango.hasta,
    });
  }

  // BUG REAL corregido 24-sep-2026 (visto en vivo: la hoja "Plan de Obra
  // (Horizontal)" dejaba en blanco las 8 obras nuevas — Vista Llacolén A,
  // Vistamar, DS19... — y Σ obras quedaba 1.097 bajo el total en ago-27):
  // una obra CON plan pero sin ningún real en Buk todavía no tenía ancla,
  // mientras `getDotacionTotalPorPeriodo` sí sumaba su plan. Mismo
  // criterio que el total: parte de 0 en el período real más reciente y
  // acumula su plan. Sin plan y sin real sigue sin ancla (no se inventa).
  for (const obraId of rangoPlanPorObra.keys()) {
    if (!ultimoRealPorObra.has(obraId)) {
      ultimoRealPorObra.set(obraId, {
        periodo: periodoGlobalMasReciente,
        total: 0,
      });
    }
  }

  const desde = periodoDeFecha(periodoDesde.toISOString().slice(0, 10));
  const hasta = periodoDeFecha(periodoHasta.toISOString().slice(0, 10));

  const filas: PlanObraDotacionFila[] = [];
  for (const obra of obras) {
    if (!obra.inicio_obra) continue;
    const duracion = obra.dur_obra_meses ?? 24; // fallback defensivo si no hay duración cargada
    // El recorrido cubre la duración Gespro de la obra Y todo mes con plan
    // cargado — el Plan de Dotación del usuario puede empezar antes del
    // inicio Gespro (ej. DS19: plan desde dic-26, Gespro jun-27) o seguir
    // con bajas después del fin Gespro (ej. Jorge Edwards). El total de la
    // compañía (`getDotacionTotalPorPeriodo`) suma TODO el plan sin recortar
    // por Gespro; si esta hoja recortara, Σ obras no cuadraría con el total.
    const rangoPlan = rangoPlanPorObra.get(obra.id);
    const inicioGespro = periodoDeFecha(obra.inicio_obra);
    const finGespro = sumarMesesAPeriodo(inicioGespro, duracion - 1);
    const inicioPeriodo =
      rangoPlan && rangoPlan.desde < inicioGespro
        ? rangoPlan.desde
        : inicioGespro;
    const finPeriodo =
      rangoPlan && rangoPlan.hasta > finGespro ? rangoPlan.hasta : finGespro;
    const ultimoReal = ultimoRealPorObra.get(obra.id) ?? null;
    let acumuladoProyectado = ultimoReal?.total ?? null;

    // Recorre TODOS los meses de la obra (no solo los del rango pedido) —
    // el acumulado necesita continuidad desde el último real, aunque
    // `periodoDesde` empiece más adelante; solo se descarta la FILA fuera
    // de rango, nunca el paso de acumulación.
    for (
      let periodo = inicioPeriodo, guard = 0;
      periodo <= finPeriodo && guard < 240;
      periodo = sumarMesesAPeriodo(periodo, 1), guard++
    ) {
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
  // `.range()`. Y con `.order()` estable antes — ver el comentario
  // detallado en `getPlanObraConDotacion` arriba (mismo bug, misma tabla).
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
      .order("snapshot_date")
      .order("obra_id")
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
