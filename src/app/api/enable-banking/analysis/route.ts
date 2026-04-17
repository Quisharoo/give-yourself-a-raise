import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { analyzeSpending } from "@/lib/analysis/engine";
import {
  EnableBankingError,
  ENABLE_BANKING_SESSION_COOKIE,
  extractPsuHeaders,
  getSessionOverview,
  hasEnableBankingConfig,
} from "@/lib/enable-banking/client";

export async function GET(request: NextRequest) {
  if (!hasEnableBankingConfig()) {
    return NextResponse.json(
      {
        error: "Enable Banking is not configured.",
      },
      { status: 503 },
    );
  }

  const cookieStore = await cookies();
  const sessionId =
    request.nextUrl.searchParams.get("sessionId")?.trim() ??
    cookieStore.get(ENABLE_BANKING_SESSION_COOKIE)?.value;

  if (!sessionId) {
    return NextResponse.json(
      {
        error: "No Enable Banking session cookie found.",
      },
      { status: 404 },
    );
  }

  const dateFrom =
    request.nextUrl.searchParams.get("dateFrom")?.trim() ??
    new Date(Date.now() - 1000 * 60 * 60 * 24 * 90).toISOString().slice(0, 10);
  const dateTo =
    request.nextUrl.searchParams.get("dateTo")?.trim() ?? new Date().toISOString().slice(0, 10);

  try {
    const overview = await getSessionOverview(
      sessionId,
      {
        dateFrom,
        dateTo,
        strategy: "default",
      },
      extractPsuHeaders(request.headers),
    );

    return NextResponse.json(analyzeSpending(overview.accounts));
  } catch (error) {
    if (error instanceof EnableBankingError) {
      return NextResponse.json(
        {
          details: error.details,
          error: error.message,
        },
        { status: error.status ?? 500 },
      );
    }

    return NextResponse.json(
      {
        error: "Unexpected error while generating the action brief.",
      },
      { status: 500 },
    );
  }
}
