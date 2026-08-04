import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente Supabase con service role key — SOLO para Server Actions / Route Handlers.
 *
 * Bypassa RLS por diseño (ver TECH-SPEC §6.4 y §13). RLS en las tablas sigue
 * habilitado como defensa en profundidad, pero el control de acceso real de
 * esta app pasa por la sesión de NextAuth verificada ANTES de llamar a
 * cualquier función que use este cliente.
 *
 * `import "server-only"` hace que el build falle si este archivo se importa
 * accidentalmente desde un Client Component.
 */
export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}
