import { auth, signOut } from "@/lib/auth";

// Placeholder de Fase 1 — solo valida que el login delegado funciona
// end-to-end. El dashboard real (KPIs, línea de tiempo, tabla de detalle)
// se construye en Fase 7, sobre los datos de Fases 3-6.
export default async function ReportePage() {
  const session = await auth();

  return (
    <div className="min-h-[100dvh] p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Flujo de Caja Nómina</h1>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button
            type="submit"
            className="text-sm text-slate-500 hover:underline"
          >
            Cerrar sesión
          </button>
        </form>
      </div>
      <p className="mt-4 text-slate-600">
        Sesión activa: <strong>{session?.user?.email}</strong>
      </p>
      <p className="mt-2 text-sm text-slate-400">
        Login delegado con Microsoft OK — token de Graph disponible:{" "}
        {session?.graphAccessToken ? "sí" : "no"}
      </p>
    </div>
  );
}
