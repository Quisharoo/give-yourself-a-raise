import { NextResponse } from "next/server";

import { getSafeNextPath } from "@/lib/auth/paths";
import { getWebAuthMode } from "@/lib/auth/clerk";
import {
  AUTH_COOKIE_NAME,
  createAuthSessionToken,
  getAuthCookieOptions,
  passwordMatches,
} from "@/lib/auth/session";

export async function POST(request: Request) {
  const formData = await request.formData();
  const password = String(formData.get("password") ?? "");
  const next = getSafeNextPath(String(formData.get("next") ?? "/"));
  const redirectUrl = new URL(next, request.url);

  if (getWebAuthMode() !== "password") {
    redirectUrl.pathname = "/login";
    redirectUrl.search = "";
    redirectUrl.searchParams.set("error", "config");
    redirectUrl.searchParams.set("next", next);
    return NextResponse.redirect(redirectUrl, 303);
  }

  if (!passwordMatches(password)) {
    redirectUrl.pathname = "/login";
    redirectUrl.search = "";
    redirectUrl.searchParams.set("error", "invalid");
    redirectUrl.searchParams.set("next", next);
    return NextResponse.redirect(redirectUrl, 303);
  }

  const response = NextResponse.redirect(redirectUrl, 303);
  response.cookies.set(AUTH_COOKIE_NAME, createAuthSessionToken(), getAuthCookieOptions());
  return response;
}
