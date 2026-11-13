import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getWebUserSubject } from "@/lib/auth/web-user";
import { getBankConnection } from "@/lib/connections/store";
import {
  EnableBankingError,
  extractPsuHeaders,
  getAccountBalances,
  getAccountTransactions,
  getSession,
  getSessionOverview,
  hasEnableBankingConfig,
} from "@/lib/enable-banking/client";
import { writeEnableBankingCapture } from "@/lib/enable-banking/local-capture";
import type { EnableBankingSessionAccountReference } from "@/lib/enable-banking/types";

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
    const summary = request.nextUrl.searchParams.get("summary") === "1";

    if (summary) {
      const session = await getSession(sessionId);
      const accountReferences = normalizeAccountReferences(session.accounts);
      const psuHeaders = extractPsuHeaders(request.headers);

      const accounts = await Promise.all(
        accountReferences.map(async (account) => {
          const [balances, transactionPage] = await Promise.all([
            getAccountBalances(account.uid, psuHeaders),
            getAccountTransactions(
              account.uid,
              {
                dateFrom,
                dateTo,
                strategy: "default",
              },
              psuHeaders,
            ),
          ]);

          return {
            accountId: account.uid,
            balances,
            iban: account.iban,
            name: account.name,
            transactions: transactionPage.transactions.slice(0, 12),
          };
        }),
      );

      const summaryPayload = {
        accounts,
        session,
      };

      await writeEnableBankingCapture("session-summary", {
        data: summaryPayload,
        meta: {
          accountCount: accounts.length,
          dateFrom,
          dateTo,
          summary,
        },
      });

      return NextResponse.json(
        { ...summaryPayload, session: { ...session, session_id: undefined } },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const overview = await getSessionOverview(
      sessionId,
      {
        dateFrom,
        dateTo,
        strategy: "default",
      },
      extractPsuHeaders(request.headers),
    );

    await writeEnableBankingCapture("session-overview", {
      data: overview,
      meta: {
        accountCount: overview.accounts.length,
        dateFrom,
        dateTo,
        summary,
      },
    });

    return NextResponse.json(
      { ...overview, session: { ...overview.session, session_id: undefined } },
      { headers: { "Cache-Control": "no-store" } },
    );
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
        error: "Unexpected error while reading the current session.",
      },
      { status: 500 },
    );
  }
}

function normalizeAccountReferences(
  accounts: Array<EnableBankingSessionAccountReference | string>,
): EnableBankingSessionAccountReference[] {
  return accounts.map((account) => {
    if (typeof account === "string") {
      return { uid: account };
    }

    return {
      iban: account.iban,
      name: account.name,
      uid: account.uid,
    };
  });
}
