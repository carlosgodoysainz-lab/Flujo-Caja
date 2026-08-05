/**
 * Aritmética de "período mensual" por STRING, nunca por `Date`. Ver la nota
 * en `dotacion-total.ts`: `new Date("2026-08-01").getMonth()` en un
 * timezone detrás de UTC (Chile, UTC-3/-4) devuelve julio, no agosto —
 * medianoche UTC del 1° de agosto es la noche del 31 de julio en Chile.
 * Módulo puro (sin `server-only`) para poder testearlo directo.
 */

/** "YYYY-MM-DD" (cualquier día del mes) → "YYYY-MM-01". */
export function periodoDeFecha(fechaStr: string): string {
  return `${fechaStr.slice(0, 7)}-01`;
}

/** "YYYY-MM-01" + n meses (n puede ser negativo) → "YYYY-MM-01". */
export function sumarMesesAPeriodo(periodo: string, n: number): string {
  const [y, m] = periodo.slice(0, 7).split("-").map(Number);
  const totalMeses = y * 12 + (m - 1) + n;
  const yy = Math.floor(totalMeses / 12);
  const mm = (totalMeses % 12) + 1;
  return `${yy}-${String(mm).padStart(2, "0")}-01`;
}
