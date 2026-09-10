import { signIn } from "@/lib/auth";
import { MaestraLogo } from "@/shared/ui/maestra-logo";

export default function LoginPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[var(--navy)] px-4">
      <div className="w-full max-w-md space-y-8 rounded-lg border border-white/10 bg-[var(--navy-brand)] p-8 text-center shadow-xl">
        <MaestraLogo className="mx-auto h-8 w-auto" />
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-white">
            Flujo de Caja Nómina
          </h1>
          <p className="text-sm text-white/60">Uso interno — Grupo Maestra</p>
        </div>
        <form
          action={async () => {
            "use server";
            await signIn("microsoft-entra-id", { redirectTo: "/reporte" });
          }}
        >
          <button
            type="submit"
            className="w-full rounded-md bg-white px-4 py-2.5 text-sm font-medium text-[var(--navy)] transition hover:bg-white/90"
          >
            Conectar con Microsoft
          </button>
        </form>
        <p className="text-xs text-white/40">
          Solo cuentas @maestra.cl. Tu login también autoriza el acceso a los
          archivos de SharePoint que ya puedes ver.
        </p>
      </div>
    </div>
  );
}
