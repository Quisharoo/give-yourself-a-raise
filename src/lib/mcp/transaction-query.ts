import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import {
  normalizeTransaction,
  financialFilterShape,
  matchesFinancialFilter,
  type FinancialRule,
} from "@/lib/analysis/classification";
import { CATEGORY_LABELS } from "@/lib/analysis/rules";
import type {
  EnableBankingAccountSnapshot,
  EnableBankingSession,
} from "@/lib/enable-banking/types";
import {
  addDecimal,
  compareDecimal,
  formatDecimal,
  parseDecimal,
  transactionMoney,
  TransactionInputError,
  validCalendarDate,
  type Decimal,
  BANK_TRANSACTION_STATUSES,
  transactionStatus,
  transactionEventKind,
} from "@/lib/transactions";

const amountFilter = z.union([
  z
    .string()
    .regex(/^\d+(?:\.\d+)?$/)
    .max(256),
  z.number().finite().nonnegative(),
]);
const statusSchema = z.enum([...BANK_TRANSACTION_STATUSES, "UNKNOWN", "all"]);
const queryShape = {
  ...financialFilterShape,
  status: statusSchema.optional(),
  account_refs: z
    .array(z.string().regex(/^acc_[A-Za-z0-9_-]{43}$/))
    .min(1)
    .max(100)
    .optional(),
  category: z.string().trim().min(1).max(100).optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  max_amount: amountFilter.optional(),
  merchant: z.string().trim().min(1).max(200).optional(),
  min_amount: amountFilter.optional(),
};
export const transactionQuerySchema = z.object(queryShape).strict();
export const transactionPageSchema = z
  .object({
    ...queryShape,
    detail: z.enum(["compact", "full"]).optional(),
    cursor: z.string().max(12000).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

const resolvedQuerySchema = z
  .object({
    purpose: financialFilterShape.purpose,
    project: financialFilterShape.project,
    flow_kind: financialFilterShape.flow_kind,
    currency: financialFilterShape.currency,
    status: statusSchema,
    account_refs: z.array(z.string()),
    category: z.string().nullable(),
    date_from: z.string(),
    date_to: z.string(),
    max_amount: z.string().nullable(),
    merchant: z.string().nullable(),
    min_amount: z.string().nullable(),
  })
  .strict();
export type TransactionQuery = z.infer<typeof resolvedQuerySchema>;
export interface QueryScope {
  subject: string;
  sessionId: string;
}
const cursorSchema = z
  .object({
    version: z.literal(1),
    query: resolvedQuerySchema,
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    offset: z.number().int().positive(),
    expires: z.number().int(),
  })
  .strict();
type Cursor = z.infer<typeof cursorSchema>;

function sign(scope: QueryScope, purpose: string, value: string) {
  return createHmac("sha256", scope.sessionId)
    .update(JSON.stringify([purpose, scope.subject, value]))
    .digest("base64url");
}

export function accountRef(scope: QueryScope, accountId: string) {
  return `acc_${sign(scope, "account-ref-v1", accountId)}`;
}

export function selectAccounts(
  session: EnableBankingSession,
  scope: QueryScope,
  refs: string[] = [],
) {
  const accounts = session.accounts.map((account) =>
    typeof account === "string" ? { uid: account } : account,
  );
  const known = new Map(
    accounts.map((account) => [accountRef(scope, account.uid), account]),
  );
  if (refs.some((ref) => !known.has(ref)))
    throw new TransactionInputError(
      "Unknown account reference for this connection. Refresh get_account_summary.",
    );
  return accounts.filter(
    (account) =>
      refs.length === 0 || refs.includes(accountRef(scope, account.uid)),
  );
}

export function dateRange(dateFrom: string, dateTo: string) {
  if (!validCalendarDate(dateFrom) || !validCalendarDate(dateTo))
    throw new TransactionInputError(
      "Dates must be real calendar dates in YYYY-MM-DD format.",
    );
  const days = (Date.parse(dateTo) - Date.parse(dateFrom)) / 86400000;
  if (days < 0)
    throw new TransactionInputError("date_from must be on or before date_to.");
  if (days > 366)
    throw new TransactionInputError(
      "A bank-data request cannot span more than 366 days.",
    );
  return { dateFrom, dateTo, windowDays: Math.max(1, days) };
}

export function defaultDateRange(days: number, now = Date.now()) {
  return {
    date_from: new Date(now - days * 86400000).toISOString().slice(0, 10),
    date_to: new Date(now).toISOString().slice(0, 10),
  };
}

function filterAmount(value: string | number | undefined): string | null {
  if (value === undefined) return null;
  if (typeof value === "string") return formatDecimal(parseDecimal(value));
  const [digits, exponent] = String(value).split("e");
  if (!exponent) return digits;
  const [integer, fraction = ""] = digits.split(".");
  const scale = fraction.length - Number(exponent);
  return formatDecimal({
    coefficient:
      BigInt(integer + fraction) * BigInt(10) ** BigInt(Math.max(0, -scale)),
    scale: Math.max(0, scale),
  });
}

export function readTransactionQuery(
  raw: Record<string, unknown>,
  scope: QueryScope,
  paging: boolean,
  now = Date.now(),
) {
  const parsed = (
    paging ? transactionPageSchema : transactionQuerySchema
  ).safeParse(raw);
  if (!parsed.success)
    throw new TransactionInputError(
      "Invalid transaction filters. Check dates, account_refs, amount bounds and page limit.",
    );
  const cursor =
    "cursor" in parsed.data && typeof parsed.data.cursor === "string"
      ? decodeCursor(parsed.data.cursor, scope, now)
      : undefined;
  const defaults = cursor?.query ?? defaultDateRange(30, now);
  const values = { ...defaults, ...parsed.data };
  const query: TransactionQuery = {
    ...(values.purpose ? { purpose: values.purpose } : {}),
    ...(values.project ? { project: values.project } : {}),
    ...(values.flow_kind ? { flow_kind: values.flow_kind } : {}),
    ...(values.currency ? { currency: values.currency } : {}),
    status: values.status ?? "BOOK",
    account_refs: [...new Set(values.account_refs ?? [])].sort(),
    category: values.category ?? null,
    date_from: values.date_from,
    date_to: values.date_to,
    max_amount: filterAmount(values.max_amount ?? undefined),
    merchant: values.merchant?.toLowerCase() ?? null,
    min_amount: filterAmount(values.min_amount ?? undefined),
  };
  dateRange(query.date_from, query.date_to);
  if (
    query.min_amount !== null &&
    query.max_amount !== null &&
    compareDecimal(
      parseDecimal(query.min_amount),
      parseDecimal(query.max_amount),
    ) > 0
  )
    throw new TransactionInputError("min_amount must not exceed max_amount.");
  if (cursor && JSON.stringify(query) !== JSON.stringify(cursor.query))
    throw new TransactionInputError(
      "Cursor filters differ. Restart the search to change filters.",
    );
  return {
    query,
    cursor,
    detail:
      "detail" in parsed.data && parsed.data.detail === "full"
        ? "full"
        : "compact",
    limit:
      "limit" in parsed.data && typeof parsed.data.limit === "number"
        ? parsed.data.limit
        : 50,
  };
}

function decodeCursor(value: string, scope: QueryScope, now: number): Cursor {
  const [encoded, signature, extra] = value.split(".");
  const expected = sign(scope, "transaction-cursor-v1", encoded);
  if (
    extra ||
    !signature ||
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  )
    throw new TransactionInputError("Invalid cursor. Restart the search.");
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new TransactionInputError("Invalid cursor. Restart the search.");
  }
  const parsed = cursorSchema.safeParse(payload);
  if (!parsed.success || parsed.data.expires <= now)
    throw new TransactionInputError(
      "Cursor expired or invalid. Restart the search.",
    );
  return parsed.data;
}

export function queryTransactions(
  accounts: EnableBankingAccountSnapshot[],
  query: TransactionQuery,
  scope: QueryScope,
  rules: readonly FinancialRule[] = [],
) {
  const rows = accounts
    .flatMap((account) =>
      account.transactions.map((transaction) => {
        const money = transactionMoney(transaction);
        const classified = normalizeTransaction(
          account.accountId,
          transaction,
          rules,
        );
        if (!validCalendarDate(classified.date))
          throw new TransactionInputError(
            "The bank returned an invalid transaction date.",
          );
        const row = {
          date: classified.date,
          currency: classified.currency,
          merchant: classified.merchant,
          category_key: classified.classification.categoryKey,
          category_label:
            CATEGORY_LABELS[classified.classification.categoryKey],
          flow_kind: classified.economicFlow,
          purpose: classified.purpose,
          project: classified.project,
          classification_source: classified.matchedRuleId
            ? "user_rule"
            : classified.classification.source,
          classification_reason: classified.matchedRuleId
            ? "Matched a persisted user classification rule."
            : classified.classification.reason,
          confidence: classified.classification.confidence,
          matched_rule_id: classified.matchedRuleId,
          raw_descriptor: classified.rawDescriptor,
          status: transactionStatus(transaction.status),
          zero_amount: money.magnitude.coefficient === BigInt(0),
          event_kind: transactionEventKind(transaction.bank_transaction_code),
          amount: Number(formatDecimal(money.signed)),
          amount_decimal: formatDecimal(money.signed),
          provider_amount_decimal: transaction.transaction_amount.amount,
          account_ref: accountRef(scope, account.accountId),
        };
        const identity = JSON.stringify([classified.sourceKey]);
        return { row, money, identity, classified };
      }),
    )
    .filter(
      ({ row, money, classified }) =>
        matchesFinancialFilter(classified, query) &&
        (query.status === "all" || row.status === query.status) &&
        row.date >= query.date_from &&
        row.date <= query.date_to &&
        (!query.category || row.category_key === query.category) &&
        (!query.merchant ||
          row.merchant.toLowerCase().includes(query.merchant) ||
          row.raw_descriptor.toLowerCase().includes(query.merchant)) &&
        (query.min_amount === null ||
          compareDecimal(money.magnitude, parseDecimal(query.min_amount)) >=
            0) &&
        (query.max_amount === null ||
          compareDecimal(money.magnitude, parseDecimal(query.max_amount)) <= 0),
    )
    .sort(
      (a, b) =>
        compareText(b.row.date, a.row.date) ||
        compareText(a.identity, b.identity),
    );
  const occurrences = new Map<string, number>();
  const transactions = rows.map(({ row, identity }) => {
    const occurrence = (occurrences.get(identity) ?? 0) + 1;
    occurrences.set(identity, occurrence);
    return {
      ...row,
      transaction_ref: `txn_${sign(scope, "transaction-ref-v1", JSON.stringify([identity, occurrence]))}`,
    };
  });
  return {
    transactions,
    fingerprint: createHash("sha256")
      .update(
        JSON.stringify([
          [...rules].sort((a, b) => a.id.localeCompare(b.id)),
          transactions,
        ]),
      )
      .digest("hex"),
    totals: exactTotals(rows),
    classified_totals: classifiedTotals(rows),
    status_counts: Object.fromEntries(
      [...BANK_TRANSACTION_STATUSES, "UNKNOWN"].map((status) => [
        status,
        rows.filter(({ row }) => row.status === status).length,
      ]),
    ),
    ...(query.status === "all"
      ? {
          totals_by_status: Object.fromEntries(
            [...BANK_TRANSACTION_STATUSES, "UNKNOWN"].map((status) => [
              status,
              exactTotals(rows.filter(({ row }) => row.status === status)),
            ]),
          ),
        }
      : {}),
  };
}

type MoneyRow = {
  row: { currency: string };
  money: ReturnType<typeof transactionMoney>;
};
function exactTotals(rows: MoneyRow[]) {
  const currencies = new Map<
    string,
    { debit: Decimal; credit: Decimal; net: Decimal; count: number }
  >();
  for (const { row, money } of rows) {
    const current = currencies.get(row.currency) ?? {
      debit: parseDecimal("0"),
      credit: parseDecimal("0"),
      net: parseDecimal("0"),
      count: 0,
    };
    if (money.signed.coefficient < BigInt(0))
      current.debit = addDecimal(current.debit, money.magnitude);
    else current.credit = addDecimal(current.credit, money.magnitude);
    current.net = addDecimal(current.net, money.signed);
    current.count++;
    currencies.set(row.currency, current);
  }
  return [...currencies]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, total]) => ({
      currency,
      count: total.count,
      debit: formatDecimal(total.debit),
      credit: formatDecimal(total.credit),
      net: formatDecimal(total.net),
    }));
}

function classifiedTotals(
  rows: Array<MoneyRow & { row: MoneyRow["row"] & { flow_kind: string } }>,
) {
  return [...new Set(rows.map(({ row }) => row.currency))]
    .sort()
    .map((currency) => {
      const same = rows.filter(({ row }) => row.currency === currency);
      function sum(flow: string) {
        return formatDecimal(
          same
            .filter(({ row }) => row.flow_kind === flow)
            .reduce(
              (total, { money }) => addDecimal(total, money.magnitude),
              parseDecimal("0"),
            ),
        );
      }
      return {
        currency,
        expense: sum("expense"),
        income: sum("income"),
        revenue: sum("revenue"),
        refund: sum("refund"),
        transfer: sum("transfer"),
        unknown: sum("unknown"),
      };
    });
}

export function transactionResult(
  result: ReturnType<typeof queryTransactions>,
  request: ReturnType<typeof readTransactionQuery>,
  scope: QueryScope,
  paging: boolean,
  now = Date.now(),
) {
  const { query, cursor, limit } = request;
  if (cursor && cursor.fingerprint !== result.fingerprint)
    throw new TransactionInputError(
      "Bank transactions changed. Restart the search to avoid missing or repeating rows.",
    );
  const offset = cursor?.offset ?? 0;
  const requestedEnd = Math.min(offset + limit, result.transactions.length);
  const candidates = result.transactions
    .slice(offset, requestedEnd)
    .map((row) => ({
      transaction_ref: row.transaction_ref,
      account_ref: row.account_ref,
      date: row.date,
      amount_decimal: row.amount_decimal,
      currency: row.currency,
      merchant: row.merchant,
      status: row.status,
      category_key: row.category_key,
      flow_kind: row.flow_kind,
      purpose: row.purpose,
      project: row.project,
      ...(request.detail === "full"
        ? {
            raw_descriptor: row.raw_descriptor,
            provider_amount_decimal: row.provider_amount_decimal,
            category_label: row.category_label,
            confidence: row.confidence,
            matched_rule_id: row.matched_rule_id,
            classification_source: row.classification_source,
            classification_reason: row.classification_reason,
            event_kind: row.event_kind,
            zero_amount: row.zero_amount,
          }
        : {}),
    }));
  const transactions: typeof candidates = [];
  let pageBytes = 2;
  for (const row of candidates) {
    const bytes =
      Buffer.byteLength(JSON.stringify(row)) + (transactions.length ? 1 : 0);
    if (pageBytes + bytes > 12_000 && transactions.length) break;
    transactions.push(row);
    pageBytes += bytes;
  }
  const end = offset + transactions.length;
  const payload: Cursor = {
    version: 1,
    query,
    fingerprint: result.fingerprint,
    offset: end,
    expires: cursor?.expires ?? now + 15 * 60 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return {
    date_from: query.date_from,
    date_to: query.date_to,
    matched_count: result.transactions.length,
    status: query.status,
    status_counts: result.status_counts,
    ...(result.totals_by_status
      ? { totals_by_status: result.totals_by_status }
      : {}),
    totals: result.totals,
    classified_totals: result.classified_totals,
    totals_scope:
      "Exact totals of all matching bank-returned rows before pagination, by currency. Bank history completeness and card balance reconciliation are not guaranteed.",
    ...(paging
      ? {
          transactions,
          page_limited_by_size: end < requestedEnd,
          next_cursor:
            end < result.transactions.length
              ? `${encoded}.${sign(scope, "transaction-cursor-v1", encoded)}`
              : null,
          truncated: end < result.transactions.length,
        }
      : {}),
  };
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}
