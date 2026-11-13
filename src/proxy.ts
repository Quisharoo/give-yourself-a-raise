import { clerkMiddleware } from "@clerk/nextjs/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getSafeNextPath, isPublicPath } from "@/lib/auth/paths";
import { getWebAuthMode } from "@/lib/auth/clerk";
import { resolveWebOwnerSubject } from "@/lib/auth/owner";
import {
  AUTH_COOKIE_NAME,
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
    if (!resolveWebOwnerSubject(session.userId)) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }
  }

  return NextResponse.next();
});

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  const { pathname, search } = request.nextUrl;

  const mode = getWebAuthMode();
  if (mode === "clerk") {
    return clerkProxy(request, event);
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }
  if (mode === "unavailable") {
    return NextResponse.json({ error: "Sign-in is unavailable." }, { status: 503 });
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
