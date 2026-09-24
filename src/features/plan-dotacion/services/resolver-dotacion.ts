/**
 * Reglas puras del Plan de Dotación (Fase 2, 24-sep-2026) — el plan de
 * dotación del usuario, leído desde SharePoint (ver `sync-plan-dotacion.ts`),
 * pasa a ser la fuente ÚNICA de la dotación FUTURA. Reemplaza al modelo
 * estadístico de "obras similares" (`headcount/forecast-model/`), que
 * llevaba 7 versiones de parches sobre el mismo síntoma: la proyección
 * volvía a la escala de otras obras en vez de reflejar el plan real del
 * usuario (ver Auto-Blindaje y el análisis comparativo del 23-sep-2026).
 *
 * Sin acceso a BD — testeable directo, sin mockear Supabase.
 */

export interface PlanDotacionVariacion {
  /** `null` = fila de Oficina Central, no una obra. */
  obraId: string | null;
  /** YYYY-MM-01 */
  periodo: string;
  variacionNeta: number;
}

/**
 * Suma la variación neta de TODAS las filas del plan (obras + Oficina
 * Central) para un período puntual — el mismo encadenamiento que hacía
 * el Excel tradicional del usuario, ahora aplicado sobre el plan real en
 * vez de la curva estimada por el modelo estadístico.
 */
export function sumarVariacionPlanDelPeriodo(
  variaciones: PlanDotacionVariacion[],
  periodo: string,
): number {
  return variaciones
    .filter((v) => v.periodo === periodo)
    .reduce((acc, v) => acc + v.variacionNeta, 0);
}

export interface ObraParaAlerta {
  id: string;
  nombre: string;
  /** YYYY-MM-DD */
  finObra: string | null;
}

export interface AlertaObraCerrada {
  obraId: string;
  obraNombre: string;
  finObra: string;
  dotacionActual: number;
}

/**
 * Obras que YA pasaron su fecha de término (Gespro) pero siguen con
 * dotación real > 0 y sin ningún plan de cierre cargado — decisión
 * explícita del usuario (24-sep-2026): no se les inventa una baja a 0,
 * se mantiene la dotación real y se alerta para que el usuario cargue el
 * plan de cierre en su propio archivo.
 */
export function detectarObrasCerradasSinPlan(params: {
  obras: ObraParaAlerta[];
  variaciones: PlanDotacionVariacion[];
  /** obraId → última dotación real conocida (ver `getSaldoInicialPorObra`). */
  dotacionRealPorObra: Map<string, number>;
  /** YYYY-MM-DD — "hoy". */
  hoyStr: string;
}): AlertaObraCerrada[] {
  const { obras, variaciones, dotacionRealPorObra, hoyStr } = params;
  const obraIdsConPlan = new Set(
    variaciones
      .filter(
        (v): v is PlanDotacionVariacion & { obraId: string } =>
          v.obraId != null,
      )
      .map((v) => v.obraId),
  );
  const alertas: AlertaObraCerrada[] = [];
  for (const obra of obras) {
    if (!obra.finObra || obra.finObra >= hoyStr) continue; // no vencida
    if (obraIdsConPlan.has(obra.id)) continue; // tiene plan cargado (aunque sea 0)
    const dotacionActual = dotacionRealPorObra.get(obra.id) ?? 0;
    if (dotacionActual <= 0) continue;
    alertas.push({
      obraId: obra.id,
      obraNombre: obra.nombre,
      finObra: obra.finObra,
      dotacionActual,
    });
  }
  return alertas;
}

/**
 * Obras VIGENTES (sin fecha de término vencida) que no tienen NINGUNA
 * fila de plan cargada — para el aviso "sin plan, dotación se mantiene
 * plana" en /dotacion. No es un error, es información: el usuario decide
 * si completar el plan de esa obra o dejarla así.
 */
export function detectarObrasSinPlan(params: {
  obras: ObraParaAlerta[];
  variaciones: PlanDotacionVariacion[];
  hoyStr: string;
}): ObraParaAlerta[] {
  const { obras, variaciones, hoyStr } = params;
  const obraIdsConPlan = new Set(
    variaciones
      .filter(
        (v): v is PlanDotacionVariacion & { obraId: string } =>
          v.obraId != null,
      )
      .map((v) => v.obraId),
  );
  return obras.filter(
    (o) => (!o.finObra || o.finObra >= hoyStr) && !obraIdsConPlan.has(o.id),
  );
}
