import type { BukEmpleadoMinimo } from "./client";

export interface DotacionAgregada {
  cargo: string;
  familiaCargo: string | null;
  areaId: string | null;
  activos: number;
  altas: number;
  /**
   * Siempre 0 por ahora — calcular "bajas" requeriría traer también
   * inactivos (fetch lento, minutos) o un endpoint de Buk de bajas
   * recientes que no existe hoy. Limitación documentada, ver client.ts.
   */
  bajas: number;
}

/**
 * Agrupa empleados activos por (cargo, área) y cuenta activos + altas del
 * mes del snapshot. Función pura — testable sin llamar a la API real.
 */
export function agruparDotacion(
  empleados: BukEmpleadoMinimo[],
  fechaSnapshot: Date,
): DotacionAgregada[] {
  const grupos = new Map<string, DotacionAgregada>();

  for (const emp of empleados) {
    const cargo = emp.cargo ?? "Sin cargo";
    const key = `${cargo}::${emp.areaId ?? "sin_area"}`;

    if (!grupos.has(key)) {
      grupos.set(key, {
        cargo,
        familiaCargo: emp.familiaCargo,
        areaId: emp.areaId,
        activos: 0,
        altas: 0,
        bajas: 0,
      });
    }
    const grupo = grupos.get(key)!;
    grupo.activos++;

    if (emp.activeSince) {
      const activeSince = new Date(emp.activeSince);
      const esDelMismoMes =
        activeSince.getFullYear() === fechaSnapshot.getFullYear() &&
        activeSince.getMonth() === fechaSnapshot.getMonth();
      if (esDelMismoMes) grupo.altas++;
    }
  }

  return [...grupos.values()];
}
