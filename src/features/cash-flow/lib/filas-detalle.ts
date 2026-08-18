/**
 * Filas de la tabla de detalle del flujo de caja — compartida entre las
 * 3 vistas que la renderizan (la app en vivo, el HTML descargable y el
 * Excel descargable) para que agregar/quitar un concepto quede
 * sincronizado por construcción en los 3 lugares, en vez de mantener 3
 * copias idénticas a mano (bug real evitado: antes cada archivo tenía su
 * propio `FILAS`, fácil de olvidar actualizar en alguno de los 3).
 *
 * Cada fila principal puede traer sub-filas RG/RP (aperturadas — mismo
 * desglose que el Excel real, pedido explícito del usuario) indentadas
 * justo debajo, de menor jerarquía visual.
 */
export interface FilaDetalle {
  concepto: string;
  label: string;
  sub?: {
    concepto: string;
    label: string;
    /**
     * Si esta sub-fila lleva columna "N°" (dotación) al lado del monto —
     * mismo formato del Excel real de Finanzas, pedido explícito del
     * usuario 17-ago-2026 ("mantén ese formato para ver cómo va
     * cambiando el input principal que corresponde a dotación"). Solo
     * Anticipo/Remuneración RG-RP la llevan — Finiquito, Reliquidación,
     * Cotización, SENCE y Total Nómina quedan sin columna N° (igual que
     * en el Excel original, esa columna queda vacía para esas filas).
     *
     * El N° de CADA sub-fila es específico de su propio concepto (ver
     * `getDotacionPorConceptoYPeriodo` en dotacion-total.ts) — bug real
     * corregido 17-ago-2026: antes se reutilizaba la misma dotación
     * total RG/RP para las 4 sub-filas, mostrando el mismo N° en
     * Anticipo que en Remuneración, pese a que mucha menos gente pide
     * Anticipo que la que recibe Remuneración completa.
     */
    tieneColumnaN?: boolean;
  }[];
}

export const FILAS_DETALLE: FilaDetalle[] = [
  {
    concepto: "anticipo",
    label: "Anticipo",
    sub: [
      { concepto: "anticipo_rg", label: "RG", tieneColumnaN: true },
      { concepto: "anticipo_rp", label: "RP", tieneColumnaN: true },
    ],
  },
  {
    concepto: "remuneracion",
    label: "Remuneración",
    sub: [
      { concepto: "remuneracion_rg", label: "RG", tieneColumnaN: true },
      { concepto: "remuneracion_rp", label: "RP", tieneColumnaN: true },
    ],
  },
  { concepto: "finiquito", label: "Finiquito" },
  { concepto: "reliquidacion", label: "Reliquidación" },
  { concepto: "cotizacion", label: "Cotización" },
  { concepto: "sence", label: "Aporte SENCE" },
  { concepto: "total_nomina", label: "Total Nómina" },
];
