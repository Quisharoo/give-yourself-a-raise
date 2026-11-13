import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getWebUserSubject } from "@/lib/auth/web-user";
import { saveBankConnection } from "@/lib/connections/store";
import {
  createSession,
  deleteSession,
  ENABLE_BANKING_SESSION_COOKIE,
  ENABLE_BANKING_STATE_COOKIE,
  extractPsuHeaders,
  sessionConsentExpiry,
} from "@/lib/enable-banking/client";

export async function GET(request: NextRequest) {
  const subject = await getWebUserSubject(request);
  if (!subject) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const baseUrl = process.env.APP_BASE_URL?.trim() || request.nextUrl.origin;
  const code = request.nextUrl.searchParams.get("code")?.trim();
  const returnedState = request.nextUrl.searchParams.get("state")?.trim();
  const expectedState = request.cookies.get(ENABLE_BANKING_STATE_COOKIE)?.value;

  if (!code) {
    return NextResponse.redirect(new URL("/?error=Missing+authorisation+code", baseUrl));
  }

  if (!expectedState || !returnedState || expectedState !== returnedState) {
    return NextResponse.redirect(new URL("/?error=State+mismatch", baseUrl));
  }

  let createdSessionId: string | null = null;

  try {
    const session = await createSession(code, extractPsuHeaders(request.headers));
    const sessionId =
      session.session_id ||
      (typeof session["session_id"] === "string" ? (session["session_id"] as string) : undefined);

    if (!sessionId) {
      throw new Error("Enable Banking did not return a session ID.");
    }

    createdSessionId = sessionId;
    await saveBankConnection({
      consentExpiresAt: sessionConsentExpiry(session),
      country: process.env.PRIVATE_PLUGIN_BANK_COUNTRY?.trim() || "IE",
      provider: "Revolut",
      sessionId,
      subject,
    });

    const response = NextResponse.redirect(new URL("/?connected=1", baseUrl));

    response.cookies.delete(ENABLE_BANKING_SESSION_COOKIE);
    response.cookies.delete(ENABLE_BANKING_STATE_COOKIE);

    return response;
  } catch {
    if (createdSessionId) {
      await deleteSession(createdSessionId).catch(() => {
        console.error("Failed to revoke unpersisted Enable Banking session");
      });
    }

    const message = "Unable to save the bank connection. Please try again.";
    return NextResponse.redirect(
      new URL(`/?error=${encodeURIComponent(message)}`, baseUrl),
    );
  }
}
