// Nota: sin `import "server-only"` a propósito — es función pura (recibe
// datos por parámetro, no toca secretos ni el service client), y ese
// paquete lanza error igual en Vitest fuera del pipeline de Next.
import type {
  CashFlowSeriePunto,
  ResumenKpis,
} from "@/features/cash-flow/services/queries";

const MAESTRA_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 275 50" height="24">
  <path fill="#db0a5b" d="M30.87,48.94,24,42.06a2.64,2.64,0,0,1,0-3.73L44.83,17.48a2.64,2.64,0,0,1,3.73,0l6.88,6.88a2.67,2.67,0,0,1,0,3.74L34.61,48.94a2.65,2.65,0,0,1-3.74,0"/>
  <path fill="#ffcd00" d="M16.94,35l-6.87-6.88a2.64,2.64,0,0,1,0-3.73l6.87-6.88a2.65,2.65,0,0,1,3.74,0l6.87,6.88a2.64,2.64,0,0,1,0,3.73L20.68,35a2.65,2.65,0,0,1-3.74,0"/>
  <path fill="#ffffff" d="M51.53,3.86l-2.8-2.79a2.8,2.8,0,0,0-3.86,0L34.61,11.18a2.63,2.63,0,0,1-3.76.06L23.48,3.86h0L20.68,1.07a2.65,2.65,0,0,0-3.74,0L0,18l2.94,2.94A2.66,2.66,0,0,0,6.69,21L16.94,10.76a2.65,2.65,0,0,1,3.74,0l2.77,2.79h0L30.85,21a2.64,2.64,0,0,0,3.32.32,2.61,2.61,0,0,0,.44-.38L44.87,10.76a2.8,2.8,0,0,1,3.86,0L58.88,20.93a2.63,2.63,0,0,0,3.72,0l3-3Z"/>
</svg>`;

const CONCEPTOS_ORDEN = [
  "anticipo",
  "remuneracion",
  "finiquito",
  "reliquidacion",
  "cotizacion",
  "sence",
  "total_nomina",
] as const;
const CONCEPTO_LABEL: Record<string, string> = {
  anticipo: "Anticipo",
  remuneracion: "Remuneración",
  finiquito: "Finiquito",
  reliquidacion: "Reliquidación",
  cotizacion: "Cotización",
  sence: "Aporte SENCE",
  total_nomina: "Total Nómina",
};

function formatCLP(monto: number): string {
  return new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(
    monto,
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
  periodoDesde: string;
  periodoHasta: string;
  generadoEn: Date;
}): string {
  const { serie, kpis, periodoDesde, periodoHasta, generadoEn } = params;

  const periodos = [...new Set(serie.map((p) => p.periodo))].sort();
  const valorPorConceptoYPeriodo = new Map<string, CashFlowSeriePunto>();
  for (const punto of serie)
    valorPorConceptoYPeriodo.set(`${punto.concepto}::${punto.periodo}`, punto);

  const filasTabla = CONCEPTOS_ORDEN.map((concepto) => {
    const celdas = periodos
      .map((p) => {
        const punto = valorPorConceptoYPeriodo.get(`${concepto}::${p}`);
        const clase = punto && !punto.esReal ? ' class="proyectado"' : "";
        return `<td${clase}>${punto ? formatCLP(punto.monto) : "—"}</td>`;
      })
      .join("");
    const claseFila = concepto === "total_nomina" ? ' class="total"' : "";
    return `<tr${claseFila}><td>${CONCEPTO_LABEL[concepto]}</td>${celdas}</tr>`;
  }).join("\n");

  const encabezadosPeriodo = periodos
    .map((p) => `<th>${p.slice(0, 7)}</th>`)
    .join("");

  const variacionTexto =
    kpis.variacionPct === null
      ? "—"
      : `${kpis.variacionPct >= 0 ? "▲" : "▼"} ${Math.abs(kpis.variacionPct).toFixed(1)}%`;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Flujo de Caja Nómina — ${periodoDesde} a ${periodoHasta}</title>
<style>
  :root {
    --navy: #0a1f3c; --navy-brand: #003865; --fucsia: #db0a5b; --gold: #b89a5a;
    --ok: #2e7d32; --warn: #b8860b; --err: #c62828;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    color: #1e293b; background: #fff;
  }
  nav {
    display: flex; align-items: center; justify-content: space-between;
    background: var(--navy); color: #fff; padding: 12px 24px;
  }
  nav .fecha { font-size: 13px; opacity: 0.8; }
  main { max-width: 1000px; margin: 0 auto; padding: 24px; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
  .kpi { border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; }
  .kpi .label { font-size: 12px; color: #64748b; }
  .kpi .valor { font-size: 20px; font-weight: 600; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 16px; }
  th, td { padding: 6px 10px; text-align: right; border-bottom: 1px solid #eef2f6; }
  th:first-child, td:first-child { text-align: left; }
  tr.total { font-weight: 600; border-top: 2px solid var(--navy-brand); }
  td.proyectado { color: #94a3b8; font-style: italic; }
  footer {
    text-align: center; padding: 12px; font-size: 11px; color: #fff;
    background: var(--navy);
  }
  .badge { display: inline-block; background: var(--navy); color: #fff; border-radius: 999px; padding: 2px 10px; font-size: 11px; }
</style>
</head>
<body>
<nav>
  ${MAESTRA_LOGO_SVG}
  <span class="fecha">Generado: ${generadoEn.toLocaleString("es-CL")} · Período ${periodoDesde} a ${periodoHasta}</span>
</nav>
<main>
  <h1>Flujo de Caja Nómina</h1>
  <div class="kpis">
    <div class="kpi"><div class="label">Total nómina (mes actual)</div><div class="valor">${formatCLP(kpis.totalMesActual)}</div></div>
    <div class="kpi"><div class="label">Variación vs. mes anterior</div><div class="valor">${escapeHtml(variacionTexto)}</div></div>
    <div class="kpi"><div class="label">Obras con dotación estimada</div><div class="valor">${kpis.obrasConEstimacion}</div></div>
    <div class="kpi"><div class="label">Meses proyectados en el rango</div><div class="valor">${kpis.mesesProyectadosEnRango}</div></div>
  </div>

  <table>
    <thead><tr><th>Concepto</th>${encabezadosPeriodo}</tr></thead>
    <tbody>${filasTabla}</tbody>
  </table>
  <p style="font-size:11px;color:#94a3b8;margin-top:8px;"><i>Cursiva</i> = proyectado, no dato real ingerido.</p>
</main>
<footer><span class="badge">Uso interno — Grupo Maestra</span></footer>
<script type="application/json" id="cash-flow-data">${JSON.stringify({ serie, kpis, periodoDesde, periodoHasta })}</script>
</body>
</html>`;
}
