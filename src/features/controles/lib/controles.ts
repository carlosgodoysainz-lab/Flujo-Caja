/**
 * Controles de cordura del reporte (29-sep-2026). Cada control es una
 * función PURA (sin base de datos) que recibe datos ya leídos y devuelve un
 * resultado — así se testean directo y se reutilizan tanto en el panel de
 * /reporte como en el pre-vuelo de "Actualizar reporte".
 *
 * Origen: el mismo día aparecieron 4 fallas silenciosas que el sistema no
 * detectó y encontró el usuario mirando los números (aguinaldo ignorado por
 * una columna no leída, personas de Anticipo duplicadas, Σ obras > total,
 * caída de dotación entre dos lecturas de Buk). Cada control de abajo habría
 * atrapado una de ellas.
 */

export type ControlId =
  | "anticipo_vs_dotacion"
  | "suma_obras"
  | "documentos_parciales"
  | "salto_aguinaldo"
  | "salto_buk"
  | "bono_enero_julio";

export type EstadoControl = "ok" | "alerta" | "sin_datos";

export interface ResultadoControl {
  id: ControlId;
  nombre: string;
  estado: EstadoControl;
  detalle: string;
}

export interface DatosControles {
  /** Personas con Anticipo por mes (conteo real de los archivos del banco). */
  beneficiarios: { periodo: string; anticipoRg: number; anticipoRp: number }[];
  /** Dotación total de la compañía por período (YYYY-MM-01). */
  dotacionPorPeriodo: Record<string, number>;
  /** Σ dotación proyectada de todas las obras por período (hoja Plan de Obra). */
  sumaObrasPorPeriodo: Record<string, number>;
  /** Documentos de Pagos Mensuales de los últimos meses. */
  documentos: { periodo: string; nombreArchivo: string; estado: string }[];
  /** Anticipo $ por mes (real ingerido; ordenado o no). */
  anticipoMensual: { periodo: string; monto: number; esReal: boolean }[];
  /** Las dos últimas lecturas de Buk (total de activos). */
  buk: {
    anterior: { fecha: string; total: number } | null;
    ultima: { fecha: string; total: number } | null;
  };
  /** Remuneración de los meses proyectados y el método con que se calculó. */
  remuneracionProyectada: {
    periodo: string;
    metodo: string | null;
    esReal: boolean;
  }[];
}

/** Aguinaldo: septiembre y diciembre deben subir el Anticipo al menos esto. */
export const UMBRAL_SALTO_AGUINALDO = 0.15;
/** Buk: cambio máximo aceptado entre dos lecturas cercanas. */
export const UMBRAL_CAMBIO_BUK = 0.05;
/** Buk: solo se comparan lecturas separadas por a lo más estos días. */
export const DIAS_MAX_ENTRE_LECTURAS_BUK = 14;

const nf = new Intl.NumberFormat("es-CL");
const fmt = (n: number) => nf.format(Math.round(n));
const mesDe = (periodo: string) => Number(periodo.slice(5, 7));
const etiqueta = (periodo: string) => periodo.slice(0, 7);

function periodoAnterior(periodo: string): string {
  const [y, m] = periodo.slice(0, 7).split("-").map(Number);
  const total = y * 12 + (m - 1) - 1;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}

function resultado(
  id: ControlId,
  nombre: string,
  problemas: string[],
  okDetalle: string,
): ResultadoControl {
  return problemas.length === 0
    ? { id, nombre, estado: "ok", detalle: okDetalle }
    : { id, nombre, estado: "alerta", detalle: problemas.join("; ") };
}

export function controlAnticipoVsDotacion(d: DatosControles): ResultadoControl {
  const nombre = "Personas con Anticipo ≤ dotación";
  const problemas: string[] = [];
  let evaluados = 0;
  for (const b of d.beneficiarios) {
    const dot = d.dotacionPorPeriodo[b.periodo];
    if (dot == null) continue;
    evaluados++;
    const personas = b.anticipoRg + b.anticipoRp;
    if (personas > dot) {
      problemas.push(
        `${etiqueta(b.periodo)}: ${fmt(personas)} personas con Anticipo vs ${fmt(dot)} de dotación`,
      );
    }
  }
  if (evaluados === 0) {
    return {
      id: "anticipo_vs_dotacion",
      nombre,
      estado: "sin_datos",
      detalle: "Sin meses con ambos datos.",
    };
  }
  return resultado(
    "anticipo_vs_dotacion",
    nombre,
    problemas,
    `${evaluados} mes(es) revisados, ninguno supera la dotación.`,
  );
}

export function controlSumaObras(d: DatosControles): ResultadoControl {
  const nombre = "Σ obras ≤ dotación total";
  const problemas: string[] = [];
  let evaluados = 0;
  for (const [periodo, suma] of Object.entries(d.sumaObrasPorPeriodo)) {
    const total = d.dotacionPorPeriodo[periodo];
    if (total == null) continue;
    evaluados++;
    if (suma > total) {
      problemas.push(
        `${etiqueta(periodo)}: obras suman ${fmt(suma)} vs ${fmt(total)} de la compañía`,
      );
    }
  }
  if (evaluados === 0) {
    return {
      id: "suma_obras",
      nombre,
      estado: "sin_datos",
      detalle: "Sin meses con ambos datos.",
    };
  }
  return resultado(
    "suma_obras",
    nombre,
    problemas.sort(),
    `${evaluados} mes(es) revisados, la suma por obra nunca supera el total.`,
  );
}

export function controlDocumentosParciales(
  d: DatosControles,
): ResultadoControl {
  const nombre = "Documentos leídos completos";
  const malos = d.documentos.filter((x) => x.estado !== "ok");
  if (malos.length === 0) {
    return {
      id: "documentos_parciales",
      nombre,
      estado: "ok",
      detalle: `${d.documentos.length} documento(s) recientes, todos leídos completos.`,
    };
  }
  const nombres = malos.slice(0, 3).map((x) => x.nombreArchivo);
  const resto = malos.length > 3 ? ` y ${malos.length - 3} más` : "";
  return {
    id: "documentos_parciales",
    nombre,
    estado: "alerta",
    detalle: `${malos.length} documento(s) con filas o columnas sin leer: ${nombres.join(", ")}${resto}`,
  };
}

export function controlSaltoAguinaldo(d: DatosControles): ResultadoControl {
  const nombre = "Aguinaldo visible en el Anticipo";
  const porPeriodo = new Map(d.anticipoMensual.map((a) => [a.periodo, a]));
  const problemas: string[] = [];
  let evaluados = 0;
  for (const a of d.anticipoMensual) {
    const mes = mesDe(a.periodo);
    if ((mes !== 9 && mes !== 12) || !a.esReal) continue;
    const previo = porPeriodo.get(periodoAnterior(a.periodo));
    if (!previo || !previo.esReal || previo.monto <= 0) continue;
    evaluados++;
    const salto = a.monto / previo.monto - 1;
    if (salto < UMBRAL_SALTO_AGUINALDO) {
      problemas.push(
        `${etiqueta(a.periodo)}: el Anticipo subió ${(salto * 100).toFixed(0)}% sobre el mes anterior (esperado ≥ ${UMBRAL_SALTO_AGUINALDO * 100}%) — revisa que se esté leyendo la columna Aguinaldo`,
      );
    }
  }
  if (evaluados === 0) {
    return {
      id: "salto_aguinaldo",
      nombre,
      estado: "sin_datos",
      detalle: "Sin septiembre/diciembre reales para comparar.",
    };
  }
  return resultado(
    "salto_aguinaldo",
    nombre,
    problemas.sort(),
    `${evaluados} mes(es) con aguinaldo revisados, todos muestran el salto esperado.`,
  );
}

function diasEntre(a: string, b: string): number {
  return (
    Math.abs(Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) /
    86_400_000
  );
}

export function controlSaltoBuk(d: DatosControles): ResultadoControl {
  const nombre = "Lectura de Buk estable";
  const { anterior, ultima } = d.buk;
  if (!anterior || !ultima || anterior.total <= 0) {
    return {
      id: "salto_buk",
      nombre,
      estado: "sin_datos",
      detalle: "Hay menos de dos lecturas de Buk.",
    };
  }
  const dias = diasEntre(anterior.fecha, ultima.fecha);
  if (dias > DIAS_MAX_ENTRE_LECTURAS_BUK) {
    return {
      id: "salto_buk",
      nombre,
      estado: "sin_datos",
      detalle: `Las dos últimas lecturas están separadas por ${Math.round(dias)} días; no son comparables.`,
    };
  }
  const cambio = ultima.total / anterior.total - 1;
  if (Math.abs(cambio) > UMBRAL_CAMBIO_BUK) {
    return {
      id: "salto_buk",
      nombre,
      estado: "alerta",
      detalle: `Dotación de Buk pasó de ${fmt(anterior.total)} (${anterior.fecha}) a ${fmt(ultima.total)} (${ultima.fecha}): ${(cambio * 100).toFixed(1)}% en ${Math.round(dias)} día(s)`,
    };
  }
  return {
    id: "salto_buk",
    nombre,
    estado: "ok",
    detalle: `${fmt(anterior.total)} → ${fmt(ultima.total)} (${(cambio * 100).toFixed(1)}%) entre ${anterior.fecha} y ${ultima.fecha}.`,
  };
}

export function controlBonoEneroJulio(d: DatosControles): ResultadoControl {
  const nombre = "Bono de enero y julio en la proyección";
  const problemas: string[] = [];
  let evaluados = 0;
  for (const r of d.remuneracionProyectada) {
    const mes = mesDe(r.periodo);
    if (r.esReal || (mes !== 1 && mes !== 7)) continue;
    evaluados++;
    if (!(r.metodo ?? "").includes("eventos")) {
      problemas.push(
        `${etiqueta(r.periodo)}: la Remuneración proyectada no incluye el bono (falta el evento en el Plan de Dotación)`,
      );
    }
  }
  if (evaluados === 0) {
    return {
      id: "bono_enero_julio",
      nombre,
      estado: "sin_datos",
      detalle: "No hay enero ni julio proyectados en el rango.",
    };
  }
  return resultado(
    "bono_enero_julio",
    nombre,
    problemas.sort(),
    `${evaluados} mes(es) de bono proyectados con su evento cargado.`,
  );
}

/** Corre los 6 controles, siempre en este orden. */
export function evaluarControles(d: DatosControles): ResultadoControl[] {
  return [
    controlAnticipoVsDotacion(d),
    controlSumaObras(d),
    controlDocumentosParciales(d),
    controlSaltoAguinaldo(d),
    controlSaltoBuk(d),
    controlBonoEneroJulio(d),
  ];
}
