import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import {
  createSession,
  ENABLE_BANKING_SESSION_COOKIE,
  ENABLE_BANKING_STATE_COOKIE,
  extractPsuHeaders,
} from "@/lib/enable-banking/client";

export async function GET(request: NextRequest) {
  const baseUrl = process.env.APP_BASE_URL?.trim() || request.nextUrl.origin;
  const code = request.nextUrl.searchParams.get("code")?.trim();
  const returnedState = request.nextUrl.searchParams.get("state")?.trim();
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(ENABLE_BANKING_STATE_COOKIE)?.value;

  if (!code) {
    return NextResponse.redirect(new URL("/?error=Missing+authorisation+code", baseUrl));
  }

  if (!expectedState || !returnedState || expectedState !== returnedState) {
    return NextResponse.redirect(new URL("/?error=State+mismatch", baseUrl));
  }

  try {
    const session = await createSession(code, extractPsuHeaders(request.headers));
    const sessionId =
      session.session_id ||
      (typeof session["session_id"] === "string" ? (session["session_id"] as string) : undefined);

    if (!sessionId) {
      throw new Error("Enable Banking did not return a session ID.");
    }

    try {
      const localDir = join(process.cwd(), ".local");
      await mkdir(localDir, { recursive: true });
      await writeFile(
        join(localDir, "eb-session.json"),
        `${JSON.stringify({ session_id: sessionId, created_at: new Date().toISOString() }, null, 2)}\n`,
        "utf8",
      );
    } catch (persistError) {
      console.error("Failed to persist Enable Banking session for bridge", persistError);
    }

    const response = NextResponse.redirect(new URL("/?connected=1", baseUrl));

    response.cookies.set(ENABLE_BANKING_SESSION_COOKIE, sessionId, {
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    response.cookies.delete(ENABLE_BANKING_STATE_COOKIE);

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create session";
    return NextResponse.redirect(
      new URL(`/?error=${encodeURIComponent(message)}`, baseUrl),
    );
  }
}
