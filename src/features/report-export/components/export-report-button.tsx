"use client";

import { useState } from "react";
import { exportReportAsHtml } from "../export-action";
import { Button } from "@/shared/ui/button";

export function ExportReportButton({
  periodoDesde,
  periodoHasta,
}: {
  periodoDesde: string;
  periodoHasta: string;
}) {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setIsPending(true);
    setError(null);
    try {
      const result = await exportReportAsHtml(
        new Date(periodoDesde),
        new Date(periodoHasta),
      );
      if (result.estado === "error" || !result.html) {
        setError(result.errores[0] ?? "Error desconocido al exportar.");
        return;
      }
      // Descarga inmediata en el navegador — el .html ya quedó guardado
      // en Storage (historial) por el Server Action.
      const blob = new Blob([result.html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.nombreArchivo ?? "flujo-caja-nomina.html";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="outline"
        onClick={handleClick}
        disabled={isPending}
      >
        {isPending ? "Generando…" : "Descargar / Exportar HTML"}
      </Button>
      {error && <p className="text-xs text-[var(--err)]">{error}</p>}
    </div>
  );
}
