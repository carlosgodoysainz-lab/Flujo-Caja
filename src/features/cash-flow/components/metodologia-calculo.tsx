const CONCEPTOS_METODOLOGIA = [
  {
    concepto: "Anticipo",
    fuenteReal:
      "Sin fuente automatizada todavía (Fase 10, post-MVP) — hoy siempre queda en $0.",
    formula: null,
    color: "var(--err)",
  },
  {
    concepto: "Remuneración",
    fuenteReal:
      'Real cuando existe el archivo "Solicitud de Requerimiento remuneración" ingerido para ese mes (suma RG + RP, sin RUT ni nombre de persona).',
    formula:
      "Si no hay dato real: promedio de los últimos 3 meses con remuneración real.",
    color: "var(--ok)",
  },
  {
    concepto: "Finiquito",
    fuenteReal:
      'Real cuando existe dato ingerido (incluye cuotas de finiquito que vienen dentro de los mismos archivos de remuneración, ej. "Finiquito RP cuota 4/5").',
    formula:
      "Si no hay dato real: 30% × (Remuneración + Reliquidación + Anticipo) del mismo mes.",
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
      "Sin fuente real automatizada en el MVP — siempre se calcula por fórmula.",
    formula: "24% × Remuneración del mismo mes.",
    color: "var(--warn)",
  },
  {
    concepto: "Aporte SENCE",
    fuenteReal:
      "Sin fuente real automatizada en el MVP — siempre se calcula por fórmula.",
    formula: "8% × Remuneración + $30.000.000 fijo.",
    color: "var(--warn)",
  },
  {
    concepto: "Total Nómina",
    fuenteReal:
      "Suma de los 6 conceptos anteriores, cada uno con su propio origen (real o fórmula).",
    formula: null,
    color: "var(--navy-brand)",
  },
] as const;

/**
 * Explica de forma transparente cómo se calcula cada concepto — qué es
 * dato real ingerido y qué es fórmula, y cuál fórmula exacta. Las
 * fórmulas son las mismas migradas del Excel original (ver TECH-SPEC §7
 * y features/cash-flow/services/formulas.ts) — este componente es
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
          futuro o fuente pendiente), se completa con la fórmula correspondiente
          — la misma lógica que tenía el Excel original, migrada a código con
          tests.
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
          Anticipo y Finiquito por PDF (Winper legado) quedan fuera del MVP —
          ver TECH-SPEC §2.3. Cotización y SENCE nunca tienen fuente real
          automatizada hoy: son porcentajes legales relativamente estables, no
          proyecciones de alta incertidumbre.
        </p>
      </div>
    </details>
  );
}
