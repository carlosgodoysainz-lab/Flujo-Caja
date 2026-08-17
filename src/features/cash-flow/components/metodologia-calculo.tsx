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
      "Si no hay dato real: cuando la dotación total proyecta una BAJA NETA ese mes (curva de cierre de obra), se correlaciona con el costo promedio histórico por baja neta; si no hay baja neta ese mes o no hay histórico suficiente para calibrar, cae al promedio de los últimos 6 meses con Finiquito real (0 si todavía no hay 6 meses de historial).",
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
      'Si no hay dato real: pago anual de 500 UF, convertidas al valor de UF real del mes de pago (30 de junio todos los años; 2026 es la excepción, se retrasó a agosto). En el resto de los meses el valor es $0 — no queda "pendiente", es el monto correcto y final.',
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
 * Qué hace que cada concepto SUBA o BAJE de un mes al siguiente — pedido
 * explícito del usuario (17-ago-2026): "incorpora una explicación
 * mostrando el detalle de cómo el modelo aumenta o disminuye los
 * conceptos mes a mes para que sea explicativo". Es la mecánica GENERAL
 * (aplica igual todos los meses), no un cálculo puntual de un mes
 * específico — complementa la tabla de arriba (qué fórmula usa) con el
 * PORQUÉ del movimiento mes a mes.
 */
const MOTOR_CAMBIO_MENSUAL = [
  {
    concepto: "Dotación (N°)",
    explicacion:
      "El motor de TODO lo demás. Sube cuando arranca o avanza una obra (más gente contratada); baja hacia el cierre de una obra (desvinculaciones). Un salto grande de un mes a otro casi siempre viene de una obra que empieza/termina, no de un cambio gradual.",
  },
  {
    concepto: "Remuneración",
    explicacion:
      "Sube o baja principalmente porque cambia la DOTACIÓN, no el costo por persona (que se mantiene relativamente estable mes a mes): Remuneración ≈ costo promedio por cabeza del mes anterior × dotación del mes actual. Si la dotación crece 5%, Remuneración proyectada crece ≈5% en el mismo sentido.",
  },
  {
    concepto: "Anticipo",
    explicacion:
      "Sigue a Remuneración del mismo mes (24% de ella) — sube o baja en la MISMA dirección y proporción, nunca tiene un movimiento propio distinto.",
  },
  {
    concepto: "Reliquidación",
    explicacion:
      "Igual que Anticipo: sigue a Remuneración (1% de ella) — mismo sentido, sin dinámica propia.",
  },
  {
    concepto: "Finiquito",
    explicacion:
      "Es la excepción — no sigue a Remuneración, sigue a las BAJAS de dotación. Sube en los meses donde la dotación total cae (cierre de obra, desvinculaciones); en meses sin caída neta se mantiene estable en torno al promedio histórico.",
  },
  {
    concepto: "Cotización",
    explicacion:
      "30% de (Anticipo + Remuneración + Reliquidación) — como Remuneración es el componente más grande de esa suma, Cotización en la práctica sube o baja siguiendo a Remuneración, con la misma causa raíz: la dotación.",
  },
  {
    concepto: "Aporte SENCE",
    explicacion:
      "No tiene una dinámica gradual — es un escalón: $0 durante 11 meses, y un salto único al monto completo (500 UF) el mes de pago (30-jun normalmente; agosto en 2026). No sube ni baja gradualmente, salta.",
  },
  {
    concepto: "Total Nómina",
    explicacion:
      "Suma de todos los anteriores — en la práctica, se mueve casi siempre en la MISMA dirección que la dotación (a través de Remuneración, Anticipo, Reliquidación y Cotización), con un salto adicional puntual el mes de pago de SENCE y en los meses con Finiquito alto por cierre de obra.",
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

        <div className="border-t border-slate-100 pt-3">
          <h3 className="text-sm font-medium text-slate-700">
            ¿Por qué sube o baja cada concepto de un mes al siguiente?
          </h3>
          <p className="mt-1 text-xs text-slate-400">
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
