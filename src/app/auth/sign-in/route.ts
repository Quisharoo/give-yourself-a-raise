import { auth } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

import { hasClerkConfig } from "@/lib/auth/clerk";
import { getSafeNextPath } from "@/lib/auth/paths";

export async function GET(request: NextRequest) {
  const baseUrl = process.env.APP_BASE_URL?.trim() || request.nextUrl.origin;
  const next = getSafeNextPath(request.nextUrl.searchParams.get("next"));
  const returnUrl = new URL(next, baseUrl);

  // Keep the sign-in return on this application, including backslash-normalized URLs.
  if (returnUrl.origin !== new URL(baseUrl).origin) {
    return NextResponse.redirect(new URL("/login", baseUrl));
  }

  if (!hasClerkConfig()) {
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(next)}`, baseUrl));
  }

  const session = await auth();
  if (session.userId) {
    return NextResponse.redirect(returnUrl);
  }

  // Let Clerk carry its browser state and return URL through hosted sign-in.
  // A normal navigation also works when the login page's client SDK hasn't loaded.
  return session.redirectToSignIn({ returnBackUrl: returnUrl.toString() });
}
