import Link from "next/link";
import { MaestraLogo } from "@/shared/ui/maestra-logo";

// Layout compartido de las rutas protegidas: /reporte (Fase 7), /fuentes
// (Fase 3), /dotacion (Fase 6). Nav navy (igual a los 2 dashboards de
// referencia y al login) — el logo de Maestra extraído de esos mismos
// dashboards trae el wordmark en BLANCO (variante para fondo oscuro, ver
// skill marca-maestra §logos), así que el nav debe ser navy para que se
// vea — con fondo blanco el texto "maestra" queda invisible (bug real
// visto en pantalla).
export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-white">
      <nav className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-[var(--navy)]/95 px-6 py-3 backdrop-blur">
        <div className="flex items-center gap-8">
          <MaestraLogo className="h-6 w-auto" />
          <div className="flex gap-1 text-sm">
            <Link
              href="/reporte"
              className="rounded-md px-3 py-1.5 text-white/70 hover:bg-white/10 hover:text-white"
            >
              Reporte
            </Link>
            <Link
              href="/fuentes"
              className="rounded-md px-3 py-1.5 text-white/70 hover:bg-white/10 hover:text-white"
            >
              Fuentes
            </Link>
            <Link
              href="/dotacion"
              className="rounded-md px-3 py-1.5 text-white/70 hover:bg-white/10 hover:text-white"
            >
              Dotación
            </Link>
          </div>
        </div>
      </nav>
      <main className="flex-1">{children}</main>
      <footer className="sticky bottom-0 border-t border-slate-200 bg-white/80 px-6 py-2 text-center backdrop-blur">
        <span className="rounded-full bg-[var(--navy)] px-3 py-1 text-xs font-medium text-white">
          Uso interno — Grupo Maestra
        </span>
      </footer>
    </div>
  );
}
