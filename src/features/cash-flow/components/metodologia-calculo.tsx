import {
  CONCEPTOS_METODOLOGIA,
  MOTOR_CAMBIO_MENSUAL,
} from "../lib/metodologia-contenido";

/** Color de acento por concepto — solo para esta vista (el Excel no lo necesita). */
const COLOR_POR_CONCEPTO: Record<string, string> = {
  "Anticipo (RG/RP)": "var(--ok)",
  "Remuneración (RG/RP)": "var(--ok)",
  Finiquito: "var(--ok)",
  Reliquidación: "var(--ok)",
  Cotización: "var(--warn)",
  "Aporte SENCE": "var(--warn)",
  "Total Nómina": "var(--navy-brand)",
};

/**
 * Explica de forma transparente cómo se calcula cada concepto — qué es
 * dato real ingerido, qué es fórmula (y cuál exacta) y qué es siempre
 * manual. Metodología REDEFINIDA junto con el usuario tras revisar el
 * Excel real formula por fórmula (ver Auto-Blindaje en la Pieza y
 * features/cash-flow/services/formulas.ts) — este componente es
 * documentación viva, no debe desincronizarse del código real. El
 * contenido vive en `metodologia-contenido.ts` (compartido con la hoja
 * "Metodología" del Excel descargable, ver render-excel.ts).
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
              <tr className="border-b border-slate-200 text-xs text-slate-500">
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
                    style={{ color: COLOR_POR_CONCEPTO[c.concepto] }}
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
        <p className="text-xs text-slate-500">
          Fila "Dotación (N°)" de la tabla de detalle: real desde el Excel
          maestro de Flujo de Caja o snapshots de Buk; proyectada acumulando
          altas−bajas por obra hacia adelante — sube en el arranque, se
          estabiliza en régimen y baja por desvinculaciones hacia el cierre
          (curva de obras similares ya terminadas, mismo tipo, tamaño ±30%). Ver
          /dotacion para el detalle por obra.
        </p>

        <div className="border-t border-slate-100 pt-3">
          <h3 className="text-sm font-medium text-slate-700">
            ¿Por qué sube o baja cada concepto de un mes al siguiente?
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            La tabla de arriba explica QUÉ fórmula usa cada concepto — esto
            explica el MOTOR detrás del movimiento mes a mes: qué lo hace subir
            o bajar, y por qué casi todo se mueve en la misma dirección que la
            dotación.
          </p>
          <dl className="mt-3 space-y-2.5 text-sm">
            {MOTOR_CAMBIO_MENSUAL.map((m) => (
              <div key={m.concepto} className="flex gap-3">
                <dt className="w-32 shrink-0 font-medium text-slate-700">
                  {m.concepto}
                </dt>
                <dd className="text-slate-600">{m.explicacion}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </details>
  );
}
