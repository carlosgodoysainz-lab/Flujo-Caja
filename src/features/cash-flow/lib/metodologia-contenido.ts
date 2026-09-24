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
    concepto: "Dotación (N°)",
    fuenteReal:
      'Real desde Buk (snapshot mensual, "buk_dotacion_snapshots") o desde la columna "N°" del Excel maestro de Flujo de Caja ("dotacion_mensual") cuando el mes ya está cerrado — lo que exista, gana siempre sobre cualquier proyección.',
    formula:
      'Si no hay dato real: se parte del último real conocido de la obra y se suma, mes a mes, la variación neta (altas−bajas) que el usuario carga en su propio "Plan de Dotación" (Fase 2, 24-sep-2026) — un archivo Excel que mantiene en SharePoint ("Flujo de Caja/Plan Dotación/Plan Dotación Obras.xlsx", hoja "Plan"), obra por obra y mes a mes. Reemplaza un modelo estadístico anterior ("curva de obras similares") que llevó 7 versiones de ajustes sin corregir la causa real: proyectaba con la escala de OTRAS obras en vez del plan real de esta compañía. Una obra o mes sin ninguna fila cargada en el Plan de Dotación se mantiene con dotación plana (el último real, sin inventar una curva) y se marca "sin plan" en /dotación. Una obra sin ningún dato real de Buk en 3+ meses consecutivos, y sin plan cargado, se muestra como alerta en /dotación (posible obra cerrada sin plan de cierre) en vez de seguir proyectando desde un dato viejo.',
  },
  {
    concepto: "Anticipo (RG/RP)",
    fuenteReal:
      'Real desde 2 fuentes, en orden de prioridad: (1) el Excel MAESTRO de Flujo de Caja (carpeta "Flujo de Caja", Finanzas) para meses ya cerrados — la más completa históricamente; (2) "solicitud requerimientos anticipo <mes> <año>.xlsx" ingerido de SharePoint para meses recientes que el Excel maestro todavía no cierra. Ambas ya traen RG/RP separado, sin RUT ni nombre de persona.',
    formula:
      "Si no hay dato real: % × Remuneración del mismo mes (total) + los aguinaldos del mes (ver más abajo). Ese % se AUTO-APRENDE en cada 'Actualizar reporte': se recalcula como el promedio real de (Anticipo − aguinaldo del mes)÷Remuneración de los últimos 6 meses REALES de AMBOS conceptos (empieza en 24%, la misma fórmula del Excel maestro de Finanzas, y se ajusta solo si el real promedia otro valor — sin editar código; el aguinaldo se descuenta para que septiembre/diciembre no infle el % aprendido). El desglose RG/RP proyectado ancla RP en el promedio de los últimos 3 meses reales + su aguinaldo (RP es un grupo chico y estable de gente que pide Anticipo, no escala con toda la planilla RP — bug real corregido 20-ago-2026, antes RP salía como residual y se inflaba junto con Remuneración) y RG absorbe el residual (Total − RP). Se evaluó un modelo costo-por-cabeza con dotación propia de Anticipo (18-ago-2026) y se revirtió el mismo día: el Anticipo es por naturaleza un adelanto de un % del sueldo de cada persona, no un costo fijo por cabeza.\n\nLos aguinaldos (Fiestas Patrias en septiembre, Navidad en diciembre) se pagan CON el Anticipo, no con la Remuneración de fin de mes (aclaración explícita del usuario, 24-sep-2026: \"los aguinaldos se pagan con los anticipos, así funciona en la realidad\") — $50.000/persona RG + $150.000/persona RP cada uno, según la dotación del mes.",
  },
  {
    concepto: "Remuneración (RG/RP)",
    fuenteReal:
      'Real desde las mismas 2 fuentes que Anticipo: el Excel maestro (histórico, ya separa RG/RP con su dotación real en la columna "N°") o el archivo "Solicitud de Requerimiento remuneración" de SharePoint para meses recientes.',
    formula:
      'Si no hay dato real: costo promedio por cabeza × dotación del mes actual — el total. El costo por cabeza es el promedio de los últimos 3 meses REALES de (Remuneración SIN Beneficios ÷ dotación real de ese mismo mes), fijo hacia adelante — no se encadena mes a mes (fix real 24-sep-2026: antes se usaba el costo del mes inmediatamente anterior, y como ese monto ya incluía beneficios del mes, un aguinaldo de septiembre quedaba incrustado en el costo por cabeza y se arrastraba para siempre a todos los meses siguientes). El desglose RG/RP proyectado usa la razón real RG/(RG+RP) promedio de los últimos 3 meses reales. La dotación es real (Buk) o proyectada acumulando altas−bajas por obra (ver /dotacion). Si tampoco hay dato de dotación: promedio de los últimos 3 meses reales. Incluye de forma IMPLÍCITA los Beneficios pagados CON LA REMUNERACIÓN del Convenio Colectivo Lira Parque (RG) y del Anexo Beneficio Oficina Central (RP) — aporte sindical, gift cards, bonos de promedio 6 meses, etc. (ver beneficios.ts) — no aparecen como fila aparte, quedan sumados dentro de este monto. Los aguinaldos NO van acá — se pagan con el Anticipo (ver arriba).\n\nEventos del Plan de Dotación (hoja "Eventos" del archivo en SharePoint): bono rol general de enero y julio, bonos de término de obra y otros extraordinarios se suman a la Remuneración proyectada de su mes. Si el evento está en UF (el bono rol general, 1.713,8 UF por pago = $70M a la UF de ago-26), se convierte a pesos con la UF del mes de pago (real, o proyectada desde la última UF real al 0,5% mensual). Estos eventos pagan Reliquidación y Cotización, pero NO entran a la base del Anticipo (mismo criterio del Excel tradicional: Remuneración × 24% − bono × 24%). Enero y julio quedan fuera del promedio de 3 meses del costo por cabeza, porque la Remuneración real de esos meses ya trae el bono rol general adentro.',
  },
  {
    concepto: "Finiquito",
    fuenteReal:
      'Real cuando existe dato ingerido (incluye cuotas de finiquito que vienen dentro de los mismos archivos de remuneración, ej. "Finiquito RP cuota 4/5").',
    formula:
      "Si no hay dato real: promedio de los últimos 6 meses con Finiquito real (0 si todavía no hay 6 meses de historial). Se evaluó un modelo correlacionado con bajas netas de dotación (13-ago-2026, curva de cierre de obra) y se simplificó de vuelta a este promedio (21-ago-2026, pedido explícito del usuario).",
  },
  {
    concepto: "Reliquidación",
    fuenteReal:
      'Real cuando existe el archivo "Solicitud de Requerimiento reliquidación" ingerido para ese mes.',
    formula:
      "Si no hay dato real: 1% fijo × Remuneración del mismo mes (decisión explícita del usuario, 24-sep-2026, revierte el auto-aprendizaje: el % aprendido arrastraba una reliquidación puntual grande de un mes atípico en vez de reflejar el 1% habitual).",
  },
  {
    concepto: "Cotización",
    fuenteReal:
      'Real desde 2 fuentes: (1) el comprobante oficial de pago de Previred ("comprobante previred <Empresa> <RG|RP>.pdf", carpeta "Pagos Mensuales/imposiciones/imposiciones <mes> <año>") — se suma el TOTAL GENERAL ya calculado y confirmado por Previred de todos los comprobantes del mes, cruzado contra "TOTAL A PAGAR" del mismo documento (si no coinciden, se descarta ese comprobante en vez de arriesgar el monto); (2) el Excel maestro de Flujo de Caja para meses históricos que ya lo tenían. Nunca se parsea el archivo .txt crudo de Previred (~70-100 columnas por trabajador) — ese layout requeriría adivinar qué campos exactos sumar, riesgo real para un dato financiero.',
    formula:
      "Si no hay dato real de ninguna de las 2 fuentes: 30% fijo × (Anticipo + Remuneración + Reliquidación) del mismo mes (decisión explícita del usuario, 21-sep-2026: la reforma previsional — Ley N° 21.735 — agrega una cotización adicional del empleador en rampa legislada, 1% desde ago-2025 hasta 8,5% en régimen, que un promedio de meses reales nunca puede anticipar porque mira hacia atrás). Como Remuneración ya incluye Beneficios/Bonos de forma implícita, quedan incluidos en la base sin un 4to sumando.",
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
      "El motor de TODO lo demás. En meses reales, sube o baja según lo que Buk reporte. En meses proyectados, sigue el Plan de Dotación que el usuario carga en SharePoint (obra por obra) — no un modelo automático. Un salto grande de un mes a otro viene de que el usuario planificó el arranque/cierre de una obra ese mes, no de un cálculo interno.",
  },
  {
    concepto: "Remuneración",
    explicacion:
      "Sube o baja principalmente porque cambia la DOTACIÓN, no el costo por persona (que se mantiene FIJO — promedio de los últimos 3 meses reales, sin beneficios): Remuneración ≈ costo base por cabeza × dotación del mes actual + Beneficios pagados con Remuneración del propio mes (aporte sindical, gift cards). Si la dotación crece 5%, Remuneración proyectada crece ≈5% en el mismo sentido. Los aguinaldos de septiembre/diciembre NO están acá — se pagan con el Anticipo. En enero y julio sube además por el bono rol general (reajustado en UF), y vuelve a su nivel el mes siguiente.",
  },
  {
    concepto: "Anticipo",
    explicacion:
      "Sigue a Remuneración del mismo mes (un % de ella, auto-aprendido de los últimos meses reales — empieza en 24%) — sube o baja en la MISMA dirección y proporción. Además, en septiembre y diciembre da un salto propio y puntual: el aguinaldo (Fiestas Patrias/Navidad) se paga con el Anticipo, no con la Remuneración de fin de mes — por eso el Anticipo de esos meses sube más de lo que sube Remuneración, y vuelve a la normalidad el mes siguiente. Es un adelanto de un % del sueldo de cada persona, no un costo fijo por cabeza (el N° que se muestra junto a Anticipo es informativo — gente real que efectivamente lo cobró — pero no es lo que determina el monto proyectado).",
  },
  {
    concepto: "Reliquidación",
    explicacion:
      "Sigue a Remuneración (1% fijo de ella) — mismo sentido, sin dinámica propia.",
  },
  {
    concepto: "Finiquito",
    explicacion:
      "Es la excepción — no sigue a Remuneración ni a la dotación: se mantiene estable en torno al promedio de los últimos 6 meses reales, sin importar si ese mes hay alta o baja neta de dotación.",
  },
  {
    concepto: "Cotización",
    explicacion:
      "Cuando hay comprobante Previred real, sube o baja con la dotación real pagada ese mes (más/menos gente cotizando). Sin dato real, la fórmula (30% fijo de Anticipo+Remuneración+Reliquidación) sigue a Remuneración — que como componente más grande de esa suma, arrastra a Cotización en la misma dirección, misma causa raíz: la dotación.",
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
