import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

/**
 * Protección de rutas — ver TECH-SPEC §6.3.
 * Todo lo bajo (main)/* requiere sesión. /api/cron/* NO pasa por aquí
 * (valida su propio CRON_SECRET) — ver matcher abajo.
 */
export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const isLoginPage = req.nextUrl.pathname === "/login";

  if (!isLoggedIn && !isLoginPage) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    return NextResponse.redirect(loginUrl);
  }

  if (isLoggedIn && isLoginPage) {
    return NextResponse.redirect(new URL("/reporte", req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  // Protege todo excepto assets estáticos, la ruta de NextAuth, y los crons
  // (que se autentican con CRON_SECRET, no con sesión de usuario)
  matcher: ["/((?!api/auth|api/cron|_next/static|_next/image|favicon.ico).*)"],
};
