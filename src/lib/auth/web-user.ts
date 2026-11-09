import type { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { hasClerkConfig } from "@/lib/auth/clerk";
import { AUTH_COOKIE_NAME, verifyAuthSessionToken } from "@/lib/auth/session";

export async function getWebUserSubject(request: NextRequest): Promise<string | null> {
  if (hasClerkConfig()) {
    const session = await auth();
    return session.userId;
  }

  const privateSubject = process.env.PRIVATE_PLUGIN_SUBJECT?.trim();
  const passwordSession = request.cookies.get(AUTH_COOKIE_NAME)?.value;

  if (!privateSubject || !verifyAuthSessionToken(passwordSession)) {
    return null;
  }

  return privateSubject;
}
