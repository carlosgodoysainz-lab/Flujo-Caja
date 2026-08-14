const CONCEPTOS_METODOLOGIA = [
  {
    concepto: "Anticipo (RG/RP)",
    fuenteReal:
      'Real desde 2 fuentes, en orden de prioridad: (1) el Excel MAESTRO de Flujo de Caja (carpeta "Flujo de Caja", Finanzas) para meses ya cerrados — la más completa históricamente; (2) "solicitud requerimientos anticipo <mes> <año>.xlsx" ingerido de SharePoint para meses recientes que el Excel maestro todavía no cierra. Ambas ya traen RG/RP separado, sin RUT ni nombre de persona.',
    formula:
      "Si no hay dato real: 24% × Remuneración del mismo mes (total); el desglose RG/RP proyectado aplica esa misma fórmula solo a la porción RG de Remuneración, y el residual va a RP.",
    color: "var(--ok)",
  },
  {
    concepto: "Remuneración (RG/RP)",
    fuenteReal:
      'Real desde las mismas 2 fuentes que Anticipo: el Excel maestro (histórico, ya separa RG/RP con su dotación real en la columna "N°") o el archivo "Solicitud de Requerimiento remuneración" de SharePoint para meses recientes.',
    formula:
      "Si no hay dato real: costo promedio por cabeza del mes anterior (Remuneración$ mes anterior ÷ dotación mes anterior) × dotación del mes actual — el total. El desglose RG/RP proyectado usa la razón real RG/(RG+RP) promedio de los últimos 3 meses reales. La dotación es real (Excel histórico o snapshot de Buk) o proyectada acumulando altas−bajas por obra (curva de obras similares — ver /dotacion). Si tampoco hay dato de dotación: promedio de los últimos 3 meses reales. Incluye de forma IMPLÍCITA los Beneficios/Bonos del Convenio Colectivo Lira Parque (RG) y del Anexo Beneficio Oficina Central (RP) — aguinaldos, aporte sindical, etc. (ver beneficios.ts) — no aparecen como fila aparte, quedan sumados dentro de este monto.",
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
    formula:
      "30% × (Anticipo + Remuneración + Reliquidación) del mismo mes. Como Remuneración ya incluye Beneficios/Bonos de forma implícita, quedan incluidos en la base sin un 4to sumando.",
    color: "var(--warn)",
  },
  {
    concepto: "Aporte SENCE",
    fuenteReal:
      "SIEMPRE manual — es específico de cada período, no tiene fórmula automática. Se ingresa directamente en la celda de la tabla de detalle (click para editar); ese valor manual siempre tiene prioridad.",
    formula:
      "Si no hay dato real: pago anual proyectado en $20.000.000 el mes esperado (junio todos los años; 2026 es la excepción, se pagó en agosto). 0 en el resto de los meses.",
    color: "var(--warn)",
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
          correspondiente. El Aporte SENCE es la única excepción: nunca se
          calcula desde un archivo real, siempre se ingresa a mano — la
          "fórmula" que se ve para él es solo un recordatorio de que se paga una
          vez al año.
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
          Fila "Dotación (N°)" de la tabla de detalle: real desde el Excel
          maestro de Flujo de Caja o snapshots de Buk; proyectada acumulando
          altas−bajas por obra hacia adelante — sube en el arranque, se
          estabiliza en régimen y baja por desvinculaciones hacia el cierre
          (curva de obras similares ya terminadas, mismo tipo, tamaño ±30%). Ver
          /dotacion para el detalle por obra.
        </p>
      </div>
    </details>
  );
}
