import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getWebUserSubject } from "@/lib/auth/web-user";
import { getBankConnection } from "@/lib/connections/store";
import { listFinancialRules } from "@/lib/analysis/rule-store";
import { dateRange } from "@/lib/mcp/transaction-query";
import { analyzeSpending } from "@/lib/analysis/engine";
import {
  EnableBankingError,
  extractPsuHeaders,
  getSessionOverview,
  hasEnableBankingConfig,
} from "@/lib/enable-banking/client";
import { writeEnableBankingCapture } from "@/lib/enable-banking/local-capture";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const subject = await getWebUserSubject(request);
    if (!subject) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    if (!hasEnableBankingConfig()) {
      return NextResponse.json({ error: "Enable Banking is not configured." }, { status: 503 });
    }
    const connection = await getBankConnection(subject);
    if (!connection) {
      return NextResponse.json({ error: "No bank connection found." }, { status: 404 });
    }
    const sessionId = connection.sessionId;

    const dateFrom =
      request.nextUrl.searchParams.get("dateFrom")?.trim() ??
      new Date(Date.now() - 1000 * 60 * 60 * 24 * 90).toISOString().slice(0, 10);
    const dateTo =
      request.nextUrl.searchParams.get("dateTo")?.trim() ?? new Date().toISOString().slice(0, 10);

    const overview = await getSessionOverview(
      sessionId,
      {
        dateFrom,
        dateTo,
        strategy: "default",
      },
      extractPsuHeaders(request.headers),
    );

    const range = dateRange(dateFrom, dateTo);
    const analysis = analyzeSpending(overview.accounts, { rules: await listFinancialRules(subject), windowDays: range.windowDays });

    await Promise.all([
      writeEnableBankingCapture("analysis-input-overview", {
        data: overview,
        meta: {
          accountCount: overview.accounts.length,
          dateFrom,
          dateTo,
        },
      }),
      writeEnableBankingCapture("analysis-output", {
        data: analysis,
        meta: {
          accountCount: analysis.accountCount,
          dateFrom,
          dateTo,
          primaryCurrency: analysis.currencySummary.primaryCurrency,
        },
      }),
    ]);

    return NextResponse.json(analysis, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof EnableBankingError) {
      return NextResponse.json(
        {
          error: "Unable to read the bank connection. Please try again.",
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
