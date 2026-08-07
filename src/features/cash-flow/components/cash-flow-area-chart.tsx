"use client";

import { useMemo, useRef, useState } from "react";
import type { CashFlowSeriePunto } from "../services/queries";
import { pathSuavizado } from "../lib/smooth-path";

/**
 * Gráfico de área para "Total Nómina requerido en el tiempo" — análogo a
 * "Escala de Obras" del Carta Gantt de referencia, aplicado al flujo de
 * caja. Serie ÚNICA (Total Nómina): un solo hue en todo el gráfico — real
 * vs. proyectado se distingue por trazo (sólido/punteado) y opacidad del
 * relleno, NO por un segundo color (ver skill dataviz: "color sigue a la
 * entidad, nunca a su certeza/rango").
 *
 * Paleta pensada para fondo NAVY (vive dentro del hero oscuro, no sobre
 * blanco) — bug real reportado: con `--navy-brand` (#003865, casi el mismo
 * tono que el fondo `--navy` #0a1f3c) la línea/área quedaban invisibles.
 * Se usa `--gold` (mismo hue que "Escala de Obras" de referencia) para la
 * serie, y grises translúcidos en vez de los grises pensados para blanco
 * (#94a3b8, #e2e8f0) para grillas/ejes.
 */
const LINEA = "var(--gold)";
const GRID = "rgba(255,255,255,0.12)";
const EJE_TEXTO = "rgba(255,255,255,0.55)";

const WIDTH = 900;
// Más "delgado" (proporción más ancha que alta) — al ensanchar el
// contenedor del gráfico (pedido explícito: "más amplia hacia los
// lados"), el viewBox escala manteniendo proporción, así que con
// HEIGHT=220 el gráfico también crecía en alto y quedaba cortado en la
// primera vista de la página (bug real reportado). 130 en vez de 220
// mantiene el ancho ganado sin la altura extra.
const HEIGHT = 130;
const PADDING = { top: 12, right: 16, bottom: 24, left: 64 };

function formatCLPCompacto(monto: number): string {
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

export function CashFlowAreaChart({ serie }: { serie: CashFlowSeriePunto[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const puntos = useMemo(() => {
    const porMes = new Map<string, { monto: number; esReal: boolean }>();
    for (const p of serie) {
      if (p.concepto === "total_nomina")
        porMes.set(p.periodo, { monto: p.monto, esReal: p.esReal });
    }
    return [...porMes.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([periodo, v]) => ({ periodo, ...v }));
  }, [serie]);

  if (puntos.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        Sin datos calculados todavía — usa &quot;Actualizar reporte&quot;.
      </p>
    );
  }

  const maxMonto = Math.max(...puntos.map((p) => p.monto), 1);
  const innerW = WIDTH - PADDING.left - PADDING.right;
  const innerH = HEIGHT - PADDING.top - PADDING.bottom;

  const x = (i: number) =>
    PADDING.left + (i / Math.max(puntos.length - 1, 1)) * innerW;
  const y = (monto: number) =>
    PADDING.top + innerH - (monto / maxMonto) * innerH;

  // Punto donde la serie pasa de real a proyectado (para partir el trazo/relleno ahí).
  const idxCorte = puntos.findIndex((p) => !p.esReal);
  const corte = idxCorte === -1 ? puntos.length - 1 : idxCorte;

  const xy = puntos.map((p, i) => ({ x: x(i), y: y(p.monto) }));
  const lineaCompleta = pathSuavizado(xy, 0, xy.length - 1);
  const lineaReal = pathSuavizado(xy, 0, corte);
  const lineaProyectada = pathSuavizado(xy, corte, xy.length - 1);

  const areaPath = `${lineaCompleta} L ${x(puntos.length - 1)} ${y(0)} L ${x(0)} ${y(0)} Z`;

  // Gridlines Y — 4 pasos redondeados.
  const pasosY = [0, 0.25, 0.5, 0.75, 1].map((f) => f * maxMonto);

  // Labels X — cada 3 meses aprox, para no saturar (24 meses en el rango default).
  const pasoLabelX = Math.max(1, Math.round(puntos.length / 8));

  // Sigue el mouse de forma CONTINUA a lo largo del gráfico (no solo
  // celdas discretas por mes) y ajusta al punto más cercano — mismo
  // comportamiento que el gráfico "Escala de Obras" del Carta Gantt de
  // referencia (mover el mouse por el área revela el valor en cada punto).
  function moverMouse(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const xEnPixelesReales = e.clientX - rect.left;
    const xEnViewBox = (xEnPixelesReales / rect.width) * WIDTH;
    const fraccion = (xEnViewBox - PADDING.left) / innerW;
    const idx = Math.round(fraccion * Math.max(puntos.length - 1, 1));
    setHoverIdx(Math.min(Math.max(idx, 0), puntos.length - 1));
  }

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full cursor-crosshair"
        role="img"
        aria-label="Gráfico de área: Total Nómina mensual requerido, real y proyectado"
        onMouseMove={moverMouse}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* Gridlines Y — hairline, recesivas */}
        {pasosY.map((valor, i) => (
          <g key={i}>
            <line
              x1={PADDING.left}
              x2={WIDTH - PADDING.right}
              y1={y(valor)}
              y2={y(valor)}
              stroke={GRID}
              strokeWidth={1}
            />
            <text
              x={PADDING.left - 8}
              y={y(valor)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={8}
              fill={EJE_TEXTO}
            >
              {formatCLPCompacto(valor)}
            </text>
          </g>
        ))}

        {/* Relleno — mismo hue en todo, más opaco en el tramo real */}
        <clipPath id="clipReal">
          <rect x={0} y={0} width={x(corte)} height={HEIGHT} />
        </clipPath>
        <clipPath id="clipProyectado">
          <rect x={x(corte)} y={0} width={WIDTH - x(corte)} height={HEIGHT} />
        </clipPath>
        <path
          d={areaPath}
          fill={LINEA}
          opacity={0.25}
          clipPath="url(#clipReal)"
        />
        <path
          d={areaPath}
          fill={LINEA}
          opacity={0.1}
          clipPath="url(#clipProyectado)"
        />

        {/* Línea — sólida en el tramo real, punteada en el proyectado */}
        <path
          d={lineaReal}
          fill="none"
          stroke={LINEA}
          strokeWidth={2}
          strokeLinejoin="round"
        />
        {idxCorte !== -1 && (
          <path
            d={lineaProyectada}
            fill="none"
            stroke={LINEA}
            strokeWidth={2}
            strokeDasharray="4 4"
            strokeLinejoin="round"
          />
        )}

        {/* Línea "hoy" — accent, distinta de la serie de datos */}
        {idxCorte > 0 && (
          <line
            x1={x(idxCorte)}
            x2={x(idxCorte)}
            y1={PADDING.top}
            y2={HEIGHT - PADDING.bottom}
            stroke="var(--fucsia)"
            strokeWidth={1.5}
          />
        )}

        {/* Labels X */}
        {puntos.map(
          (p, i) =>
            i % pasoLabelX === 0 && (
              <text
                key={p.periodo}
                x={x(i)}
                y={HEIGHT - 8}
                textAnchor="middle"
                fontSize={8}
                fill={EJE_TEXTO}
              >
                {formatMesCorto(p.periodo)}
              </text>
            ),
        )}

        {/* Overlay de foco por teclado — accesibilidad, no reemplaza el
            mousemove continuo del <svg> (ver moverMouse arriba). */}
        {puntos.map((p, i) => (
          <rect
            key={p.periodo}
            x={x(i) - innerW / puntos.length / 2}
            y={0}
            width={innerW / puntos.length}
            height={HEIGHT}
            fill="transparent"
            onFocus={() => setHoverIdx(i)}
            tabIndex={0}
            aria-label={`${formatMesCorto(p.periodo)}: ${formatCLPCompacto(p.monto)}`}
          />
        ))}
        {hoverIdx !== null && (
          <g>
            <line
              x1={x(hoverIdx)}
              x2={x(hoverIdx)}
              y1={PADDING.top}
              y2={HEIGHT - PADDING.bottom}
              stroke="rgba(255,255,255,0.4)"
              strokeWidth={1}
              strokeDasharray="2 2"
            />
            {/* Punto marcador — mismo lenguaje visual que el punto
                destacado del gráfico "Escala de Obras" de referencia. */}
            <circle
              cx={x(hoverIdx)}
              cy={y(puntos[hoverIdx].monto)}
              r={4}
              fill={LINEA}
              stroke="var(--navy)"
              strokeWidth={1.5}
            />
          </g>
        )}
      </svg>

      {hoverIdx !== null && (
        <div
          className="pointer-events-none absolute top-0 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-md"
          style={{
            left: `${Math.min(Math.max((x(hoverIdx) / WIDTH) * 100, 8), 92)}%`,
            transform: "translateX(-50%)",
          }}
        >
          <p className="font-semibold text-slate-900">
            {formatCLPCompacto(puntos[hoverIdx].monto)}
          </p>
          <p className="text-slate-500">
            {formatMesCorto(puntos[hoverIdx].periodo)} ·{" "}
            {puntos[hoverIdx].esReal ? "Real" : "Proyectado"}
          </p>
        </div>
      )}

      <div className="mt-1 flex gap-4 text-xs text-white/50">
        <span>
          <span className="mr-1 inline-block h-0.5 w-3 bg-[var(--gold)] align-middle" />{" "}
          Real
        </span>
        <span>
          <span className="mr-1 inline-block h-0.5 w-3 border-t border-dashed border-[var(--gold)] align-middle" />{" "}
          Proyectado
        </span>
        <span>
          <span className="mr-1 inline-block h-2.5 w-0.5 bg-[var(--fucsia)] align-middle" />{" "}
          Hoy
        </span>
      </div>
    </div>
  );
}
