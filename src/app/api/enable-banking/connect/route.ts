import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import {
  ENABLE_BANKING_STATE_COOKIE,
  createEnableBankingState,
  extractPsuHeaders,
  getEnableBankingCallbackUrl,
  startAuthorization,
} from "@/lib/enable-banking/client";
import type { EnableBankingPsuType } from "@/lib/enable-banking/types";

export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name")?.trim();
  const country = request.nextUrl.searchParams.get("country")?.trim().toUpperCase();
  const psuType = (request.nextUrl.searchParams.get("psuType")?.trim() ??
    "personal") as EnableBankingPsuType;

  if (!name || !country) {
    return NextResponse.redirect(
      new URL("/?error=Missing+bank+name+or+country", request.url),
    );
  }

  try {
    const state = createEnableBankingState();

    const authorization = await startAuthorization({
      aspsp: {
        country,
        name,
      },
      psuHeaders: extractPsuHeaders(request.headers),
      psuType,
      redirectUrl: getEnableBankingCallbackUrl(request.nextUrl.origin),
      state,
    });

    const response = NextResponse.redirect(authorization.url);

    response.cookies.set(ENABLE_BANKING_STATE_COOKIE, state, {
      httpOnly: true,
      maxAge: 60 * 10,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start consent flow";
    return NextResponse.redirect(
      new URL(`/?error=${encodeURIComponent(message)}`, request.url),
    );
  }
}
