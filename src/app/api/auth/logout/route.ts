import { NextResponse } from "next/server";

import { AUTH_COOKIE_NAME, getAuthCookieOptions } from "@/lib/auth/session";

export async function GET(request: Request) {
  const response = NextResponse.redirect(new URL("/login", request.url));
  response.cookies.set(AUTH_COOKIE_NAME, "", {
    ...getAuthCookieOptions(),
    maxAge: 0,
  });

  return response;
}
