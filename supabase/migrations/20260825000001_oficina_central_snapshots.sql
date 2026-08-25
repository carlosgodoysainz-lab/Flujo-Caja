-- "Oficina Central" real (RP + RG sin obra asignada) — pedido explícito
-- del usuario 25-ago-2026: la fila "Oficina Central" de la hoja Excel
-- "Proyección Headcount" solo sumaba `dotacion_mensual.rp`, dejando fuera
-- a la gente clasificada RG (Rol General) que NO trabaja en ninguna obra
-- (ej. bodega/taller central). Buk no tiene ningún campo contractual
-- RG/RP en lo que `client.ts` pedía hasta hoy (solo `cargo`/`familia_
-- cargo`, que es nivel/carrera, no RG/RP) — el código usaba "¿el área
-- matchea una obra?" como sustituto, un proxy ya conocido por ser
-- inestable (bug real de 98 personas mal clasificadas por naming de
-- área, ver Auto-Blindaje).
--
-- Encontrado en vivo (llamada de diagnóstico de solo lectura a la API
-- real de Buk): el campo correcto SÍ existe — `private_role: true/false`
-- viene en la raíz de cada registro de empleado (la misma etiqueta
-- "Rol Privado" que se ve en la UI de Buk), pero nunca se pedía ni
-- mapeaba. Con este campo: RP = `private_role = true`; "RG sin obra" =
-- `private_role = false` Y área sin match a ninguna obra.
--
-- Tabla NUEVA y aditiva — deliberadamente NO se modifica
-- `buk_dotacion_snapshots` (agregar esta dimensión ahí exigiría cambiar
-- su clave única y auditar todo lo que ya consume `activos` por
-- obra/cargo). Se puebla en el mismo cron que ya corre
-- (`buk-snapshot/route.ts` → `runBukSnapshot`), reutilizando el mismo
-- fetch de empleados y el mismo matching de área→obra ya calculado —
-- sin ninguna llamada extra a la API de Buk.
CREATE TABLE oficina_central_snapshots (
  snapshot_date DATE PRIMARY KEY,
  rol_privado_count INTEGER NOT NULL CHECK (rol_privado_count >= 0),
  rg_sin_obra_count INTEGER NOT NULL CHECK (rg_sin_obra_count >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
ALTER TABLE oficina_central_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Usuarios autenticados leen oficina central" ON oficina_central_snapshots FOR SELECT
  USING (auth.uid() IS NOT NULL);
COMMENT ON TABLE oficina_central_snapshots IS 'Snapshot mensual de dotación de Oficina Central real (RP contractual + RG sin obra asignada), vía private_role de Buk — no reemplaza dotacion_mensual.rp (dato de Finanzas, prioritario cuando el mes ya cerró), solo lo complementa para meses actuales/proyectados.';
