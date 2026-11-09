import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { getWebUserSubject } from "@/lib/auth/web-user";
import { deleteBankConnection, getBankConnection } from "@/lib/connections/store";
import {
  deleteSession,
  ENABLE_BANKING_SESSION_COOKIE,
  ENABLE_BANKING_STATE_COOKIE,
} from "@/lib/enable-banking/client";

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const subject = await getWebUserSubject(request);

  if (subject) {
    const connection = await getBankConnection(subject);

    if (connection) {
      await deleteSession(connection.sessionId).catch((error) => {
        console.error("Enable Banking session revocation failed", error);
      });
      await deleteBankConnection(subject);
    }
  }

  cookieStore.delete(ENABLE_BANKING_SESSION_COOKIE);
  cookieStore.delete(ENABLE_BANKING_STATE_COOKIE);

  return NextResponse.redirect(new URL("/", request.url));
}
