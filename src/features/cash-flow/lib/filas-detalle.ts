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
  sub?: { concepto: string; label: string }[];
}

export const FILAS_DETALLE: FilaDetalle[] = [
  {
    concepto: "anticipo",
    label: "Anticipo",
    sub: [
      { concepto: "anticipo_rg", label: "RG" },
      { concepto: "anticipo_rp", label: "RP" },
    ],
  },
  {
    concepto: "remuneracion",
    label: "Remuneración",
    sub: [
      { concepto: "remuneracion_rg", label: "RG" },
      { concepto: "remuneracion_rp", label: "RP" },
    ],
  },
  { concepto: "finiquito", label: "Finiquito" },
  { concepto: "reliquidacion", label: "Reliquidación" },
  {
    concepto: "beneficios",
    label: "Beneficios / Bonos",
    sub: [
      { concepto: "beneficios_rg", label: "RG (Convenio Lira Parque)" },
      { concepto: "beneficios_rp", label: "RP (Anexo Oficina Central)" },
    ],
  },
  { concepto: "cotizacion", label: "Cotización" },
  { concepto: "sence", label: "Aporte SENCE" },
  { concepto: "total_nomina", label: "Total Nómina" },
];
