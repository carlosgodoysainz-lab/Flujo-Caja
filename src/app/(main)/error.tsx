"use client";

import { Button } from "@/shared/ui/button";

// Error boundary de las rutas protegidas (auditoría 24-sep-2026): sin esto,
// una consulta a Supabase o un sync que falle muestra la pantalla genérica
// de Next sin forma de reintentar.
export default function ErrorMain({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div role="alert" className="mx-auto max-w-xl space-y-4 px-6 py-16">
      <h1 className="text-xl font-semibold text-slate-900">
        No se pudo cargar esta página
      </h1>
      <p className="text-sm text-slate-600">
        Ocurrió un error al leer los datos. Puedes reintentar; si se repite,
        avisa a quien administra la herramienta.
      </p>
      {error.digest && (
        <p className="text-xs text-slate-500">Código: {error.digest}</p>
      )}
      <Button onClick={reset}>Reintentar</Button>
    </div>
  );
}
