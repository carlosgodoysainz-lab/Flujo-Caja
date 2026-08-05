import { runBukSnapshot } from "@/features/headcount/buk-sync/sync";

/**
 * Invocado por Vercel Cron (1er día de cada mes) — ver vercel.json.
 * Auth vía header secreto CRON_SECRET, NO sesión de usuario (ver TECH-SPEC §6.3).
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json(
      { error: { code: "UNAUTHORIZED", message: "CRON_SECRET inválido" } },
      { status: 401 },
    );
  }

  const result = await runBukSnapshot();
  return Response.json(result, { status: result.estado === "ok" ? 200 : 500 });
}
