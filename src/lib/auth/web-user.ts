import type { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";

import { getWebAuthMode } from "@/lib/auth/clerk";
import { getPrivateOwnerSubject, resolveWebOwnerSubject } from "@/lib/auth/owner";
import { AUTH_COOKIE_NAME, verifyAuthSessionToken } from "@/lib/auth/session";

export async function getWebUserSubject(request?: NextRequest): Promise<string | null> {
  const mode = getWebAuthMode();
  if (mode === "clerk") {
    const session = await auth();
    return resolveWebOwnerSubject(session.userId);
  }

  if (mode !== "password") return null;
  const cookieStore = request?.cookies ?? await cookies();
  const passwordSession = cookieStore.get(AUTH_COOKIE_NAME)?.value;

  if (!verifyAuthSessionToken(passwordSession)) {
    return null;
  }

  return getPrivateOwnerSubject();
}
