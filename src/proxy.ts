import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getSafeNextPath, isPublicPath } from "@/lib/auth/paths";
import {
  AUTH_COOKIE_NAME,
  hasAuthConfig,
  verifyAuthSessionToken,
} from "@/lib/auth/session";

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isPublicPath(pathname) || !hasAuthConfig()) {
    return NextResponse.next();
  }

  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;

  if (verifyAuthSessionToken(token)) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", getSafeNextPath(`${pathname}${search}`));

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\..*).*)"],
};
