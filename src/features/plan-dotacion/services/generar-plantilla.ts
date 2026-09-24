import ExcelJS from "exceljs";

/**
 * Genera la plantilla "Plan Dotación Obras.xlsx" que el usuario descarga
 * desde /dotación, completa y sube a SharePoint (carpeta "Flujo de
 * Caja/Plan Dotación") — ver `sync-plan-dotacion.ts`.
 *
 * SIEMPRE crea un libro NUEVO — nunca re-graba uno existente. Aviso real
 * documentado el 27-ago-2026: volver a grabar un .xlsx ya existente con
 * ExcelJS rompe los vínculos externos y las fórmulas compartidas del
 * archivo original.
 */

const FUENTE = "Calibri";
const FILL_HEADER: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF0A1F3C" },
};
const FILL_INFO: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFF1F5F9" },
};

const MESES_CORTOS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
] as const;

function etiquetaPeriodoCorta(periodo: string): string {
  const [anio, mes] = periodo.slice(0, 7).split("-").map(Number);
  return `${MESES_CORTOS[mes - 1]}-${String(anio).slice(2)}`;
}

export interface ObraParaPlantilla {
  id: string;
  nombre: string;
  inicioObra: string | null;
  finObra: string | null;
}

export interface EventoExistentePlantilla {
  periodo: string;
  concepto: "remuneracion" | "anticipo";
  modo: "monto_total" | "por_persona";
  monto: number;
  moneda: "clp" | "uf";
  obraNombre: string | null;
  poblacion: "rg" | "rp" | null;
  descripcion: string | null;
}

export async function generarPlantillaPlanDotacion(params: {
  obras: ObraParaPlantilla[];
  /** clave `${obraId ?? "oficina_central"}::${periodo}` → variación neta ya cargada. */
  planExistentePorClave: Map<string, number>;
  eventosExistentes: EventoExistentePlantilla[];
  /** obraId → última dotación real conocida (Buk) — informativa, no editable. */
  dotacionRealPorObra: Map<string, number>;
  /** Períodos a incluir como columnas, en orden — YYYY-MM-01. */
  periodos: string[];
  generadoEn: Date;
}): Promise<Buffer> {
  const {
    obras,
    planExistentePorClave,
    eventosExistentes,
    dotacionRealPorObra,
    periodos,
    generadoEn,
  } = params;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Flujo de Caja Nómina — Grupo Maestra";
  workbook.created = generadoEn;

  // --- Hoja "Instrucciones" ---
  const instrucciones = workbook.addWorksheet("Instrucciones");
  instrucciones.addRow(["Plan de Dotación — Instrucciones"]).font = {
    name: FUENTE,
    bold: true,
    size: 14,
  };
  instrucciones.addRow([]);
  const lineas = [
    'Completa la hoja "Plan": una fila por obra, una columna por mes. El valor es la VARIACIÓN NETA de ese mes (altas − bajas), NO la dotación total.',
    "Deja la celda VACÍA si no tienes plan para esa obra/mes — el sistema mantiene la dotación plana (última real), no inventa un 0.",
    'Las columnas "Fecha Inicio Obra" y "Dotación real (Buk, hoy)" son solo informativas — no las edites, no participan en ningún cálculo.',
    'La fila "Oficina Central" es para la dotación fuera de obra (bodega, taller central, administración).',
    'Completa la hoja "Eventos" para extraordinarios: bono de término de obra, montos puntuales que no siguen la fórmula normal. "Modo" = "monto_total" (un monto fijo ese mes) o "por_persona" (el monto se multiplica por la dotación proyectada de la obra/población).',
    '"Moneda" = "CLP" (pesos, por defecto si la dejas vacía) o "UF": un monto en UF se convierte a pesos con la UF del mes de pago (real, o proyectada desde la última UF real). Úsala para pagos que se reajustan en UF, como el bono rol general de enero y julio.',
    "Guarda el archivo y súbelo a la carpeta de SharePoint 'Flujo de Caja/Plan Dotación' (reemplaza el anterior). El sistema siempre toma el archivo más reciente de esa carpeta, sin importar el nombre exacto.",
    'Al correr "Actualizar reporte" el sistema vuelve a leer este archivo completo — lo que borres acá se borra también en el sistema.',
  ];
  for (const linea of lineas) {
    const row = instrucciones.addRow([`• ${linea}`]);
    row.font = { name: FUENTE };
    row.alignment = { wrapText: true, vertical: "top" };
  }
  instrucciones.getColumn(1).width = 110;

  // --- Hoja "Plan" ---
  const planSheet = workbook.addWorksheet("Plan");
  const headerRow = [
    "Obra ID",
    "Obra",
    "Fecha Inicio Obra",
    "Dotación real (Buk, hoy)",
    ...periodos.map(etiquetaPeriodoCorta),
  ];
  const header = planSheet.addRow(headerRow);
  header.eachCell((cell) => {
    cell.font = { name: FUENTE, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = FILL_HEADER;
  });
  planSheet.getColumn(1).hidden = true;

  /** true si la obra ya tiene alguna variación cargada en el plan, en cualquier mes. */
  function tienePlanCargado(obraId: string): boolean {
    return periodos.some((p) => planExistentePorClave.has(`${obraId}::${p}`));
  }

  // Orden top-down — pedido explícito del usuario 24-sep-2026:
  // 1° las obras con dotación real HOY (Buk), de mayor a menor;
  // 2° entre las que no tienen dotación real hoy, primero las que SÍ
  //    tendrán dotación en el futuro (ya tienen alguna variación cargada
  //    en el plan), ordenadas por fecha de inicio más próxima;
  // 3° el resto (sin dato real ni plan), también por fecha de inicio.
  const obrasVigentes = obras
    .filter((o) => !o.finObra || o.finObra >= generadoEn.toISOString().slice(0, 10))
    .sort((a, b) => {
      const da = dotacionRealPorObra.get(a.id);
      const db = dotacionRealPorObra.get(b.id);
      if (da != null || db != null) {
        if (da == null) return 1;
        if (db == null) return -1;
        return db - da;
      }
      const pa = tienePlanCargado(a.id);
      const pb = tienePlanCargado(b.id);
      if (pa !== pb) return pa ? -1 : 1;
      if (a.inicioObra == null && b.inicioObra == null) return 0;
      if (a.inicioObra == null) return 1;
      if (b.inicioObra == null) return -1;
      return a.inicioObra < b.inicioObra ? -1 : a.inicioObra > b.inicioObra ? 1 : 0;
    });

  for (const obra of obrasVigentes) {
    const fila: (string | number)[] = [
      obra.id,
      obra.nombre,
      obra.inicioObra ?? "",
      dotacionRealPorObra.get(obra.id) ?? "",
    ];
    for (const periodo of periodos) {
      const valor = planExistentePorClave.get(`${obra.id}::${periodo}`);
      fila.push(valor ?? "");
    }
    const row = planSheet.addRow(fila);
    row.getCell(3).fill = FILL_INFO;
    row.getCell(4).fill = FILL_INFO;
    row.font = { name: FUENTE };
  }

  // Fila Oficina Central — obraId vacío (columna oculta), identificada
  // por nombre exacto (ver `parse-plan-dotacion.ts`, FILA_OFICINA_CENTRAL).
  {
    const fila: (string | number)[] = ["", "Oficina Central", "", ""];
    for (const periodo of periodos) {
      const valor = planExistentePorClave.get(`::${periodo}`);
      fila.push(valor ?? "");
    }
    const row = planSheet.addRow(fila);
    row.font = { name: FUENTE, italic: true };
  }

  planSheet.getColumn(2).width = 28;
  planSheet.getColumn(3).width = 16;
  planSheet.getColumn(4).width = 20;
  for (let i = 5; i <= headerRow.length; i++) {
    planSheet.getColumn(i).width = 10;
  }

  // --- Hoja "Eventos" ---
  const eventosSheet = workbook.addWorksheet("Eventos");
  const headerEventos = eventosSheet.addRow([
    "Mes",
    "Concepto",
    "Modo",
    "Monto",
    "Moneda",
    "Obra",
    "Población",
    "Descripción",
  ]);
  headerEventos.eachCell((cell) => {
    cell.font = { name: FUENTE, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = FILL_HEADER;
  });
  for (const evento of eventosExistentes) {
    const row = eventosSheet.addRow([
      etiquetaPeriodoCorta(evento.periodo),
      evento.concepto,
      evento.modo,
      evento.monto,
      evento.moneda.toUpperCase(),
      evento.obraNombre ?? "",
      evento.poblacion ?? "",
      evento.descripcion ?? "",
    ]);
    row.font = { name: FUENTE };
    row.getCell(4).numFmt = evento.moneda === "uf" ? "#,##0.00" : "#,##0";
  }
  // Fila de ejemplo si no hay ningún evento cargado todavía — para que el
  // usuario vea el formato esperado sin adivinar.
  if (eventosExistentes.length === 0) {
    const ejemplo = eventosSheet.addRow([
      "abr-27",
      "remuneracion",
      "monto_total",
      80_000_000,
      "CLP",
      "Nombre de la obra (o vacío si aplica a toda la compañía)",
      "",
      "Ejemplo: bono de término de negociación — BORRA esta fila antes de subir",
    ]);
    ejemplo.font = { name: FUENTE, italic: true, color: { argb: "FF94A3B8" } };
  }
  eventosSheet.getColumn(1).width = 10;
  eventosSheet.getColumn(2).width = 14;
  eventosSheet.getColumn(3).width = 14;
  eventosSheet.getColumn(4).width = 16;
  eventosSheet.getColumn(5).width = 10;
  eventosSheet.getColumn(6).width = 30;
  eventosSheet.getColumn(7).width = 12;
  eventosSheet.getColumn(8).width = 40;

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
