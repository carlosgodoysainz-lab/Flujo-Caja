import Link from "next/link";
import { CgsWordmark } from "@/shared/ui/cgs-wordmark";

// Layout compartido de las rutas protegidas: /reporte (Fase 7), /fuentes
// (Fase 3), /dotacion (Fase 6). Tema oscuro Marca Personal CGS — decisión
// explícita del usuario 21-ago-2026, reemplaza Marca Maestra (navy/dorado).
export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-cgs-carbon">
      <nav
        className="sticky top-0 z-10 flex items-center justify-between border-b px-6 py-3"
        style={{
          backgroundColor: "var(--cgs-surface)",
          borderColor: "var(--cgs-line)",
        }}
      >
        <div className="flex items-center gap-8">
          <CgsWordmark className="h-6" />
          <div className="flex gap-1 text-sm">
            <Link
              href="/reporte"
              className="rounded-md px-3 py-1.5 text-cgs-text-muted hover:bg-white/5 hover:text-cgs-text"
            >
              Reporte
            </Link>
            <Link
              href="/fuentes"
              className="rounded-md px-3 py-1.5 text-cgs-text-muted hover:bg-white/5 hover:text-cgs-text"
            >
              Fuentes
            </Link>
            <Link
              href="/dotacion"
              className="rounded-md px-3 py-1.5 text-cgs-text-muted hover:bg-white/5 hover:text-cgs-text"
            >
              Dotación
            </Link>
          </div>
        </div>
      </nav>
      <main className="flex-1">{children}</main>
      <footer
        className="sticky bottom-0 border-t px-6 py-2 text-center backdrop-blur"
        style={{
          backgroundColor: "rgba(23,21,26,0.85)",
          borderColor: "var(--cgs-line)",
        }}
      >
        <span className="rounded-full bg-cgs-surface-2 px-3 py-1 text-xs font-medium text-cgs-text-muted">
          Uso interno — Grupo Maestra
        </span>
      </footer>
    </div>
  );
}
