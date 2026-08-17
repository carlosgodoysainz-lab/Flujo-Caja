import { describe, expect, it } from "vitest";
import { renderReportHtml } from "./render";
import type { ResumenKpis } from "@/features/cash-flow/services/queries";

const KPIS: ResumenKpis = {
  totalMesActual: 100_000_000,
  totalMesAnterior: 90_000_000,
  variacionPct: 11.1,
  totalProximosTresMeses: 300_000_000,
  totalProximosDoceMeses: 1_200_000_000,
  mesPico: { periodo: "2026-12-01", monto: 150_000_000 },
  obrasConEstimacion: 3,
  mesesProyectadosEnRango: 5,
  dotacionMesActual: 850,
  dotacionMesActualEsReal: true,
};

describe("renderReportHtml", () => {
  const html = renderReportHtml({
    serie: [
      {
        periodo: "2026-07-01",
        concepto: "total_nomina",
        monto: 100_000_000,
        esReal: true,
        metodoCalculo: null,
      },
      {
        periodo: "2026-08-01",
        concepto: "total_nomina",
        monto: 110_000_000,
        esReal: false,
        metodoCalculo: null,
      },
    ],
    kpis: KPIS,
    periodoDesde: "2026-07-01",
    periodoHasta: "2026-08-01",
    generadoEn: new Date(2026, 7, 4),
  });

  it("es un documento HTML completo", () => {
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain("</html>");
  });

  it("es autocontenido: sin <link> ni <script src> externos", () => {
    expect(html).not.toMatch(/<link[^>]+href=/i);
    expect(html).not.toMatch(/<script[^>]+src=/i);
  });

  it("incluye el logo SVG inline, no una <img>", () => {
    expect(html).toContain("<svg");
    expect(html).not.toContain("<img");
  });

  it("incluye los datos embebidos como JSON inline", () => {
    expect(html).toContain(
      '<script type="application/json" id="cash-flow-data">',
    );
    expect(html).toContain('"totalMesActual":100000000');
  });

  it("marca los montos proyectados con la clase 'proyectado'", () => {
    expect(html).toContain('class="proyectado"');
  });

  it("incluye el badge de uso interno", () => {
    expect(html).toContain("Uso interno — Grupo Maestra");
  });

  it("formatea montos en formato chileno (puntos de miles)", () => {
    expect(html).toContain("100.000.000");
  });
});

describe("renderReportHtml — columna N° (dotación RG/RP)", () => {
  const htmlSinColumnaN = renderReportHtml({
    serie: [
      {
        periodo: "2026-07-01",
        concepto: "anticipo_rg",
        monto: 50_000_000,
        esReal: true,
        metodoCalculo: null,
      },
    ],
    kpis: KPIS,
    periodoDesde: "2026-07-01",
    periodoHasta: "2026-07-01",
    generadoEn: new Date(2026, 7, 4),
  });

  it("sin dotacionRgRpPorPeriodo, no agrega columnas N° (comportamiento previo)", () => {
    expect(htmlSinColumnaN).not.toContain('colspan="2"');
    expect(htmlSinColumnaN).not.toContain('<th class="n-sub">');
    expect(htmlSinColumnaN).not.toContain('<td class="n-col">');
  });

  const htmlConColumnaN = renderReportHtml({
    serie: [
      {
        periodo: "2026-07-01",
        concepto: "anticipo_rg",
        monto: 50_000_000,
        esReal: true,
        metodoCalculo: null,
      },
      {
        periodo: "2026-07-01",
        concepto: "total_nomina",
        monto: 100_000_000,
        esReal: true,
        metodoCalculo: null,
      },
    ],
    dotacionRgRpPorPeriodo: new Map([["2026-07-01", { rg: 650, rp: 190 }]]),
    kpis: KPIS,
    periodoDesde: "2026-07-01",
    periodoHasta: "2026-07-01",
    generadoEn: new Date(2026, 7, 4),
  });

  it("con dotacionRgRpPorPeriodo, cada período usa colspan=2 en el header", () => {
    expect(htmlConColumnaN).toContain('colspan="2"');
  });

  it("muestra la dotación real en la sub-fila RG de Anticipo", () => {
    expect(htmlConColumnaN).toContain(">650<");
  });

  it("deja la columna N° vacía en filas sin desglose RG/RP (ej. Total Nómina)", () => {
    // La celda N° de una fila sin `dotacion` (como Total Nómina) es un
    // <td class="n-col"></td> vacío — nunca repite un número ahí.
    expect(htmlConColumnaN).toContain('<td class="n-col"></td>');
  });
});
