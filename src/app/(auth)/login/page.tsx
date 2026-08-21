import { signIn } from "@/lib/auth";
import { CgsWordmark } from "@/shared/ui/cgs-wordmark";

export default function LoginPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-cgs-carbon px-4">
      <div
        className="w-full max-w-md space-y-8 rounded-lg border p-8 text-center shadow-xl"
        style={{
          borderColor: "var(--cgs-line)",
          backgroundColor: "var(--cgs-surface)",
        }}
      >
        <CgsWordmark className="mx-auto h-8" />
        <div className="space-y-2">
          <h1 className="font-display text-2xl font-semibold text-cgs-text">
            Flujo de Caja Nómina
          </h1>
          <p className="text-sm text-cgs-text-muted">
            Uso interno — Grupo Maestra
          </p>
        </div>
        <form
          action={async () => {
            "use server";
            await signIn("microsoft-entra-id", { redirectTo: "/reporte" });
          }}
        >
          <button
            type="submit"
            className="w-full rounded-md bg-cgs-signal px-4 py-2.5 text-sm font-medium text-cgs-carbon transition hover:opacity-90"
          >
            Conectar con Microsoft
          </button>
        </form>
        <p className="text-xs text-cgs-text-muted/70">
          Solo cuentas @maestra.cl. Tu login también autoriza el acceso a los
          archivos de SharePoint que ya puedes ver.
        </p>
      </div>
    </div>
  );
}
