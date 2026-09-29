import { obtenerControles } from "../services/preflight";
import type { ResultadoControl } from "../lib/controles";

const ETIQUETA_ESTADO: Record<ResultadoControl["estado"], string> = {
  ok: "OK",
  alerta: "Revisar",
  sin_datos: "Sin datos",
};

const COLOR_ESTADO: Record<ResultadoControl["estado"], string> = {
  ok: "text-[var(--ok)]",
  alerta: "text-[var(--warn)]",
  sin_datos: "text-slate-500",
};

/**
 * Controles de cordura (29-sep-2026): revisa por sí solo los números que
 * hasta ahora solo se detectaban a ojo. Las alertas van arriba y a la vista;
 * lo que está en orden queda plegado.
 */
export async function ControlesPanel() {
  let controles: ResultadoControl[];
  try {
    controles = await obtenerControles();
  } catch {
    return (
      <p className="text-sm text-slate-500" role="status">
        No se pudieron ejecutar los controles de cordura en esta carga.
      </p>
    );
  }

  const alertas = controles.filter((c) => c.estado === "alerta");
  const resto = controles.filter((c) => c.estado !== "alerta");
  const oks = controles.filter((c) => c.estado === "ok").length;

  return (
    <section
      aria-labelledby="controles-titulo"
      className="rounded-lg border border-slate-200 p-4"
    >
      <h2 id="controles-titulo" className="text-sm font-medium text-slate-900">
        Controles de cordura —{" "}
        <span
          className={
            alertas.length > 0 ? "text-[var(--warn)]" : "text-[var(--ok)]"
          }
        >
          {alertas.length > 0
            ? `${alertas.length} por revisar`
            : "todo en orden"}
        </span>{" "}
        <span className="font-normal text-slate-500">
          ({oks} de {controles.length} OK)
        </span>
      </h2>

      {alertas.length > 0 && (
        <ul className="mt-3 space-y-2">
          {alertas.map((c) => (
            <li key={c.id} className="text-sm">
              <p className="font-medium text-[var(--warn)]">⚠ {c.nombre}</p>
              <p className="text-slate-700">{c.detalle}</p>
            </li>
          ))}
        </ul>
      )}

      {resto.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-slate-500">
            Ver los {resto.length} controles restantes
          </summary>
          <ul className="mt-2 space-y-1.5 text-xs">
            {resto.map((c) => (
              <li key={c.id}>
                <span className={`font-medium ${COLOR_ESTADO[c.estado]}`}>
                  {ETIQUETA_ESTADO[c.estado]}
                </span>{" "}
                — {c.nombre}:{" "}
                <span className="text-slate-600">{c.detalle}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
