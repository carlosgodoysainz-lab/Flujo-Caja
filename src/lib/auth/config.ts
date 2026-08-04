import type { NextAuthConfig } from "next-auth";
import AzureAD from "next-auth/providers/microsoft-entra-id";

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
     * Restringe el login a cuentas @maestra.cl.
     * Defensa en profundidad: además de esto, `profiles.email` tiene un
     * CHECK constraint con la misma regla (ver migración 001).
     */
    async signIn({ profile }) {
      const email = profile?.email ?? "";
      return email.toLowerCase().endsWith("@maestra.cl");
    },

    /**
     * Persiste el access_token/refresh_token de Graph en el JWT de la sesión.
     * NextAuth cifra este JWT con AUTH_SECRET — no queda en texto plano.
     */
    async jwt({ token, account }) {
      if (account) {
        token.graphAccessToken = account.access_token;
        token.graphRefreshToken = account.refresh_token;
        token.graphExpiresAt = account.expires_at;
      }
      return token;
    },

    async session({ session, token }) {
      session.graphAccessToken = token.graphAccessToken as string | undefined;
      session.graphExpiresAt = token.graphExpiresAt as number | undefined;
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
};
