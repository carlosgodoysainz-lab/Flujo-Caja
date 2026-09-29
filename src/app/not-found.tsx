import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl space-y-4 px-6 py-16">
      <h1 className="text-xl font-semibold text-slate-900">
        Página no encontrada
      </h1>
      <p className="text-sm text-slate-600">
        La dirección no existe o fue movida.
      </p>
      <Link href="/reporte" className="text-sm font-medium underline">
        Ir al reporte
      </Link>
    </main>
  );
}
