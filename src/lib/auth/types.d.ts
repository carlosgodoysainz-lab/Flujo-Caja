import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    graphAccessToken?: string;
    graphExpiresAt?: number;
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
