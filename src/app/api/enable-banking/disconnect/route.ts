import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getWebUserSubject } from "@/lib/auth/web-user";
import { deleteBankConnection, getBankConnection } from "@/lib/connections/store";
import {
  deleteSession,
  EnableBankingError,
  ENABLE_BANKING_SESSION_COOKIE,
  ENABLE_BANKING_STATE_COOKIE,
} from "@/lib/enable-banking/client";

export async function POST(request: NextRequest) {
  let origin: string;
  try {
    const baseUrl = new URL(process.env.APP_BASE_URL?.trim() || "");
    if (baseUrl.protocol !== "https:" && baseUrl.protocol !== "http:") throw new Error();
    origin = baseUrl.origin;
  } catch {
    return NextResponse.json({ error: "Disconnect is unavailable." }, { status: 503 });
  }
  if (request.headers.get("origin") !== origin) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  try {
    const subject = await getWebUserSubject(request);
    if (!subject) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    const connection = await getBankConnection(subject);
    if (connection) {
      try {
        await deleteSession(connection.sessionId);
      } catch (error) {
        if (!(error instanceof EnableBankingError) || error.status !== 404) throw error;
      }
      await deleteBankConnection(subject, connection.sessionId);
    }
    const response = NextResponse.redirect(new URL("/", origin), 303);
    response.cookies.delete(ENABLE_BANKING_SESSION_COOKIE);
    response.cookies.delete(ENABLE_BANKING_STATE_COOKIE);
    return response;
  } catch {
    return NextResponse.json(
      { error: "Unable to disconnect the bank connection. Please try again." },
      { status: 502 },
    );
  }
}
