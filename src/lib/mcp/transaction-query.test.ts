import assert from "node:assert/strict";
import test from "node:test";
import type {
  EnableBankingAccountSnapshot,
  EnableBankingTransaction,
} from "../enable-banking/types.ts";
import {
  accountRef,
  queryTransactions,
  readTransactionQuery,
  selectAccounts,
  transactionResult,
} from "./transaction-query.ts";

const scope = { subject: "synthetic-user", sessionId: "server-only-session" };
const range = { date_from: "2026-01-01", date_to: "2026-02-01" };
function transaction(
  index = 0,
  extra: Partial<EnableBankingTransaction> = {},
): EnableBankingTransaction {
  return {
    status: "BOOK",
    booking_date: "2026-01-15",
    credit_debit_indicator: "DBIT",
    creditor: { name: `Coffee ${index}` },
    entry_reference: `private-entry-${index}`,
    transaction_amount: { amount: "0.10", currency: "EUR" },
    ...extra,
  };
}
function account(
  transactions: EnableBankingTransaction[],
): EnableBankingAccountSnapshot[] {
  return [{ accountId: "private-bank-account", balances: [], transactions }];
}
function run(
  transactions: EnableBankingTransaction[],
  args: Record<string, unknown> = {},
  now?: number,
) {
  const request = readTransactionQuery({ ...range, ...args }, scope, true, now);
  return transactionResult(
    queryTransactions(account(transactions), request.query, scope),
    request,
    scope,
    true,
    now,
  );
}

test("traverses 738 rows without omissions through deterministic cursors even when bank order changes", () => {
  const transactions = Array.from({ length: 736 }, (_, i) => transaction(i));
  transactions.push(transaction(10), transaction(10));
  let result = run(transactions, { limit: 50 });
  const rows = [...result.transactions!];
  assert.equal(result.matched_count, 738);
  assert.deepEqual(result.totals, [
    { currency: "EUR", count: 738, debit: "73.80", credit: "0", net: "-73.80" },
  ]);
  while (result.next_cursor) {
    result = run([...transactions].reverse(), {
      cursor: result.next_cursor,
      limit: 50,
    });
    rows.push(...result.transactions!);
  }
  assert.equal(rows.length, 738);
  assert.equal(new Set(rows.map((row) => row.transaction_ref)).size, 738);
  assert.equal(result.truncated, false);
  assert.equal(JSON.stringify(rows).includes("private-"), false);
});

test("exact decimal sums preserve precision, currency and direction independently of provider sign", () => {
  const rows = [
    transaction(0),
    transaction(1, { transaction_amount: { amount: "0.2", currency: "EUR" } }),
    transaction(2, {
      credit_debit_indicator: "CRDT",
      transaction_amount: { amount: "-9007199254740993.123", currency: "EUR" },
    }),
    transaction(3, {
      transaction_amount: { amount: "-1.004", currency: "GBP" },
    }),
  ];
  const result = run(rows);
  assert.deepEqual(result.totals, [
    {
      currency: "EUR",
      count: 3,
      debit: "0.30",
      credit: "9007199254740993.123",
      net: "9007199254740992.823",
    },
    { currency: "GBP", count: 1, debit: "1.004", credit: "0", net: "-1.004" },
  ]);
  assert.ok(
    result.transactions!.some(
      (row) =>
        row.amount_decimal === "9007199254740993.123" &&
        row.provider_amount_decimal === "-9007199254740993.123",
    ),
  );
  assert.equal(
    run(rows, { min_amount: "0.15", max_amount: "0.2" }).matched_count,
    1,
  );
});

test("account references are scoped and selection rejects unknown refs", () => {
  const ref = accountRef(scope, "private-bank-account");
  assert.notEqual(
    ref,
    accountRef({ ...scope, subject: "other" }, "private-bank-account"),
  );
  assert.notEqual(
    ref,
    accountRef({ ...scope, sessionId: "other" }, "private-bank-account"),
  );
  assert.equal(
    selectAccounts({ accounts: ["private-bank-account", "other"] }, scope, [
      ref,
    ]).length,
    1,
  );
  assert.throws(
    () => selectAccounts({ accounts: ["other"] }, scope, [ref]),
    /Unknown account/,
  );
  assert.throws(
    () => readTransactionQuery({ account_refs: [] }, scope, true),
    /Invalid transaction/,
  );
});

test("cursor binds filters, dataset, user, session, expiry and freezes default dates", () => {
  const rows = Array.from({ length: 51 }, (_, i) => transaction(i));
  const now = Date.parse("2026-01-20T23:55:00Z");
  const firstRequest = readTransactionQuery({}, scope, true, now);
  const first = transactionResult(
    queryTransactions(account(rows), firstRequest.query, scope),
    firstRequest,
    scope,
    true,
    now,
  );
  const cursor = first.next_cursor!;
  assert.equal(
    readTransactionQuery({ cursor }, scope, true, now + 10 * 60 * 1000).query
      .date_to,
    "2026-01-20",
  );
  assert.equal(
    readTransactionQuery({ cursor }, scope, true, now + 10 * 60 * 1000).query
      .date_from,
    firstRequest.query.date_from,
  );
  assert.throws(
    () => readTransactionQuery({ cursor, merchant: "new" }, scope, true, now),
    /filters differ/,
  );
  assert.throws(
    () => readTransactionQuery({ cursor: `${cursor}x` }, scope, true, now),
    /Invalid cursor/,
  );
  assert.throws(
    () =>
      readTransactionQuery(
        { cursor },
        { ...scope, subject: "another" },
        true,
        now,
      ),
    /Invalid cursor/,
  );
  assert.throws(
    () =>
      readTransactionQuery(
        { cursor },
        { ...scope, sessionId: "another" },
        true,
        now,
      ),
    /Invalid cursor/,
  );
  assert.throws(
    () => readTransactionQuery({ cursor }, scope, true, now + 900000),
    /expired/,
  );
  const nextRequest = readTransactionQuery({ cursor }, scope, true, now);
  assert.throws(
    () =>
      transactionResult(
        queryTransactions(account(rows.slice(1)), nextRequest.query, scope),
        nextRequest,
        scope,
        true,
        now,
      ),
    /changed/,
  );
  const unstableIds = rows.map((row) => ({
    ...row,
    transaction_id: "changed-provider-id",
  }));
  assert.doesNotThrow(() =>
    transactionResult(
      queryTransactions(account(unstableIds), nextRequest.query, scope),
      nextRequest,
      scope,
      true,
      now,
    ),
  );
});

test("invalid money, direction, amount filters and true calendar dates fail safely", () => {
  for (const amount of [
    "NaN",
    "Infinity",
    "",
    "1e3",
    "1,2",
    "private-invalid-amount",
  ]) {
    assert.throws(
      () =>
        run([
          transaction(0, { transaction_amount: { amount, currency: "EUR" } }),
        ]),
      /invalid transaction amount/,
    );
  }
  assert.throws(
    () => run([transaction(0, { credit_debit_indicator: undefined })]),
    /currency or direction/,
  );
  assert.throws(() => run([], { date_from: "2026-02-30" }), /real calendar/);
  assert.throws(() => run([], { date_from: "2024-01-01" }), /366 days/);
  assert.throws(
    () => run([], { min_amount: 2, max_amount: 1 }),
    /must not exceed/,
  );
});

test("status defaults to BOOK, all separates per-status totals and unknown never becomes booked", () => {
  const rows = [
    transaction(0),
    transaction(1, { status: "PDNG" }),
    transaction(2, { status: "HOLD" }),
    transaction(3, { status: undefined }),
    transaction(4, { status: "surprise-private-status" }),
  ];
  assert.equal(run(rows).matched_count, 1);
  const all = run(rows, { status: "all" });
  assert.equal(all.matched_count, 5);
  assert.deepEqual(all.status_counts, {
    BOOK: 1,
    CNCL: 0,
    HOLD: 1,
    OTHR: 0,
    PDNG: 1,
    RJCT: 0,
    SCHD: 0,
    UNKNOWN: 2,
  });
  assert.deepEqual(all.totals_by_status!.PDNG, [
    { currency: "EUR", count: 1, debit: "0.10", credit: "0", net: "-0.10" },
  ]);
  assert.equal(run(rows, { status: "UNKNOWN" }).matched_count, 2);
  assert.equal(run(rows, { status: "HOLD" }).matched_count, 1);
  assert.equal(JSON.stringify(all).includes("surprise-private-status"), false);
  assert.throws(() => run(rows, { status: "PRIVATE" }), /Invalid transaction/);
});

test("cursor rejects a pending to booked transition and status filters cannot change", () => {
  const rows = Array.from({ length: 51 }, (_, i) => transaction(i));
  rows.push(transaction(99, { status: "PDNG" }));
  const first = run(rows);
  assert.throws(
    () =>
      run(
        rows.map((row) => ({ ...row, status: "BOOK" })),
        { cursor: first.next_cursor },
      ),
    /changed/,
  );
  assert.throws(
    () => run(rows, { cursor: first.next_cursor, status: "all" }),
    /filters differ/,
  );
});

test("zero amount is only a flag, and only self-describing bank codes hint refund or reversal", () => {
  const rows = [
    transaction(0, { transaction_amount: { amount: "0.00", currency: "EUR" } }),
    transaction(1, { credit_debit_indicator: "CRDT" }),
    transaction(2, { bank_transaction_code: { code: "CARD_REFUND" } }),
    transaction(3, { bank_transaction_code: { sub_code: "REVERSAL" } }),
    transaction(4, {
      bank_transaction_code: {
        code: "12",
        description: "Refund",
        sub_code: "32",
      },
    }),
  ];
  const result = run(rows).transactions!;
  assert.equal(result.filter((row) => row.zero_amount).length, 1);
  assert.equal(result.find((row) => row.zero_amount)!.event_kind, "unknown");
  assert.equal(result.find((row) => row.amount > 0)!.event_kind, "unknown");
  assert.equal(result.filter((row) => row.event_kind === "refund").length, 1);
  assert.equal(result.filter((row) => row.event_kind === "reversal").length, 1);
});
