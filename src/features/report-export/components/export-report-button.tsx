"use client";

import { useState } from "react";
import { exportReportAsHtml } from "../export-action";
import { Button } from "@/shared/ui/button";

function base64ToBlob(base64: string, contentType: string): Blob {
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return new Blob([bytes], { type: contentType });
}

function descargar(blob: Blob, nombreArchivo: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Descarga el HTML autocontenido Y su respaldo en Excel juntos, en un
 * solo click — generados en la misma llamada al servidor desde los mismos
 * datos, así los 2 archivos que se adjuntan por correo siempre "conversan"
 * (pedido explícito del usuario).
 */
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
      if (result.estado === "error" || !result.html || !result.excelBase64) {
        setError(result.errores[0] ?? "Error desconocido al exportar.");
        return;
      }

      descargar(
        new Blob([result.html], { type: "text/html;charset=utf-8" }),
        result.nombreArchivoHtml ?? "flujo-caja-nomina.html",
      );
      descargar(
        base64ToBlob(
          result.excelBase64,
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ),
        result.nombreArchivoExcel ?? "flujo-caja-nomina.xlsx",
      );
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
        {isPending ? "Generando…" : "Descargar HTML + Excel"}
      </Button>
      {error && <p className="text-xs text-[var(--err)]">{error}</p>}
    </div>
  );
}
