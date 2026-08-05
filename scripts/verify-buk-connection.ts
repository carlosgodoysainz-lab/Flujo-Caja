// Verificación manual autocontenida (no importa client.ts a propósito —
// ese archivo tiene `import "server-only"` que bloquea ejecución fuera
// del pipeline de Next). Replica solo la llamada mínima para confirmar
// que BUK_API_KEY funciona contra la API real.
// Ejecutar con: npx tsx --env-file=.env.local scripts/verify-buk-connection.ts

async function main() {
  const BUK_BASE = process.env.BUK_API_URL ?? "https://maestra.buk.cl";
  const BUK_KEY = process.env.BUK_API_KEY ?? "";

  console.log("BUK_API_URL:", BUK_BASE);
  console.log(
    "BUK_API_KEY presente:",
    !!BUK_KEY,
    BUK_KEY ? `(${BUK_KEY.slice(0, 4)}...)` : "",
  );

  const res = await fetch(
    `${BUK_BASE}/api/v1/employees?per_page=5&status=activo&page=1`,
    {
      headers: { auth_token: BUK_KEY, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    },
  );

  console.log("HTTP status:", res.status);
  if (!res.ok) {
    console.log("Respuesta:", await res.text());
    return;
  }

  const json = await res.json();
  console.log("Total páginas:", json.pagination?.total_pages);
  console.log("Total empleados (count):", json.pagination?.count);
  console.log("--- Muestra (primeros 5, solo cargo/area, sin nombre/rut) ---");
  for (const emp of json.data ?? []) {
    console.log({
      cargo: emp.current_job?.role?.name ?? null,
      familia: emp.current_job?.role?.role_family?.name ?? null,
      areaId: emp.current_job?.area_id ?? null,
      status: emp.status,
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
