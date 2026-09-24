/**
 * Carga inicial del Plan de Dotación (una sola vez — Fase 2/3, 24-sep-2026).
 *
 * Lee la hoja "Headcount Plan de Obra" del Excel tradicional del usuario
 * (SOLO LECTURA — nunca se re-graba, ver aviso del 27-ago-2026 sobre
 * vínculos rotos) y genera un "Plan Dotación Obras.xlsx" NUEVO con el
 * mismo generador de plantilla que usa /dotacion. Después lo valida con el
 * mismo parser que usa el sync desde SharePoint.
 *
 * Uso:
 *   npx tsx --env-file=.env.local scripts/migrar-plan-desde-excel-maestro.ts <maestro.xlsx> <salida.xlsx>
 */
import { readFileSync, writeFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";
import { matchObraByName } from "../src/shared/lib/match-obra";
import {
  generarPlantillaPlanDotacion,
  type EventoExistentePlantilla,
} from "../src/features/plan-dotacion/services/generar-plantilla";
import { parsePlanDotacion } from "../src/features/plan-dotacion/services/parse-plan-dotacion";

const HOJA_MAESTRO = "Headcount Plan de Obra";
const MESES_LARGOS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
/**
 * Bono rol general: +70M digitados a mano en la Remuneración de ene y jul
 * del Excel tradicional (celdas CY8 y DK8). Se reajusta en UF (aclaración
 * del usuario, 24-sep-2026): los 70M se pasan a UF con la UF del 1° del
 * mes del Excel (ago-26), y el refresh los vuelve a pesos con la UF del
 * mes de pago.
 */
const BONO_ROL_GENERAL_CLP = 70_000_000;
const BONO_ROL_GENERAL_FECHA_UF = "2026-08-01";

/** Primer mes del plan: los anteriores ya son reales (Buk manda). */
const PRIMER_PERIODO = "2026-09-01";
const MESES_PLANTILLA = 15;

function valorCelda(v: ExcelJS.CellValue): unknown {
  if (v && typeof v === "object" && "result" in v) return v.result;
  return v;
}

function sumarMeses(periodo: string, n: number): string {
  const [a, m] = periodo.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

async function main() {
  const [rutaMaestro, rutaSalida] = process.argv.slice(2);
  if (!rutaMaestro || !rutaSalida) {
    throw new Error("Uso: migrar-plan-desde-excel-maestro.ts <maestro.xlsx> <salida.xlsx>");
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data: obras, error } = await supabase
    .from("obras")
    .select("id, nombre, fin_obra")
    .order("nombre");
  if (error || !obras) throw new Error(`No se pudo leer obras: ${error?.message}`);

  // Dotación real más reciente por obra (informativa en la plantilla) —
  // misma regla que `getSaldoInicialPorObra`, paginado con `.range()`.
  const snapshots: { obra_id: string; snapshot_date: string; activos: number }[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data: pagina } = await supabase
      .from("buk_dotacion_snapshots")
      .select("obra_id, snapshot_date, activos")
      .not("obra_id", "is", null)
      .range(desde, desde + 999);
    if (!pagina || pagina.length === 0) break;
    snapshots.push(...(pagina as typeof snapshots));
    if (pagina.length < 1000) break;
  }
  const maxFecha = new Map<string, string>();
  for (const s of snapshots)
    if (s.snapshot_date > (maxFecha.get(s.obra_id) ?? "")) maxFecha.set(s.obra_id, s.snapshot_date);
  const dotacionRealPorObra = new Map<string, number>();
  for (const s of snapshots)
    if (s.snapshot_date === maxFecha.get(s.obra_id))
      dotacionRealPorObra.set(s.obra_id, (dotacionRealPorObra.get(s.obra_id) ?? 0) + s.activos);

  // --- Lectura del maestro ---
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(readFileSync(rutaMaestro) as unknown as ExcelJS.Buffer);
  const hoja = wb.getWorksheet(HOJA_MAESTRO);
  if (!hoja) throw new Error(`Hoja "${HOJA_MAESTRO}" no encontrada en el maestro.`);

  let filaHeader = 0;
  hoja.eachRow((row, n) => {
    if (!filaHeader && String(valorCelda(row.getCell(1).value) ?? "").trim() === "Proyecto")
      filaHeader = n;
  });
  if (!filaHeader) throw new Error('No se encontró el encabezado "Proyecto".');
  const header = hoja.getRow(filaHeader);
  const filaAnios = hoja.getRow(filaHeader - 1);

  const colPorNombre = new Map<string, number>();
  const periodoPorCol = new Map<number, string>();
  // Algunas columnas de mes no traen año en la fila de arriba (ej. el
  // último "Agosto"): se hereda del mes anterior y sube 1 si el mes vuelve
  // a empezar.
  let anioPrevio = 0;
  let mesPrevio = -1;
  header.eachCell((cell, col) => {
    const texto = String(valorCelda(cell.value) ?? "").trim().toLowerCase();
    colPorNombre.set(texto, col);
    const mes = MESES_LARGOS.indexOf(texto);
    if (mes < 0) return;
    let anio = Number(valorCelda(filaAnios.getCell(col).value));
    if (!(anio > 2000)) anio = mes <= mesPrevio ? anioPrevio + 1 : anioPrevio;
    if (anio > 2000)
      periodoPorCol.set(col, `${anio}-${String(mes + 1).padStart(2, "0")}-01`);
    anioPrevio = anio;
    mesPrevio = mes;
  });

  const periodos = Array.from({ length: MESES_PLANTILLA }, (_, i) => sumarMeses(PRIMER_PERIODO, i));
  const planExistentePorClave = new Map<string, number>();
  const eventos: EventoExistentePlantilla[] = [];
  const sinMatch: string[] = [];
  const colPagoBono = colPorNombre.get("pago bono");
  const colMontoBono = colPorNombre.get("$ bono");

  for (let r = filaHeader + 1; r <= hoja.rowCount; r++) {
    const row = hoja.getRow(r);
    const nombre = String(valorCelda(row.getCell(1).value) ?? "").trim();
    if (!nombre || nombre.toLowerCase() === "total") continue;

    const esOficina = nombre.toLowerCase().startsWith("oficina central");
    const obra = esOficina ? null : matchObraByName(nombre, obras);
    if (!esOficina && !obra) {
      sinMatch.push(nombre);
      continue;
    }
    const prefijo = esOficina ? "" : obra!.id;

    for (const [col, periodo] of periodoPorCol) {
      if (periodo < PRIMER_PERIODO) continue;
      const v = valorCelda(row.getCell(col).value);
      if (typeof v !== "number") continue; // vacío = sin plan, nunca 0
      const clave = `${prefijo}::${periodo}`;
      // Las 2 filas de Oficina Central del maestro se suman en una.
      planExistentePorClave.set(clave, (planExistentePorClave.get(clave) ?? 0) + v);
    }

    if (obra && colPagoBono && colMontoBono) {
      const monto = valorCelda(row.getCell(colMontoBono).value);
      const pagoValor = valorCelda(row.getCell(colPagoBono).value);
      const pago =
        pagoValor instanceof Date
          ? pagoValor.toISOString().slice(0, 7)
          : String(pagoValor ?? "");
      if (typeof monto === "number" && monto > 0 && /^\d{4}-\d{2}$/.test(pago)) {
        eventos.push({
          periodo: `${pago}-01`,
          concepto: "remuneracion",
          modo: "monto_total",
          monto,
          moneda: "clp",
          obraNombre: obra.nombre,
          poblacion: null,
          descripcion: "Bono de término de obra (desde Excel tradicional)",
        });
      }
    }
  }

  const { data: ufRef } = await supabase
    .from("uf_series")
    .select("valor_uf")
    .eq("fecha", BONO_ROL_GENERAL_FECHA_UF)
    .single();
  if (!ufRef) throw new Error(`Sin UF para ${BONO_ROL_GENERAL_FECHA_UF}.`);
  const bonoRolGeneralUf =
    Math.round((BONO_ROL_GENERAL_CLP / Number(ufRef.valor_uf)) * 100) / 100;
  for (const periodo of periodos) {
    const mes = Number(periodo.slice(5, 7));
    if (mes !== 1 && mes !== 7) continue;
    eventos.push({
      periodo,
      concepto: "remuneracion",
      modo: "monto_total",
      monto: bonoRolGeneralUf,
      moneda: "uf",
      obraNombre: null,
      poblacion: "rg",
      descripcion: `Bono rol general (70.000.000 a UF ${BONO_ROL_GENERAL_FECHA_UF.slice(0, 7)}, se reajusta con la UF del mes de pago)`,
    });
  }
  console.log(`Bono rol general: ${bonoRolGeneralUf} UF (UF ${ufRef.valor_uf} al ${BONO_ROL_GENERAL_FECHA_UF})`);

  const hoyStr = new Date().toISOString().slice(0, 10);
  const obrasPlantilla = obras.map((o) => ({
    id: o.id as string,
    nombre: o.nombre as string,
    finObra: o.fin_obra as string | null,
  }));
  const vencidasConPlan = obrasPlantilla.filter(
    (o) =>
      o.finObra && o.finObra < hoyStr &&
      [...planExistentePorClave.keys()].some((k) => k.startsWith(`${o.id}::`)),
  );

  const buffer = await generarPlantillaPlanDotacion({
    obras: obrasPlantilla,
    planExistentePorClave,
    eventosExistentes: eventos,
    dotacionRealPorObra,
    periodos,
    generadoEn: new Date(),
  });
  writeFileSync(rutaSalida, buffer);

  // --- Validación con el mismo parser del sync ---
  const obrasConocidas = new Map(obrasPlantilla.map((o) => [o.id, o.nombre]));
  const parse = await parsePlanDotacion(buffer, obrasConocidas);
  const totalPorPeriodo = new Map<string, number>();
  for (const f of parse.filas)
    totalPorPeriodo.set(f.periodo, (totalPorPeriodo.get(f.periodo) ?? 0) + f.variacionNeta);

  console.log(`Archivo generado: ${rutaSalida}`);
  console.log(`Filas de plan: ${parse.filas.length} | eventos: ${parse.eventos.length}`);
  console.log("Variación neta total por mes (obras + Oficina Central):");
  for (const p of periodos) console.log(`  ${p.slice(0, 7)}: ${totalPorPeriodo.get(p) ?? "(sin plan)"}`);
  console.log("Eventos:");
  for (const e of parse.eventos)
    console.log(`  ${e.periodo.slice(0, 7)} ${e.concepto} ${e.monto} ${e.moneda.toUpperCase()} — ${e.descripcion ?? ""}`);
  if (sinMatch.length) console.log("SIN MATCH en obras (no se cargaron):", sinMatch);
  if (vencidasConPlan.length)
    console.log("Obras con fin vencido (no salen en la plantilla):", vencidasConPlan.map((o) => o.nombre));
  if (parse.errores.length) console.log("Errores del parser:", parse.errores);
  if (parse.advertencias.length) console.log("Advertencias:", parse.advertencias);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
