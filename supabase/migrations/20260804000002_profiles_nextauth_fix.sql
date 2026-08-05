-- ============================================
-- Fix: profiles no debe depender de Supabase Auth
-- ============================================
-- La migración 001 asumió Supabase Auth como identidad (profiles.id →
-- auth.users + trigger on_auth_user_created). La decisión real del
-- Tech Spec (§2.2, §6.1) es usar NextAuth con provider Microsoft Entra ID
-- como ÚNICA identidad — Supabase se usa solo como almacén de datos vía
-- service role. Sin este fix, la tabla `profiles` nunca se puebla porque
-- nada inserta en `auth.users`.
--
-- profiles.id pasa a ser el Microsoft OID (GUID que ya trae ese formato),
-- poblado por el callback signIn de NextAuth (ver src/lib/auth/config.ts),
-- no por un trigger de Supabase.

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS handle_new_user();

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

COMMENT ON COLUMN profiles.id IS 'Microsoft OID (claim "sub"/"oid" del login delegado NextAuth) — NO es un id de Supabase Auth.';
