import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { ENABLE_BANKING_SESSION_COOKIE, ENABLE_BANKING_STATE_COOKIE } from "@/lib/enable-banking/client";

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();

  cookieStore.delete(ENABLE_BANKING_SESSION_COOKIE);
  cookieStore.delete(ENABLE_BANKING_STATE_COOKIE);

  return NextResponse.redirect(new URL("/", request.url));
}
