// Nota: sin `import "server-only"` a propósito — es función pura (recibe
// datos por parámetro, no toca secretos ni el service client), y ese
// paquete lanza error igual en Vitest fuera del pipeline de Next.
import type {
  CashFlowSeriePunto,
  ResumenKpis,
} from "@/features/cash-flow/services/queries";
import type {
  DotacionTotalPunto,
  DotacionPorConceptoPunto,
} from "@/features/headcount/services/dotacion-total";
import { pathSuavizado } from "../cash-flow/lib/smooth-path";
import { FILAS_DETALLE as FILAS } from "../cash-flow/lib/filas-detalle";
import { SELLO_AUTOR_BASE64 } from "../cash-flow/lib/watermark";

// Wordmark CGS — Marca Personal Carlos Sebastián Godoy Sainz (skill
// marca-carlos-godoy), reemplaza el logo de Maestra en este HTML
// autocontenido (decisión explícita del usuario 21-ago-2026). Wordmark
// tipográfico puro: "CGS" en Unbounded 800 + subrayado de Combustión que
// corta antes del final (nunca completo, ver references/wordmark.md).
const CGS_WORDMARK_HTML = `<span style="display:inline-flex;flex-direction:column;font-family:'Segoe UI Semibold','Segoe UI',sans-serif;letter-spacing:-0.02em;">
  <span style="font-size:18px;line-height:1;font-weight:800;color:#F5F3EF;">CGS</span>
  <span style="display:block;margin-top:2px;height:2px;width:90%;background:#FF5A1F;"></span>
</span>`;

function formatCLP(monto: number): string {
  return new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(
    monto,
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatCompacto(monto: number): string {
  if (Math.abs(monto) >= 1_000_000_000)
    return `$${(monto / 1_000_000_000).toFixed(1)}MM`;
  if (Math.abs(monto) >= 1_000_000)
    return `$${(monto / 1_000_000).toFixed(0)}M`;
  return `$${new Intl.NumberFormat("es-CL").format(monto)}`;
}

function formatMesCorto(periodo: string): string {
  const [anio, mes] = periodo.split("-");
  const nombre = new Date(Number(anio), Number(mes) - 1, 1).toLocaleDateString(
    "es-CL",
    { month: "short" },
  );
  return `${nombre.replace(".", "")} '${anio.slice(2)}`;
}

/**
 * El MISMO gráfico de "Total Nómina mensual" del hero de /reporte
 * (cash-flow-area-chart.tsx), pero como SVG estático (sin hover — no
 * tiene sentido en un archivo que se abre suelto o se adjunta por
 * correo) — pedido explícito del usuario: "en el informe descargable
 * quiero que coloque el mismo gráfico, abajo del cuadro con los datos".
 * Comparte el mismo módulo de suavizado (`pathSuavizado`) para que la
 * curva se vea idéntica a la de la app.
 */
function renderChartSvg(serie: CashFlowSeriePunto[]): string {
  const WIDTH = 900;
  const HEIGHT = 160;
  const PADDING = { top: 12, right: 16, bottom: 28, left: 64 };

  const porMes = new Map<string, { monto: number; esReal: boolean }>();
  for (const p of serie) {
    if (p.concepto === "total_nomina")
      porMes.set(p.periodo, { monto: p.monto, esReal: p.esReal });
  }
  const puntos = [...porMes.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([periodo, v]) => ({ periodo, ...v }));

  if (puntos.length === 0) return "";

  const maxMonto = Math.max(...puntos.map((p) => p.monto), 1);
  const innerW = WIDTH - PADDING.left - PADDING.right;
  const innerH = HEIGHT - PADDING.top - PADDING.bottom;
  const x = (i: number) =>
    PADDING.left + (i / Math.max(puntos.length - 1, 1)) * innerW;
  const y = (monto: number) =>
    PADDING.top + innerH - (monto / maxMonto) * innerH;

  const idxCorte = puntos.findIndex((p) => !p.esReal);
  const corte = idxCorte === -1 ? puntos.length - 1 : idxCorte;

  const xy = puntos.map((p, i) => ({ x: x(i), y: y(p.monto) }));
  const lineaCompleta = pathSuavizado(xy, 0, xy.length - 1);
  const lineaReal = pathSuavizado(xy, 0, corte);
  const lineaProyectada = pathSuavizado(xy, corte, xy.length - 1);
  const areaPath = `${lineaCompleta} L ${x(puntos.length - 1)} ${y(0)} L ${x(0)} ${y(0)} Z`;

  const pasosY = [0, 0.25, 0.5, 0.75, 1].map((f) => f * maxMonto);
  const pasoLabelX = Math.max(1, Math.round(puntos.length / 8));

  const gridlines = pasosY
    .map(
      (v) =>
        `<line x1="${PADDING.left}" x2="${WIDTH - PADDING.right}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>` +
        `<text x="${PADDING.left - 8}" y="${y(v)}" text-anchor="end" dominant-baseline="middle" font-size="9" fill="rgba(255,255,255,0.55)">${formatCompacto(v)}</text>`,
    )
    .join("");

  const labelsX = puntos
    .map((p, i) =>
      i % pasoLabelX === 0
        ? `<text x="${x(i)}" y="${HEIGHT - 8}" text-anchor="middle" font-size="9" fill="rgba(255,255,255,0.55)">${formatMesCorto(p.periodo)}</text>`
        : "",
    )
    .join("");

  const lineaProyectadaSvg =
    idxCorte !== -1
      ? `<path d="${lineaProyectada}" fill="none" stroke="#FF5A1F" stroke-width="2.25" stroke-dasharray="5 4" stroke-linejoin="round" stroke-linecap="round" filter="url(#chart-linea-glow)"/>`
      : "";
  const hoyLine =
    idxCorte > 0
      ? `<line x1="${x(idxCorte)}" x2="${x(idxCorte)}" y1="${PADDING.top}" y2="${HEIGHT - PADDING.bottom}" stroke="#C6FF3D" stroke-width="1.5"/>`
      : "";

  return `
  <div style="background:rgba(255,255,255,0.05);border-radius:8px;padding:14px;">
    <p style="margin:0 0 8px;font-size:11px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;color:rgba(255,255,255,0.5);">Total Nómina mensual — real y proyectado</p>
    <svg viewBox="0 0 ${WIDTH} ${HEIGHT}" style="width:100%;height:auto;display:block;" role="img" aria-label="Gráfico de área: Total Nómina mensual requerido, real y proyectado">
      <defs>
        <linearGradient id="chart-area-gradiente" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#FF5A1F" stop-opacity="0.5"/>
          <stop offset="100%" stop-color="#FF5A1F" stop-opacity="0.02"/>
        </linearGradient>
        <filter id="chart-linea-glow" x="-30%" y="-60%" width="160%" height="220%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="2" flood-color="#000" flood-opacity="0.35"/>
        </filter>
      </defs>
      ${gridlines}
      <clipPath id="clipReal"><rect x="0" y="0" width="${x(corte)}" height="${HEIGHT}"/></clipPath>
      <clipPath id="clipProyectado"><rect x="${x(corte)}" y="0" width="${WIDTH - x(corte)}" height="${HEIGHT}"/></clipPath>
      <path d="${areaPath}" fill="url(#chart-area-gradiente)" clip-path="url(#clipReal)"/>
      <path d="${areaPath}" fill="url(#chart-area-gradiente)" opacity="0.4" clip-path="url(#clipProyectado)"/>
      <path d="${lineaReal}" fill="none" stroke="#FF5A1F" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round" filter="url(#chart-linea-glow)"/>
      ${lineaProyectadaSvg}
      ${hoyLine}
      ${labelsX}
      <image href="${SELLO_AUTOR_BASE64}" x="${WIDTH - 40}" y="${HEIGHT - 40}" width="30" height="30" opacity="0.22" style="pointer-events:none;"/>
    </svg>
    <div style="margin-top:6px;display:flex;gap:16px;font-size:11px;color:rgba(255,255,255,0.5);">
      <span><span style="display:inline-block;width:12px;height:2px;background:#FF5A1F;vertical-align:middle;margin-right:4px;"></span>Real</span>
      <span><span style="display:inline-block;width:12px;height:0;border-top:2px dashed #FF5A1F;vertical-align:middle;margin-right:4px;"></span>Proyectado</span>
      <span><span style="display:inline-block;width:2px;height:10px;background:#C6FF3D;vertical-align:middle;margin-right:4px;"></span>Hoy</span>
    </div>
  </div>`;
}

/**
 * Genera un documento HTML ÚNICO y autocontenido (CSS/JS/datos inline,
 * sin `<link>` ni `<script src>` externos) — mismo requisito y patrón
 * visual que los dashboards de referencia de Maestra (Minuta GESPRO,
 * Carta Gantt), para poder adjuntarlo a un correo. Ver TECH-SPEC §2.2
 * y BLUEPRINT Fase 8.
 *
 * Es una plantilla propia (no reutiliza los componentes React de
 * /reporte directamente) porque esos usan clases de Tailwind que no
 * resuelven a CSS real fuera del pipeline de build — los 2 dashboards de
 * referencia tampoco usan un framework de utilidades, usan CSS plano en
 * un <style> inline, así que esta plantilla sigue ese mismo patrón.
 */
export function renderReportHtml(params: {
  serie: CashFlowSeriePunto[];
  kpis: ResumenKpis;
  /** Valor UF por período — ver uf-sync.ts. Fila "Total Nómina (UF)" solo aparece si hay dato. */
  ufPorPeriodo?: Map<string, number>;
  /** Dotación total (N°) por período — ver dotacion-total.ts. Fila "Dotación" solo aparece si hay dato. */
  dotacionPorPeriodo?: Map<string, DotacionTotalPunto>;
  /**
   * N° (dotación) por período, ESPECÍFICO de cada sub-fila RG/RP de
   * Anticipo/Remuneración — mismo formato del Excel real de Finanzas
   * (pedido explícito del usuario 17-ago-2026). Real desde
   * `payroll_line_items` cuando existe, estimado desde la dotación
   * total cuando no. Si no se provee, la tabla queda con 1 columna por
   * período (comportamiento previo).
   */
  dotacionPorConceptoYPeriodo?: Map<string, DotacionPorConceptoPunto>;
  periodoDesde: string;
  periodoHasta: string;
  generadoEn: Date;
}): string {
  const {
    serie,
    kpis,
    ufPorPeriodo,
    dotacionPorPeriodo,
    dotacionPorConceptoYPeriodo,
    periodoDesde,
    periodoHasta,
    generadoEn,
  } = params;

  const periodos = [...new Set(serie.map((p) => p.periodo))].sort();
  const valorPorConceptoYPeriodo = new Map<string, CashFlowSeriePunto>();
  for (const punto of serie)
    valorPorConceptoYPeriodo.set(`${punto.concepto}::${punto.periodo}`, punto);

  const conColumnaN = !!dotacionPorConceptoYPeriodo;
  /** Celda "N°" vacía, salvo en las sub-filas marcadas con `tieneColumnaN` — ver FILAS_DETALLE. */
  const celdaN = (concepto: string | undefined, p: string): string => {
    if (!conColumnaN) return "";
    if (!concepto) return `<td class="n-col"></td>`;
    const valor =
      dotacionPorConceptoYPeriodo?.get(p)?.[
        concepto as keyof DotacionPorConceptoPunto
      ];
    return `<td class="n-col">${valor != null ? new Intl.NumberFormat("es-CL").format(valor) : "—"}</td>`;
  };

  const filaDotacion =
    dotacionPorPeriodo && dotacionPorPeriodo.size > 0
      ? `<tr class="dotacion"><td>Dotación (N°)</td>${periodos
          .map((p) => {
            const punto = dotacionPorPeriodo.get(p);
            const clase = punto && !punto.esReal ? ' class="proyectado"' : "";
            return `<td${clase}>${punto ? new Intl.NumberFormat("es-CL").format(punto.total) : "—"}</td>${celdaN(undefined, p)}`;
          })
          .join("")}</tr>`
      : "";

  const filasTabla = FILAS.map((fila) => {
    const celdas = periodos
      .map((p) => {
        const punto = valorPorConceptoYPeriodo.get(`${fila.concepto}::${p}`);
        const clase = punto && !punto.esReal ? ' class="proyectado"' : "";
        return `<td${clase}>${punto ? formatCLP(punto.monto) : "—"}</td>${celdaN(undefined, p)}`;
      })
      .join("");
    const claseFila = fila.concepto === "total_nomina" ? ' class="total"' : "";
    const filaPrincipal = `<tr${claseFila}><td>${fila.label}</td>${celdas}</tr>`;
    const filasSub = (fila.sub ?? [])
      .map((sub) => {
        const celdasSub = periodos
          .map((p) => {
            const punto = valorPorConceptoYPeriodo.get(`${sub.concepto}::${p}`);
            const clase = punto && !punto.esReal ? ' class="proyectado"' : "";
            return `<td${clase}>${punto ? formatCLP(punto.monto) : "—"}</td>${celdaN(sub.tieneColumnaN ? sub.concepto : undefined, p)}`;
          })
          .join("");
        return `<tr class="sub"><td>${sub.label}</td>${celdasSub}</tr>`;
      })
      .join("\n");
    return `${filaPrincipal}\n${filasSub}`;
  }).join("\n");

  const filaUf =
    ufPorPeriodo && ufPorPeriodo.size > 0
      ? `<tr class="uf"><td>Total Nómina (UF)</td>${periodos
          .map((p) => {
            const totalNomina = valorPorConceptoYPeriodo.get(
              `total_nomina::${p}`,
            );
            const valorUf = ufPorPeriodo.get(p);
            const enUf =
              totalNomina && valorUf ? totalNomina.monto / valorUf : null;
            return `<td>${enUf !== null ? `${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 }).format(enUf)} UF` : "—"}</td>${celdaN(undefined, p)}`;
          })
          .join("")}</tr>`
      : "";

  const encabezadosPeriodo = periodos
    .map((p) =>
      conColumnaN
        ? `<th colspan="2">${p.slice(0, 7)}</th>`
        : `<th>${p.slice(0, 7)}</th>`,
    )
    .join("");

  // Fila 2 del header ("$" / "N°" por período) — solo si hay columna N°.
  // Mismo formato del Excel real de Finanzas (columnas de a pares por mes).
  const subEncabezadosPeriodo = conColumnaN
    ? `<tr>${periodos.map(() => `<th class="n-sub">$</th><th class="n-sub">N°</th>`).join("")}</tr>`
    : "";

  const variacionTexto =
    kpis.variacionPct === null
      ? "—"
      : `${kpis.variacionPct >= 0 ? "▲" : "▼"} ${Math.abs(kpis.variacionPct).toFixed(1)}%`;

  const variacionClase =
    kpis.variacionPct === null
      ? "muted"
      : kpis.variacionPct >= 0
        ? "err"
        : "ok";
  const dotacionClase =
    kpis.dotacionMesActual != null && !kpis.dotacionMesActualEsReal
      ? "muted"
      : "";

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Flujo de Caja Nómina — ${periodoDesde} a ${periodoHasta}</title>
<style>
  /* Marca Personal CGS (Carlos Sebastián Godoy Sainz, skill
     marca-carlos-godoy) — reemplaza Marca Maestra, decisión explícita del
     usuario 21-ago-2026. Pares texto/fondo verificados WCAG AA — ver
     Auto-Blindaje en el PRP (Voltio Azul da solo 3.37:1 sobre Carbón: se
     usa acá SOLO como borde, nunca como color de texto).
     Tipografía "Office-safe" (Segoe UI/Consolas, no Google Fonts vía
     <link>) — este documento debe seguir siendo 100% autocontenido para
     poder adjuntarlo a un correo (requisito explícito y testeado, ver
     render.test.ts "sin <link> ni <script src> externos"), y muchos
     clientes de correo bloquean/ignoran <link> de todas formas. */
  :root {
    --carbon: #0B0B0D; --signal: #FF5A1F; --structure: #1554F3; --disrupt: #C6FF3D;
    --surface: #17151A; --surface-2: #1E1A20; --line: rgba(245,243,239,0.16);
    --text: #F5F3EF; --text-muted: #9A96A6;
    --ok: #4CAF50; --warn: #F5A623; --err: #EF5350;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif;
    color: var(--text); background: var(--carbon);
  }
  h1, .font-display { font-family: "Segoe UI Semibold", "Segoe UI", sans-serif; font-weight: 700; }
  .valor, td, th, .font-mono { font-family: Consolas, "Courier New", monospace; font-variant-numeric: tabular-nums; }
  /* Hero — fondo Carbón full-bleed a lo ancho de la página, contenido
     acotado y centrado por dentro. */
  .hero { background: var(--carbon); color: var(--text); padding-bottom: 24px; }
  .hero-topbar {
    display: flex; align-items: center; justify-content: space-between;
    max-width: 1000px; margin: 0 auto; padding: 16px 24px 0;
  }
  .hero-topbar .fecha { font-size: 12px; color: var(--text-muted); font-family: "Segoe UI", sans-serif; }
  .hero-content { max-width: 1000px; margin: 0 auto; padding: 12px 24px 0; }
  .hero h1 { font-size: 22px; font-weight: 700; margin: 8px 0 4px; }
  .hero h1 .accent { color: var(--signal); }
  .hero .subtitle { font-size: 13px; color: var(--text-muted); max-width: 640px; margin: 4px 0 0; font-family: "Segoe UI", sans-serif; }
  .kpis { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-top: 18px; }
  .kpi { border-radius: 8px; padding: 12px; }
  .kpi.destacado { background: rgba(255,255,255,0.06); }
  .kpi .label { font-size: 11px; color: var(--text-muted); font-family: "Segoe UI", sans-serif; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
  .kpi .valor { font-size: 17px; font-weight: 500; margin-top: 3px; color: var(--signal); }
  .kpi .valor.ok { color: var(--ok); }
  .kpi .valor.err { color: var(--err); }
  .kpi .valor.muted { color: var(--text-muted); }
  .mes-pico { font-size: 12px; color: var(--text-muted); margin: 10px 0 0; font-family: "Segoe UI", sans-serif; }
  .mes-pico strong { color: var(--text); }
  /* Mismo max-width y padding horizontal que .hero-content — a diferencia
     de /reporte en vivo (donde el gráfico es intencionalmente más ancho,
     ver hero-consolidado.tsx), en el HTML descargado el usuario pidió que
     el cuadro de KPIs y el gráfico queden alineados borde a borde. */
  .chart-outer { max-width: 1000px; margin: 16px auto 0; padding: 0 24px 20px; }
  main { max-width: 1000px; margin: 0 auto; padding: 24px; }
  /* Bug real corregido 17-ago-2026: sin este wrapper, la tabla ancha (25+
     columnas mensuales) empujaba el body completo más allá del
     viewport — al hacer scroll horizontal para ver meses posteriores, el
     hero (dimensionado al viewport original) quedaba "cortado" y se veía
     un hueco blanco al lado, dando la sensación de que el gráfico era
     angosto/apretado. Mismo patrón que el overflow-x-auto del
     DetailTable en vivo — el scroll queda contenido en la tabla, nunca
     en toda la página. */
  .tabla-scroll { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 16px; }
  th, td { padding: 6px 10px; text-align: right; border-bottom: 1px solid var(--line); }
  th { color: var(--text-muted); font-family: "Segoe UI", sans-serif; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; font-size: 11px; }
  th:first-child, td:first-child { text-align: left; }
  /* Voltio Azul SOLO como borde (pasa el umbral 3:1 de UI/no-texto) — como
     color de TEXTO sobre Carbón falla WCAG AA (3.37:1), por eso el texto
     de estas 2 filas va en Combustión. */
  tr.total { font-weight: 600; color: var(--signal); border-top: 2px solid var(--structure); }
  tr.uf { color: var(--signal); font-weight: 500; border-top: 2px solid var(--structure); }
  tr.dotacion { color: var(--text-muted); font-weight: 500; border-bottom: 2px solid var(--line); }
  tr.sub td { color: var(--text-muted); font-size: 11px; }
  tr.sub td:first-child { padding-left: 22px; font-family: "Segoe UI", sans-serif; }
  td.proyectado { color: var(--text-muted); font-style: italic; }
  /* Columna N° (dotación) por sub-fila RG/RP — mismo formato del Excel
     real de Finanzas (columnas de a pares por mes), pedido explícito
     del usuario 17-ago-2026. */
  td.n-col, th.n-sub { color: var(--text-muted); font-size: 11px; padding-left: 6px; padding-right: 6px; }
  th.n-sub { font-weight: 400; text-transform: none; }
  footer {
    text-align: center; padding: 12px; font-size: 11px; color: var(--text-muted);
    background: var(--surface);
  }
  .badge { display: inline-block; background: var(--surface-2); color: var(--text-muted); border-radius: 999px; padding: 2px 10px; font-size: 11px; font-family: "Segoe UI", sans-serif; }
</style>
</head>
<body>
<section class="hero">
  <div class="hero-topbar">
    ${CGS_WORDMARK_HTML}
    <span class="fecha">Generado: ${generadoEn.toLocaleString("es-CL")} · Período ${periodoDesde} a ${periodoHasta}</span>
  </div>
  <div class="hero-content">
    <h1>Flujo de Caja Nómina: <span class="accent">efectivo requerido</span> por mes</h1>
    <p class="subtitle">Proyección de anticipos, remuneraciones, finiquitos, reliquidaciones, cotizaciones y SENCE — real hasta el mes actual, proyectado desde ahí.</p>

    <div class="kpis">
      <div class="kpi"><div class="label">Este mes</div><div class="valor">${formatCLP(kpis.totalMesActual)}</div></div>
      <div class="kpi destacado"><div class="label">Próximos 3 meses</div><div class="valor">${formatCLP(kpis.totalProximosTresMeses)}</div></div>
      <div class="kpi"><div class="label">Próximos 12 meses</div><div class="valor">${formatCLP(kpis.totalProximosDoceMeses)}</div></div>
      <div class="kpi"><div class="label">Variación vs. mes anterior</div><div class="valor ${variacionClase}">${escapeHtml(variacionTexto)}</div></div>
      <div class="kpi"><div class="label">Dotación total (mes actual)</div><div class="valor ${dotacionClase}">${kpis.dotacionMesActual != null ? new Intl.NumberFormat("es-CL").format(kpis.dotacionMesActual) : "—"}</div></div>
    </div>

    ${
      kpis.mesPico
        ? `<p class="mes-pico">📈 El mes de mayor requerimiento proyectado es <strong>${kpis.mesPico.periodo.slice(0, 7)}</strong> con <strong>${formatCLP(kpis.mesPico.monto)}</strong> — ${kpis.mesesProyectadosEnRango} de los meses en el rango son proyección, no dato real todavía.</p>`
        : ""
    }
  </div>

  <div class="chart-outer">
    ${renderChartSvg(serie)}
  </div>
</section>
<main>
  <div class="tabla-scroll">
    <table>
      <thead>
        <tr><th${conColumnaN ? ' rowspan="2"' : ""}>Concepto</th>${encabezadosPeriodo}</tr>
        ${subEncabezadosPeriodo}
      </thead>
      <tbody>${filaDotacion}${filasTabla}${filaUf}</tbody>
    </table>
  </div>
  <p style="font-size:11px;color:var(--text-muted);margin-top:8px;font-family:'Segoe UI',sans-serif;"><i>Cursiva</i> = proyectado, no dato real ingerido.${conColumnaN ? " La columna “N°” muestra la dotación (cabezas) que explica el monto RG/RP de esa fila." : ""}</p>
</main>
<footer><span class="badge">Uso interno — Grupo Maestra</span></footer>
<script type="application/json" id="cash-flow-data">${JSON.stringify({ serie, kpis, periodoDesde, periodoHasta })}</script>
</body>
</html>`;
}
