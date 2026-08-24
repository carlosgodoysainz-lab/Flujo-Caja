/**
 * Cuenta beneficiarios REALES en un archivo "<Sociedad>-<Concepto>-<Mes>
 * '<yy>-Transferencia Bancaria.txt" (formato de ancho fijo de nómina de
 * pago bancaria, confirmado contra archivos reales de la carpeta "Pagos
 * Mensuales/anticipos/anticipo <mes> <año>/RG|RP/") — 1 LÍNEA = 1
 * PERSONA (RUT + nombre + dirección + cuenta + monto, todo en 1 sola
 * línea de ancho fijo, sin encabezado ni fila de totales al final,
 * confirmado leyendo un archivo real completo de 675 líneas).
 *
 * Deliberadamente SOLO CUENTA líneas — nunca extrae ni retorna RUT,
 * nombre ni dirección (regla de privacidad del proyecto, ver TECH-SPEC
 * §2.2). El único dato que se necesita de este archivo es "¿cuántas
 * personas hay?", no quiénes son.
 *
 * Detección de línea válida: empieza con 7-9 dígitos (RUT sin puntos ni
 * guión, en este formato tampoco trae el dígito verificador separado)
 * seguidos inmediatamente de una letra mayúscula (el apellido) — patrón
 * estable en las 2 sociedades/meses verificados contra archivos reales.
 * Cualquier línea que no matchee (vacía, encabezado inesperado, etc.) se
 * ignora en vez de contarse — mejor subcontar un caso raro que inflar el
 * N° con basura.
 */
const PATRON_LINEA_BENEFICIARIO = /^\d{7,9}[A-ZÑ]/;

export function contarBeneficiariosTransferenciaBancaria(
  texto: string,
): number {
  const lineas = texto.split(/\r?\n/);
  let contador = 0;
  for (const linea of lineas) {
    if (PATRON_LINEA_BENEFICIARIO.test(linea)) contador++;
  }
  return contador;
}
