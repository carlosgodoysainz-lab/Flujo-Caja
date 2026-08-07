/**
 * Path SVG suavizado (spline tipo Catmull-Rom convertida a curvas Bézier
 * cúbicas) — compartido entre el gráfico interactivo de la app
 * (cash-flow-area-chart.tsx) y el gráfico estático del export HTML
 * (report-export/render.ts), para que ambos se vean IGUAL (pedido
 * explícito del usuario: "en el informe descargable quiero el mismo
 * gráfico"). Sin React ni nada de cliente — función pura.
 *
 * `TENSION` más alto = curva más relajada/suave (menos marcada en cada
 * quiebre); 6 es el cardinal spline estándar, 10 se pidió explícitamente
 * más suave.
 */
export const TENSION_SUAVIZADO = 10;

export function pathSuavizado(
  pts: { x: number; y: number }[],
  desde: number,
  hasta: number,
): string {
  if (hasta <= desde) return "";
  const en = (i: number) => pts[Math.max(0, Math.min(pts.length - 1, i))];
  let path = `M ${en(desde).x} ${en(desde).y}`;
  for (let i = desde; i < hasta; i++) {
    const p0 = en(i - 1);
    const p1 = en(i);
    const p2 = en(i + 1);
    const p3 = en(i + 2);
    const cp1x = p1.x + (p2.x - p0.x) / TENSION_SUAVIZADO;
    const cp1y = p1.y + (p2.y - p0.y) / TENSION_SUAVIZADO;
    const cp2x = p2.x - (p3.x - p1.x) / TENSION_SUAVIZADO;
    const cp2y = p2.y - (p3.y - p1.y) / TENSION_SUAVIZADO;
    path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return path;
}
