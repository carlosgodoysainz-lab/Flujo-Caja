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

const MAESTRA_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 275 50" height="24">
  <path fill="#db0a5b" d="M30.87,48.94,24,42.06a2.64,2.64,0,0,1,0-3.73L44.83,17.48a2.64,2.64,0,0,1,3.73,0l6.88,6.88a2.67,2.67,0,0,1,0,3.74L34.61,48.94a2.65,2.65,0,0,1-3.74,0"/>
  <path fill="#ffcd00" d="M16.94,35l-6.87-6.88a2.64,2.64,0,0,1,0-3.73l6.87-6.88a2.65,2.65,0,0,1,3.74,0l6.87,6.88a2.64,2.64,0,0,1,0,3.73L20.68,35a2.65,2.65,0,0,1-3.74,0"/>
  <path fill="#ffffff" d="M51.53,3.86l-2.8-2.79a2.8,2.8,0,0,0-3.86,0L34.61,11.18a2.63,2.63,0,0,1-3.76.06L23.48,3.86h0L20.68,1.07a2.65,2.65,0,0,0-3.74,0L0,18l2.94,2.94A2.66,2.66,0,0,0,6.69,21L16.94,10.76a2.65,2.65,0,0,1,3.74,0l2.77,2.79h0L30.85,21a2.64,2.64,0,0,0,3.32.32,2.61,2.61,0,0,0,.44-.38L44.87,10.76a2.8,2.8,0,0,1,3.86,0L58.88,20.93a2.63,2.63,0,0,0,3.72,0l3-3Z"/>
</svg>`;

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
      ? `<path d="${lineaProyectada}" fill="none" stroke="#b89a5a" stroke-width="2.25" stroke-dasharray="5 4" stroke-linejoin="round" stroke-linecap="round" filter="url(#chart-linea-glow)"/>`
      : "";
  const hoyLine =
    idxCorte > 0
      ? `<line x1="${x(idxCorte)}" x2="${x(idxCorte)}" y1="${PADDING.top}" y2="${HEIGHT - PADDING.bottom}" stroke="#db0a5b" stroke-width="1.5"/>`
      : "";

  return `
  <div style="background:rgba(255,255,255,0.05);border-radius:8px;padding:14px;">
    <p style="margin:0 0 8px;font-size:11px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;color:rgba(255,255,255,0.5);">Total Nómina mensual — real y proyectado</p>
    <svg viewBox="0 0 ${WIDTH} ${HEIGHT}" style="width:100%;height:auto;display:block;" role="img" aria-label="Gráfico de área: Total Nómina mensual requerido, real y proyectado">
      <defs>
        <linearGradient id="chart-area-gradiente" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#b89a5a" stop-opacity="0.5"/>
          <stop offset="100%" stop-color="#b89a5a" stop-opacity="0.02"/>
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
      <path d="${lineaReal}" fill="none" stroke="#b89a5a" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round" filter="url(#chart-linea-glow)"/>
      ${lineaProyectadaSvg}
      ${hoyLine}
      ${labelsX}
      <image href="${SELLO_AUTOR_BASE64}" x="${WIDTH - 40}" y="${HEIGHT - 40}" width="30" height="30" opacity="0.22" style="pointer-events:none;"/>
    </svg>
    <div style="margin-top:6px;display:flex;gap:16px;font-size:11px;color:rgba(255,255,255,0.5);">
      <span><span style="display:inline-block;width:12px;height:2px;background:#b89a5a;vertical-align:middle;margin-right:4px;"></span>Real</span>
      <span><span style="display:inline-block;width:12px;height:0;border-top:2px dashed #b89a5a;vertical-align:middle;margin-right:4px;"></span>Proyectado</span>
      <span><span style="display:inline-block;width:2px;height:10px;background:#db0a5b;vertical-align:middle;margin-right:4px;"></span>Hoy</span>
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
  :root {
    --navy: #0a1f3c; --navy-brand: #003865; --fucsia: #db0a5b; --gold: #b89a5a;
    --ok: #2e7d32; --warn: #7a5209; --err: #c62828;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    color: #1e293b; background: #fff;
  }
  /* Hero — mismo patrón visual que hero-consolidado.tsx en /reporte: fondo
     navy full-bleed a lo ancho de la página, contenido acotado y centrado
     por dentro (pedido explícito del usuario: "igual al formato que se ve
     en la página /reporte"). */
  .hero { background: var(--navy); color: #fff; padding-bottom: 24px; }
  /* Ensanchado a 1600px (antes 1152px) para alinear con .chart-outer —
     con el gráfico ya en 1600px, dejar el título/KPIs en 1152px se veía
     descuadrado al lado de él (pedido explícito del usuario, 25-ago-2026,
     visto en el HTML descargado). Mismo ancho aplicado en /reporte en
     vivo (hero-consolidado.tsx) para mantener ambos consistentes. */
  .hero-topbar {
    display: flex; align-items: center; justify-content: space-between;
    max-width: 1600px; margin: 0 auto; padding: 16px 24px 0;
  }
  .hero-topbar .fecha { font-size: 12px; color: rgba(255,255,255,0.6); }
  .hero-content { max-width: 1600px; margin: 0 auto; padding: 12px 24px 0; }
  .hero h1 { font-size: 22px; font-weight: 600; margin: 8px 0 4px; }
  .hero h1 .accent { color: var(--gold); }
  .hero .subtitle { font-size: 13px; color: rgba(255,255,255,0.7); max-width: 640px; margin: 4px 0 0; }
  .kpis { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-top: 18px; }
  .kpi { border-radius: 8px; padding: 12px; }
  .kpi.destacado { background: rgba(255,255,255,0.1); }
  .kpi .label { font-size: 11px; color: rgba(255,255,255,0.6); }
  .kpi .valor { font-size: 17px; font-weight: 600; margin-top: 3px; color: var(--gold); }
  .kpi .valor.ok { color: var(--ok); }
  .kpi .valor.err { color: var(--err); }
  .kpi .valor.muted { color: rgba(255,255,255,0.6); }
  .mes-pico { font-size: 12px; color: rgba(255,255,255,0.6); margin: 10px 0 0; }
  .mes-pico strong { color: #fff; }
  /* Mismo ancho que /reporte en vivo (hero-consolidado.tsx): el gráfico
     es INTENCIONALMENTE más ancho que el resto (max-w-[1600px] vs.
     max-w-6xl/1152px) — pedido explícito del usuario 25-ago-2026: "el
     informe HTML no ocupa todos los espacios... debería parecerse más al
     sistema original" (revierte un ajuste anterior que angostaba ambos a
     1000px para alinearlos borde a borde entre sí, a costa de verse
     angosto frente a la app en vivo). */
  .chart-outer { max-width: 1600px; margin: 16px auto 0; padding: 0 16px 20px; }
  main { max-width: 1152px; margin: 0 auto; padding: 24px; }
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
  th, td { padding: 6px 10px; text-align: right; border-bottom: 1px solid #eef2f6; }
  th:first-child, td:first-child { text-align: left; }
  tr.total { font-weight: 600; border-top: 2px solid var(--navy-brand); }
  tr.uf { color: var(--navy-brand); font-weight: 500; }
  tr.dotacion { color: #475569; font-weight: 500; border-bottom: 2px solid #e2e8f0; }
  tr.sub td { color: #94a3b8; font-size: 11px; }
  tr.sub td:first-child { padding-left: 22px; }
  td.proyectado { color: #94a3b8; font-style: italic; }
  /* Columna N° (dotación) por sub-fila RG/RP — mismo formato del Excel
     real de Finanzas (columnas de a pares por mes), pedido explícito
     del usuario 17-ago-2026. */
  td.n-col, th.n-sub { color: #94a3b8; font-size: 11px; padding-left: 6px; padding-right: 6px; }
  th.n-sub { font-weight: 400; text-transform: none; }
  footer {
    text-align: center; padding: 12px; font-size: 11px; color: #fff;
    background: var(--navy);
  }
  .badge { display: inline-block; background: var(--navy); color: #fff; border-radius: 999px; padding: 2px 10px; font-size: 11px; }
</style>
</head>
<body>
<section class="hero">
  <div class="hero-topbar">
    ${MAESTRA_LOGO_SVG}
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
  <p style="font-size:11px;color:#94a3b8;margin-top:8px;"><i>Cursiva</i> = proyectado, no dato real ingerido.${conColumnaN ? " La columna “N°” muestra la dotación (cabezas) que explica el monto RG/RP de esa fila." : ""}</p>
</main>
<footer><span class="badge">Uso interno — Grupo Maestra</span></footer>
<script type="application/json" id="cash-flow-data">${JSON.stringify({ serie, kpis, periodoDesde, periodoHasta })}</script>
</body>
</html>`;
}
