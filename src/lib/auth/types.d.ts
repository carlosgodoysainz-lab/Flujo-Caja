import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    graphAccessToken?: string;
    graphExpiresAt?: number;
    /** DefaultSession["user"].id (Microsoft OID) — mismo id usado como `profiles.id` (ver migración 002). */
    user: DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    graphAccessToken?: string;
    graphRefreshToken?: string;
    graphExpiresAt?: number;
  }
}
