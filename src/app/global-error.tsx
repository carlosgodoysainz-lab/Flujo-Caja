"use client";

// Último recurso: falla el layout raíz. Debe traer su propio <html>/<body>.
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="es">
      <body
        style={{ fontFamily: "system-ui, sans-serif", padding: "4rem 1.5rem" }}
      >
        <div role="alert" style={{ maxWidth: "36rem", margin: "0 auto" }}>
          <h1 style={{ fontSize: "1.25rem" }}>La aplicación tuvo un error</h1>
          <p style={{ color: "#475569" }}>
            Recarga la página. Si el problema continúa, avisa a quien administra
            la herramienta.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{ padding: "0.5rem 1rem", cursor: "pointer" }}
          >
            Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}
