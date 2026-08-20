/**
 * Contenido de la metodología de cálculo — extraído de
 * `metodologia-calculo.tsx` (17-ago-2026) para que el Excel descargable
 * (`render-excel.ts`) pueda mostrar la MISMA explicación en su propia
 * hoja, sin duplicar el texto en 2 lugares (pedido explícito del
 * usuario: "faltan las explicaciones de las modificaciones de valores
 * en el excel"). Documentación viva — no debe desincronizarse del
 * código real (ver `engine.ts`/`formulas.ts`).
 */
export const CONCEPTOS_METODOLOGIA = [
  {
    concepto: "Anticipo (RG/RP)",
    fuenteReal:
      'Real desde 2 fuentes, en orden de prioridad: (1) el Excel MAESTRO de Flujo de Caja (carpeta "Flujo de Caja", Finanzas) para meses ya cerrados — la más completa históricamente; (2) "solicitud requerimientos anticipo <mes> <año>.xlsx" ingerido de SharePoint para meses recientes que el Excel maestro todavía no cierra. Ambas ya traen RG/RP separado, sin RUT ni nombre de persona.',
    formula:
      "Si no hay dato real: 24% × Remuneración del mismo mes (total). El desglose RG/RP proyectado ancla RP en el promedio de los últimos 3 meses reales (RP es un grupo chico y estable de gente que pide Anticipo, no escala con toda la planilla RP — bug real corregido 20-ago-2026, antes RP salía como residual y se inflaba junto con Remuneración) y RG absorbe el residual (Total − RP). Se evaluó un modelo costo-por-cabeza con dotación propia de Anticipo (18-ago-2026) y se revirtió el mismo día: el Anticipo es por naturaleza un adelanto de un % del sueldo de cada persona, no un costo fijo por cabeza — confirmado además leyendo la fórmula real del Excel maestro de Finanzas, que también usa 24% × Remuneración para sus meses proyectados.",
  },
  {
    concepto: "Remuneración (RG/RP)",
    fuenteReal:
      'Real desde las mismas 2 fuentes que Anticipo: el Excel maestro (histórico, ya separa RG/RP con su dotación real en la columna "N°") o el archivo "Solicitud de Requerimiento remuneración" de SharePoint para meses recientes.',
    formula:
      "Si no hay dato real: costo promedio por cabeza del mes anterior (Remuneración$ mes anterior ÷ dotación mes anterior) × dotación del mes actual — el total. El desglose RG/RP proyectado usa la razón real RG/(RG+RP) promedio de los últimos 3 meses reales. La dotación es real (Excel histórico o snapshot de Buk) o proyectada acumulando altas−bajas por obra (curva de obras similares — ver /dotacion). Si tampoco hay dato de dotación: promedio de los últimos 3 meses reales. Incluye de forma IMPLÍCITA los Beneficios/Bonos del Convenio Colectivo Lira Parque (RG) y del Anexo Beneficio Oficina Central (RP) — aguinaldos, aporte sindical, etc. (ver beneficios.ts) — no aparecen como fila aparte, quedan sumados dentro de este monto.",
  },
  {
    concepto: "Finiquito",
    fuenteReal:
      'Real cuando existe dato ingerido (incluye cuotas de finiquito que vienen dentro de los mismos archivos de remuneración, ej. "Finiquito RP cuota 4/5").',
    formula:
      "Si no hay dato real: cuando la dotación total proyecta una BAJA NETA ese mes (curva de cierre de obra), se correlaciona con el costo promedio histórico por baja neta; si no hay baja neta ese mes o no hay histórico suficiente para calibrar, cae al promedio de los últimos 6 meses con Finiquito real (0 si todavía no hay 6 meses de historial).",
  },
  {
    concepto: "Reliquidación",
    fuenteReal:
      'Real cuando existe el archivo "Solicitud de Requerimiento reliquidación" ingerido para ese mes.',
    formula: "Si no hay dato real: 1% × Remuneración del mismo mes.",
  },
  {
    concepto: "Cotización",
    fuenteReal:
      'Real desde 2 fuentes: (1) el comprobante oficial de pago de Previred ("comprobante previred <Empresa> <RG|RP>.pdf", carpeta "Pagos Mensuales/imposiciones/imposiciones <mes> <año>") — se suma el TOTAL GENERAL ya calculado y confirmado por Previred de todos los comprobantes del mes, cruzado contra "TOTAL A PAGAR" del mismo documento (si no coinciden, se descarta ese comprobante en vez de arriesgar el monto); (2) el Excel maestro de Flujo de Caja para meses históricos que ya lo tenían. Nunca se parsea el archivo .txt crudo de Previred (~70-100 columnas por trabajador) — ese layout requeriría adivinar qué campos exactos sumar, riesgo real para un dato financiero.',
    formula:
      "Si no hay dato real de ninguna de las 2 fuentes: 30% × (Anticipo + Remuneración + Reliquidación) del mismo mes. Como Remuneración ya incluye Beneficios/Bonos de forma implícita, quedan incluidos en la base sin un 4to sumando.",
  },
  {
    concepto: "Aporte SENCE",
    fuenteReal:
      "SIEMPRE manual — es específico de cada período, no tiene fórmula automática. Se ingresa directamente en la celda de la tabla de detalle (click para editar); ese valor manual siempre tiene prioridad.",
    formula:
      'Si no hay dato real: pago anual de 500 UF, convertidas al valor de UF real del mes de pago (30 de junio todos los años; 2026 es la excepción, se retrasó a agosto). En el resto de los meses el valor es $0 — no queda "pendiente", es el monto correcto y final.',
  },
  {
    concepto: "Total Nómina",
    fuenteReal:
      "Suma de los 6 conceptos anteriores, cada uno con su propio origen (real, fórmula o manual).",
    formula: null,
  },
] as const;

/**
 * Qué hace que cada concepto SUBA o BAJE de un mes al siguiente — pedido
 * explícito del usuario (17-ago-2026): "incorpora una explicación
 * mostrando el detalle de cómo el modelo aumenta o disminuye los
 * conceptos mes a mes para que sea explicativo". Es la mecánica GENERAL
 * (aplica igual todos los meses), no un cálculo puntual de un mes
 * específico — complementa `CONCEPTOS_METODOLOGIA` (qué fórmula usa)
 * con el PORQUÉ del movimiento mes a mes.
 */
export const MOTOR_CAMBIO_MENSUAL = [
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
      "Sigue a Remuneración del mismo mes (24% de ella) — sube o baja en la MISMA dirección y proporción, nunca tiene un movimiento propio distinto. Es un adelanto de un % del sueldo de cada persona, no un costo fijo por cabeza (el N° que se muestra junto a Anticipo es informativo — gente real que efectivamente lo cobró — pero no es lo que determina el monto proyectado).",
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
      "Cuando hay comprobante Previred real, sube o baja con la dotación real pagada ese mes (más/menos gente cotizando). Sin dato real, la fórmula (30% de Anticipo+Remuneración+Reliquidación) sigue a Remuneración — que como componente más grande de esa suma, arrastra a Cotización en la misma dirección, misma causa raíz: la dotación.",
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
