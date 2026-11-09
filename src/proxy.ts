import { clerkMiddleware } from "@clerk/nextjs/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getSafeNextPath, isPublicPath } from "@/lib/auth/paths";
import { hasClerkConfig } from "@/lib/auth/clerk";
import {
  AUTH_COOKIE_NAME,
  hasAuthConfig,
  verifyAuthSessionToken,
} from "@/lib/auth/session";

const clerkProxy = clerkMiddleware(async (auth, request) => {
  if (!isPublicPath(request.nextUrl.pathname)) {
    const session = await auth();

    if (!session.userId) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set(
        "next",
        getSafeNextPath(`${request.nextUrl.pathname}${request.nextUrl.search}`),
      );
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
});

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  const { pathname, search } = request.nextUrl;

  if (hasClerkConfig()) {
    return clerkProxy(request, event);
  }

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
