import { timingSafeEqual } from "node:crypto";
import { runBukSnapshot } from "@/features/headcount/buk-sync/sync";

function secretoValido(authHeader: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  // Auditoría 24-sep-2026: sin esta guarda, si CRON_SECRET no está definido
  // el esperado pasaba a ser el texto "Bearer undefined" y cualquiera que
  // lo enviara ejecutaba el sync. Sin secreto configurado, siempre rechaza.
  if (!secret || !authHeader) return false;
  const esperado = Buffer.from(`Bearer ${secret}`);
  const recibido = Buffer.from(authHeader);
  return (
    esperado.length === recibido.length && timingSafeEqual(esperado, recibido)
  );
}

/**
 * Invocado por Vercel Cron (1er día de cada mes) — ver vercel.json.
 * Auth vía header secreto CRON_SECRET, NO sesión de usuario (ver TECH-SPEC §6.3).
 */
export async function GET(request: Request) {
  if (!secretoValido(request.headers.get("authorization"))) {
    return Response.json(
      { error: { code: "UNAUTHORIZED", message: "CRON_SECRET inválido" } },
      { status: 401 },
    );
  }

  const result = await runBukSnapshot();
  return Response.json(result, { status: result.estado === "ok" ? 200 : 500 });
}
