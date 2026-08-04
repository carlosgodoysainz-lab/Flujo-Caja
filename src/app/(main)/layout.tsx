import Link from "next/link";
import { MaestraLogo } from "@/shared/ui/maestra-logo";

// Layout compartido de las rutas protegidas: /reporte (Fase 7), /fuentes
// (Fase 3), /dotacion (Fase 6). Nav + footer replican el patrón fijo
// translúcido con blur de los dashboards de referencia.
export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-white">
      <nav className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/80 px-6 py-3 backdrop-blur">
        <div className="flex items-center gap-8">
          <MaestraLogo className="h-6 w-auto" />
          <div className="flex gap-1 text-sm">
            <Link
              href="/reporte"
              className="rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            >
              Reporte
            </Link>
            <Link
              href="/fuentes"
              className="rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            >
              Fuentes
            </Link>
            <Link
              href="/dotacion"
              className="rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
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
