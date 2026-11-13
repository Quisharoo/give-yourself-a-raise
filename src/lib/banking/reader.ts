import { randomUUID } from "node:crypto";
import {
  getBankConnection,
  updateConsentExpiry,
  beginAccountFetch,
  finishAccountFetch,
  getAccountFetchObservations,
  type BankConnection,
  type FetchResource,
  type FetchRequest,
  type FetchSuccess,
  type AccountFetchObservation,
} from "@/lib/connections/store";
import {
  getSession,
  getAccountDetails,
  getAccountBalances,
  getAllAccountTransactions,
  sessionConsentExpiry,
  EnableBankingError,
} from "@/lib/enable-banking/client";
import type {
  EnableBankingSession,
  EnableBankingTransaction,
  EnableBankingBalance,
} from "@/lib/enable-banking/types";
import {
  formatDecimal,
  parseDecimal,
  transactionMoney,
  validCalendarDate,
  transactionStatus,
  TransactionInputError,
} from "@/lib/transactions";
import { accountRef, selectAccounts } from "@/lib/mcp/transaction-query";

export const bankDependencies = {
  getBankConnection,
  getSession,
  getAccountDetails,
  getAccountBalances,
  getAllAccountTransactions,
  updateConsentExpiry,
  beginAccountFetch,
  finishAccountFetch,
  getAccountFetchObservations,
};
export type BankDependencies = typeof bankDependencies;
export interface TransactionReadEvidence {
  account_ref: string;
  coverage: FetchSuccess;
}
export class BankReadError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly dataStatus: AccountFetchObservation[] = [],
  ) {
    super(message);
  }
}
export function safeBankFailure(error: unknown): BankReadError {
  if (error instanceof BankReadError) return error;
  if (error instanceof EnableBankingError && error.code === "EXPIRED_SESSION")
    return new BankReadError(
      "consent_expired",
      "Bank consent has expired. Reconnect your bank.",
    );
  if (error instanceof TransactionInputError)
    return new BankReadError(
      "invalid_bank_data",
      "The bank returned invalid financial data. Retry the request.",
    );
  return new BankReadError(
    "bank_unavailable",
    "The bank-data request failed. Retry or reconnect your bank.",
  );
}
export function consentStatus(expiresAt: string | null, now = Date.now()) {
  const remaining = expiresAt === null ? null : Date.parse(expiresAt) - now;
  const state =
    remaining === null
      ? "unknown"
      : remaining <= 0
        ? "expired"
        : remaining <= 7 * 86400000
          ? "expiring"
          : "active";
  return {
    state,
    expires_at: expiresAt,
    expiry_source: expiresAt === null ? "unknown" : "provider",
    warning:
      state === "expiring"
        ? "Bank consent expires within seven days. Reconnect soon."
        : null,
  };
}
export async function readBankSession(
  connection: BankConnection,
  deps: BankDependencies,
) {
  let session: EnableBankingSession;
  try {
    session = await deps.getSession(connection.sessionId);
  } catch (error) {
    throw safeBankFailure(error);
  }
  const expiresAt = sessionConsentExpiry(session);
  await deps.updateConsentExpiry(connection, expiresAt);
  await assertCurrentConnection(connection, deps);
  return { session, consent: consentStatus(expiresAt) };
}
export async function assertCurrentConnection(
  connection: BankConnection,
  deps: BankDependencies,
) {
  const currentConnection = await deps.getBankConnection(connection.subject);
  if (currentConnection?.connectionId !== connection.connectionId)
    throw new BankReadError(
      "connection_changed",
      "The bank connection changed. Retry with the current connection.",
    );
}
export function validateTransactions(rows: EnableBankingTransaction[]) {
  if (!Array.isArray(rows))
    throw new TransactionInputError("Invalid bank transactions.");
  for (const row of rows) {
    transactionMoney(row);
    const date =
      row.booking_date || row.value_date || row.transaction_date || "";
    if (!validCalendarDate(date))
      throw new TransactionInputError("Invalid bank transaction date.");
    for (const value of [
      row.booking_date,
      row.value_date,
      row.transaction_date,
    ])
      if (value != null && !validCalendarDate(value))
        throw new TransactionInputError("Invalid bank transaction date.");
  }
}
export function validateBalances(rows: EnableBankingBalance[]) {
  if (!Array.isArray(rows))
    throw new TransactionInputError("Invalid balances.");
  for (const balance of rows) {
    parseDecimal(balance.balance_amount?.amount);
    if (!/^[A-Z]{3}$/.test(balance.balance_amount?.currency ?? ""))
      throw new TransactionInputError("Invalid balance currency.");
    if (
      balance.reference_date != null &&
      !validCalendarDate(balance.reference_date)
    )
      throw new TransactionInputError("Invalid balance date.");
    if (
      balance.last_change_date_time != null &&
      !Number.isFinite(Date.parse(balance.last_change_date_time))
    )
      throw new TransactionInputError("Invalid balance timestamp.");
  }
}
export function balanceOutput(balance: EnableBankingBalance) {
  return {
    amount_decimal: formatDecimal(parseDecimal(balance.balance_amount.amount)),
    currency: balance.balance_amount.currency,
    type: balance.balance_type ?? null,
    reference_date: balance.reference_date ?? null,
    last_change_date_time: balance.last_change_date_time ?? null,
  };
}
function coverage(
  rows: EnableBankingTransaction[],
  request: FetchRequest,
): FetchSuccess {
  const dates = rows
    .map(
      (row) => row.booking_date || row.value_date || row.transaction_date || "",
    )
    .sort();
  const bookedDates = rows
    .filter((row) => transactionStatus(row.status) === "BOOK")
    .map(
      (row) => row.booking_date || row.value_date || row.transaction_date || "",
    )
    .sort();
  return {
    ...request,
    completed_at: new Date().toISOString(),
    returned_count: rows.length,
    pagination_complete: true,
    history_complete: "unknown",
    earliest_transaction_date: dates[0] ?? null,
    latest_transaction_date: dates.at(-1) ?? null,
    latest_booked_transaction_date: bookedDates.at(-1) ?? null,
  };
}
export async function readBankAccounts(
  connection: BankConnection,
  session: EnableBankingSession,
  deps: BankDependencies,
  range: { dateFrom: string; dateTo: string },
  refs?: string[],
  status = "all",
  balances = false,
) {
  const scope = {
    subject: connection.subject,
    sessionId: connection.sessionId,
  };
  const selected = selectAccounts(session, scope, refs);
  async function fetchResource<T>(
    accountId: string,
    resource: FetchResource,
    request: FetchRequest,
    fetch: () => Promise<T>,
    validate: (rows: T) => FetchSuccess,
  ) {
    const attempt = {
      connection,
      accountRef: accountRef(scope, accountId),
      resource,
      attemptId: randomUUID(),
    };
    if (!(await deps.beginAccountFetch(attempt, request)))
      throw new BankReadError(
        "connection_changed",
        "The bank connection changed. Retry with the current connection.",
      );
    try {
      const rows = await fetch();
      const success = validate(rows);
      await deps.finishAccountFetch(attempt, { success });
      return { rows, coverage: success };
    } catch (error) {
      const failure = safeBankFailure(error);
      await deps.finishAccountFetch(attempt, { errorCode: failure.code });
      throw failure;
    }
  }
  const outcomes = await Promise.allSettled(
    selected.map(async (account) => {
      const request = {
        date_from: range.dateFrom,
        date_to: range.dateTo,
        status,
      };
      const transactions = fetchResource(
        account.uid,
        "transactions",
        request,
        () =>
          deps.getAllAccountTransactions(account.uid, {
            ...range,
            ...(status !== "all" && status !== "UNKNOWN"
              ? { transactionStatus: status }
              : {}),
          }),
        (rows) => {
          validateTransactions(rows);
          return coverage(rows, request);
        },
      );
      const balanceRows = balances
        ? fetchResource(
            account.uid,
            "balances",
            { date_from: null, date_to: null, status: null },
            () => deps.getAccountBalances(account.uid),
            (rows) => {
              validateBalances(rows);
              return {
                ...coverage([], {
                  date_from: null,
                  date_to: null,
                  status: null,
                }),
                returned_count: rows.length,
              };
            },
          )
        : Promise.resolve({ rows: [] });
      const results = await Promise.allSettled([
        transactions,
        balanceRows,
      ] as const);
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      const [tx, bal] = results;
      if (tx.status !== "fulfilled" || bal.status !== "fulfilled")
        throw new Error("Unreachable settled bank result");
      return {
        account: {
          accountId: account.uid,
          name: account.name,
          balances: bal.value.rows,
          transactions: tx.value.rows.filter((row) => {
            const date =
              row.booking_date || row.value_date || row.transaction_date || "";
            return date >= range.dateFrom && date <= range.dateTo;
          }),
        },
        transactionEvidence: {
          account_ref: accountRef(scope, account.uid),
          coverage: tx.value.coverage,
        },
      };
    }),
  );
  const dataStatus = await deps.getAccountFetchObservations(connection);
  await assertCurrentConnection(connection, deps);
  const failures = outcomes.filter((outcome) => outcome.status === "rejected");
  if (failures.length) {
    const expired = failures.find(
      (failure) => safeBankFailure(failure.reason).code === "consent_expired",
    );
    const error = safeBankFailure((expired ?? failures[0]).reason);
    throw new BankReadError(error.code, error.message, dataStatus);
  }
  const successful = outcomes.flatMap((outcome) =>
    outcome.status === "fulfilled" ? [outcome.value] : [],
  );
  return {
    accounts: successful.map((result) => result.account),
    transactionEvidence: successful.map(
      (result): TransactionReadEvidence => result.transactionEvidence,
    ),
    dataStatus,
  };
}
