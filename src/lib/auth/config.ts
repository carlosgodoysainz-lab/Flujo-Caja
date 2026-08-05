import type { NextAuthConfig } from "next-auth";
import AzureAD from "next-auth/providers/microsoft-entra-id";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Configuración de NextAuth — login delegado con Microsoft Entra ID (Azure AD).
 *
 * Por qué delegado y no app-only: el refresh del reporte es manual (decisión
 * del usuario, ver TECH-SPEC §2.2). El login delegado usa los permisos que
 * el usuario YA tiene (su OneDrive + carpetas compartidas con él), sin requerir
 * permisos "application" de todo el tenant.
 *
 * Scopes solicitados:
 * - openid, email, profile → identidad básica
 * - offline_access → refresh token, para no pedir login en cada request
 * - Files.Read.All → leer archivos que el usuario puede ver (propios + compartidos)
 * - Sites.Read.All → leer SharePoint (Flujo de Caja, Plan de Obra, Pagos Mensuales)
 */
const GRAPH_SCOPES = [
  "openid",
  "email",
  "profile",
  "offline_access",
  "Files.Read.All",
  "Sites.Read.All",
].join(" ");

/**
 * El access_token de Graph dura ~60-90 min. Como el refresh del reporte es
 * manual (puede pasar mucho tiempo entre clicks), hay que renovarlo con el
 * refresh_token en vez de forzar un nuevo login cada vez que expira.
 * Ver: https://learn.microsoft.com/entra/identity-platform/v2-oauth2-auth-code-flow#refresh-the-access-token
 */
async function refreshGraphAccessToken(refreshToken: string) {
  const tokenUrl = `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/oauth2/v2.0/token`;

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.AZURE_AD_CLIENT_ID!,
      client_secret: process.env.AZURE_AD_CLIENT_SECRET!,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: GRAPH_SCOPES,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `No se pudo renovar el token de Graph (${res.status}): ${body.slice(0, 300)}`,
    );
  }

  const json = await res.json();
  return {
    accessToken: json.access_token as string,
    // Azure AD rota el refresh_token en cada uso; si no viene uno nuevo,
    // se reutiliza el anterior (comportamiento estándar de OAuth2).
    refreshToken: (json.refresh_token as string | undefined) ?? refreshToken,
    expiresAt: Math.floor(Date.now() / 1000) + (json.expires_in as number),
  };
}

export const authConfig: NextAuthConfig = {
  providers: [
    AzureAD({
      clientId: process.env.AZURE_AD_CLIENT_ID,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET,
      issuer: `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/v2.0`,
      authorization: {
        params: { scope: GRAPH_SCOPES },
      },
    }),
  ],
  callbacks: {
    /**
     * Restringe el login a cuentas @maestra.cl y crea/actualiza el
     * `profiles` row de este usuario. Reemplaza el trigger de Supabase
     * Auth (ver migración 002) — con NextAuth como identidad, este
     * callback es el único lugar donde "nace" un usuario en la app.
     */
    async signIn({ user, profile }) {
      const email = profile?.email ?? "";
      if (!email.toLowerCase().endsWith("@maestra.cl")) return false;
      if (!user.id) return false;

      const supabase = createServiceClient();
      const { error } = await supabase.from("profiles").upsert(
        {
          id: user.id,
          email,
          full_name: profile?.name ?? email,
        },
        { onConflict: "id" },
      );

      if (error) {
        console.error("[auth] Error creando/actualizando profile:", error);
        // Fail-open: no bloqueamos el login por un error transitorio de DB —
        // las Server Actions que dependen de profiles fallarán con un error
        // claro más adelante si el profile realmente no quedó creado.
      }

      return true;
    },

    /**
     * Persiste el access_token/refresh_token de Graph en el JWT de la sesión,
     * y lo renueva automáticamente cuando está vencido o a punto de vencer.
     * NextAuth cifra este JWT con AUTH_SECRET — no queda en texto plano.
     */
    async jwt({ token, account }) {
      if (account) {
        token.graphAccessToken = account.access_token;
        token.graphRefreshToken = account.refresh_token;
        token.graphExpiresAt = account.expires_at;
        return token;
      }

      const expiresAt = token.graphExpiresAt as number | undefined;
      const refreshToken = token.graphRefreshToken as string | undefined;
      const isExpiredOrExpiringSoon =
        !expiresAt || Date.now() / 1000 > expiresAt - 60;

      if (isExpiredOrExpiringSoon && refreshToken) {
        try {
          const refreshed = await refreshGraphAccessToken(refreshToken);
          token.graphAccessToken = refreshed.accessToken;
          token.graphRefreshToken = refreshed.refreshToken;
          token.graphExpiresAt = refreshed.expiresAt;
        } catch (error) {
          // Fail-open a nivel de sesión: no tumbamos el login, pero
          // graphAccessToken queda stale — el llamado a Graph API fallará
          // con un 401 claro (GRAPH_AUTH_EXPIRED) que la UI puede mostrar.
          console.error("[auth] Error renovando token de Graph:", error);
        }
      }

      return token;
    },

    async session({ session, token }) {
      session.graphAccessToken = token.graphAccessToken as string | undefined;
      session.graphExpiresAt = token.graphExpiresAt as number | undefined;
      // token.sub = user.id (Microsoft OID) — lo puebla NextAuth automáticamente.
      if (session.user && token.sub) session.user.id = token.sub;
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
};
