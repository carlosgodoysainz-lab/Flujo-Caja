const CONCEPTOS_METODOLOGIA = [
  {
    concepto: "Anticipo",
    fuenteReal:
      'Real cuando existe "solicitud requerimientos anticipo <mes> <año>.xlsx" ingerido para ese mes (hojas "anticipo RG"/"anticipo RP", sin RUT ni nombre de persona — el archivo crudo de Buk que sí trae RUT personal se descarta a propósito).',
    formula: "Si no hay dato real: 24% × Remuneración del mismo mes.",
    color: "var(--ok)",
  },
  {
    concepto: "Remuneración",
    fuenteReal:
      'Real cuando existe el archivo "Solicitud de Requerimiento remuneración" ingerido para ese mes (suma RG + RP, sin RUT ni nombre de persona).',
    formula:
      "Si no hay dato real: costo promedio por cabeza del mes anterior (Remuneración$ mes anterior ÷ dotación mes anterior) × dotación del mes actual. La dotación es real (Buk) cuando existe el snapshot mensual, o proyectada acumulando altas−bajas por obra (curva de obras similares — ver /dotacion). Si tampoco hay dato de dotación: promedio de los últimos 3 meses reales.",
    color: "var(--ok)",
  },
  {
    concepto: "Finiquito",
    fuenteReal:
      'Real cuando existe dato ingerido (incluye cuotas de finiquito que vienen dentro de los mismos archivos de remuneración, ej. "Finiquito RP cuota 4/5").',
    formula:
      "Si no hay dato real: promedio de los últimos 6 meses con Finiquito real ingerido (0 si todavía no hay 6 meses de historial).",
    color: "var(--ok)",
  },
  {
    concepto: "Reliquidación",
    fuenteReal:
      'Real cuando existe el archivo "Solicitud de Requerimiento reliquidación" ingerido para ese mes.',
    formula: "Si no hay dato real: 1% × Remuneración del mismo mes.",
    color: "var(--ok)",
  },
  {
    concepto: "Cotización",
    fuenteReal:
      "Sin fuente real automatizada — siempre se calcula por fórmula (porcentaje legal relativamente estable).",
    formula: "30% × (Anticipo + Remuneración + Reliquidación) del mismo mes.",
    color: "var(--warn)",
  },
  {
    concepto: "Aporte SENCE",
    fuenteReal:
      "SIEMPRE manual — es específico de cada período, no tiene fórmula ni fuente automatizada. Se ingresa directamente en la celda de la tabla de detalle (click para editar).",
    formula: null,
    color: "var(--err)",
  },
  {
    concepto: "Total Nómina",
    fuenteReal:
      "Suma de los 6 conceptos anteriores, cada uno con su propio origen (real, fórmula o manual).",
    formula: null,
    color: "var(--navy-brand)",
  },
] as const;

/**
 * Explica de forma transparente cómo se calcula cada concepto — qué es
 * dato real ingerido, qué es fórmula (y cuál exacta) y qué es siempre
 * manual. Metodología REDEFINIDA junto con el usuario tras revisar el
 * Excel real formula por fórmula (ver Auto-Blindaje en la Pieza y
 * features/cash-flow/services/formulas.ts) — este componente es
 * documentación viva, no debe desincronizarse del código real.
 */
export function MetodologiaCalculo() {
  return (
    <details className="rounded-lg border border-slate-200 p-4">
      <summary className="cursor-pointer text-sm font-medium text-slate-700">
        ¿Cómo se calcula este flujo? — metodología por concepto
      </summary>
      <div className="mt-4 space-y-3 text-sm">
        <p className="text-slate-500">
          Cada concepto usa dato{" "}
          <strong className="text-[var(--ok)]">real</strong> cuando existe un
          archivo ingerido para ese mes desde SharePoint; si no existe (mes
          futuro o fuente pendiente), se completa con la fórmula
          correspondiente. El Aporte SENCE es la única excepción: nunca tiene
          fórmula, siempre se ingresa a mano.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-400">
                <th className="py-1.5 pr-3">Concepto</th>
                <th className="py-1.5 pr-3">Fuente real</th>
                <th className="py-1.5">Fórmula (si no hay dato real)</th>
              </tr>
            </thead>
            <tbody>
              {CONCEPTOS_METODOLOGIA.map((c) => (
                <tr
                  key={c.concepto}
                  className="border-b border-slate-100 align-top"
                >
                  <td
                    className="py-2 pr-3 font-medium"
                    style={{ color: c.color }}
                  >
                    {c.concepto}
                  </td>
                  <td className="py-2 pr-3 text-slate-600">{c.fuenteReal}</td>
                  <td className="py-2 text-slate-600 italic">
                    {c.formula ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-400">
          Modelo de dotación (variable "Q" de Remuneración): la curva de
          altas−bajas por obra se estima comparando contra obras similares ya
          terminadas (mismo tipo, tamaño ±30%) — sube en el arranque, se
          estabiliza en régimen y baja por desvinculaciones hacia el cierre. Ver
          /dotacion para el detalle por obra.
        </p>
      </div>
    </details>
  );
}
