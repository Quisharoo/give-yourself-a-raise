import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import {
  EnableBankingError,
  ENABLE_BANKING_SESSION_COOKIE,
  extractPsuHeaders,
  getAccountBalances,
  getAccountTransactions,
  getSession,
  getSessionOverview,
  hasEnableBankingConfig,
} from "@/lib/enable-banking/client";
import type { EnableBankingSessionAccountReference } from "@/lib/enable-banking/types";

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
  const sessionId = request.nextUrl.searchParams.get("sessionId")?.trim() ??
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
  const summary = request.nextUrl.searchParams.get("summary") === "1";

  try {
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

      return NextResponse.json({
        accounts,
        session,
      });
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

    return NextResponse.json(overview);
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
