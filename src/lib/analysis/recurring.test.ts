import assert from "node:assert/strict";
import test from "node:test";
import { addCalendarMonths, detectRecurring } from "./recurring";
import type { EnableBankingAccountSnapshot } from "../enable-banking/types";
import type { TransactionReadEvidence } from "../banking/reader";
import { accountRef } from "../mcp/transaction-query";
const scope = { subject: "owner", sessionId: "private-session" };
const now = Date.parse("2026-11-13T12:00:00Z");
function accounts(
  dates: string[],
  amounts = dates.map(() => "9.99"),
): EnableBankingAccountSnapshot[] {
  return [
    {
      accountId: "private-account",
      balances: [],
      transactions: dates.map((date, index) => ({
        booking_date: date,
        status: "BOOK",
        creditor: { name: "A recurring merchant" },
        credit_debit_indicator: "DBIT",
        transaction_amount: { amount: amounts[index], currency: "EUR" },
        bank_transaction_code: { code: "CARD_PAYMENT" },
      })),
    },
  ];
}
function evidence(
  overrides: Partial<TransactionReadEvidence["coverage"]> = {},
): TransactionReadEvidence[] {
  return [
    {
      account_ref: accountRef(scope, "private-account"),
      coverage: {
        date_from: "2025-11-12",
        date_to: "2026-11-13",
        status: "all",
        completed_at: new Date(now).toISOString(),
        returned_count: 3,
        pagination_complete: true,
        history_complete: "unknown",
        earliest_transaction_date: "2026-08-01",
        latest_transaction_date: "2026-10-01",
        latest_booked_transaction_date: "2026-10-01",
        ...overrides,
      },
    },
  ];
}
for (const [cadence, dates, expected] of [
  ["weekly", ["2026-10-01", "2026-10-08", "2026-10-15"], "2026-10-22"],
  ["fortnightly", ["2026-09-01", "2026-09-15", "2026-09-29"], "2026-10-13"],
  ["monthly", ["2026-01-31", "2026-02-28", "2026-03-31"], "2026-04-30"],
  ["quarterly", ["2026-01-31", "2026-04-30", "2026-07-31"], "2026-10-31"],
  ["annual", ["2025-11-01", "2026-11-01"], "2027-11-01"],
] as const)
  test(`infers calendar ${cadence} cadence from observed booked charges`, () => {
    const [result] = detectRecurring(
      accounts([...dates]),
      [],
      {},
      scope,
      evidence(),
      now,
    );
    assert.equal(result.cadence, cadence);
    assert.equal(result.next_expected_date, expected);
    assert.equal(result.provider_history_complete, "unknown");
  });
test("calendar addition clamps month ends and preserves a leap-day anchor", () => {
  assert.equal(addCalendarMonths("2024-01-31", 1), "2024-02-29");
  assert.equal(addCalendarMonths("2024-02-29", 12), "2025-02-28");
  assert.equal(addCalendarMonths("2025-02-28", 36, 29), "2028-02-29");
});
test("sequential prices remain one bill stream with an exact observed price change", () => {
  const [result] = detectRecurring(
    accounts(
      [
        "2026-05-01",
        "2026-06-01",
        "2026-07-01",
        "2026-08-01",
        "2026-09-01",
        "2026-10-01",
      ],
      ["9.990", "9.99", "9.99", "10.99", "10.99", "10.99"],
    ),
    [],
    {},
    scope,
    evidence(),
    now,
  );
  assert.equal(result.observation_count, 6);
  assert.equal(result.amount_changes.length, 1);
  assert.equal(result.amount_changes[0].difference_decimal, "1.00");
  assert.equal(result.last_amount_decimal, "10.99");
  assert.equal(result.charge_state, "overdue_not_observed");
});
test("concurrent stable bills sharing a merchant are kept separate", () => {
  const result = detectRecurring(
    accounts(
      [
        "2026-08-01",
        "2026-08-15",
        "2026-09-01",
        "2026-09-15",
        "2026-10-01",
        "2026-10-15",
      ],
      ["9.99", "20.00", "9.99", "20.00", "9.99", "20.00"],
    ),
    [],
    {},
    scope,
    evidence(),
    now,
  );
  assert.equal(result.length, 2);
  assert.ok(result.every((row) => row.cadence === "monthly"));
});
test("a coherent monthly bill keeps cycling prices in one stream", () => {
  const result = detectRecurring(
    accounts(
      [
        "2026-01-01",
        "2026-02-01",
        "2026-03-01",
        "2026-04-01",
        "2026-05-01",
        "2026-06-01",
        "2026-07-01",
        "2026-08-01",
        "2026-09-01",
      ],
      ["10", "20", "30", "10", "20", "30", "10", "20", "30"],
    ),
    [],
    {},
    scope,
    evidence(),
    now,
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].cadence, "monthly");
  assert.equal(result[0].next_expected_date, "2026-10-01");
  assert.equal(result[0].amount_change_count, 8);
  assert.deepEqual(
    result[0].amount_changes.map((change) => change.difference_decimal),
    ["10", "10", "-20", "10", "10", "-20", "10", "10"],
  );
});
test("same-date indistinguishable bills stay ambiguous, and one-off merchants are omitted", () => {
  const ambiguous = detectRecurring(
    accounts(["2026-08-01", "2026-08-01", "2026-09-01", "2026-09-01"]),
    [],
    {},
    scope,
    evidence(),
    now,
  );
  assert.equal(ambiguous[0].overdue_not_observed, null);
  assert.equal(ambiguous[0].evidence_reason, "ambiguous_multiple_charges");
  assert.deepEqual(
    detectRecurring(accounts(["2026-08-01"]), [], {}, scope, evidence(), now),
    [],
  );
});
for (const [name, coverage, reason] of [
  ["old last success", { completed_at: "2026-11-01T00:00:00Z" }, "stale_fetch"],
  [
    "historical-only coverage",
    { date_to: "2026-10-31" },
    "insufficient_date_coverage",
  ],
  [
    "coverage starts after missed date",
    { date_from: "2026-11-02" },
    "insufficient_date_coverage",
  ],
  ["wrong status coverage", { status: "PDNG" }, "incompatible_status_coverage"],
] as const)
  test(`suppresses overdue assertions for ${name}`, () => {
    const [result] = detectRecurring(
      accounts(["2026-08-01", "2026-09-01", "2026-10-01"]),
      [],
      {},
      scope,
      evidence(coverage),
      now,
    );
    assert.equal(result.overdue_not_observed, null);
    assert.equal(result.evidence_reason, reason);
  });
test("suppresses overdue assertions without successful request coverage", () => {
  const [result] = detectRecurring(
    accounts(["2026-08-01", "2026-09-01", "2026-10-01"]),
    [],
    {},
    scope,
    [],
    now,
  );
  assert.equal(result.overdue_not_observed, null);
  assert.equal(result.evidence_reason, "fetch_unavailable");
});
test("pending, refunded and reversed charges cannot form recurring evidence", () => {
  const fixture = accounts(["2026-08-01", "2026-09-01", "2026-10-01"]);
  fixture[0].transactions[0].status = "PDNG";
  fixture[0].transactions[1].bank_transaction_code = { code: "REFUND" };
  fixture[0].transactions[2].bank_transaction_code = { code: "REVERSAL" };
  assert.deepEqual(
    detectRecurring(fixture, [], {}, scope, evidence(), now),
    [],
  );
});
test("skipped cycles do not establish an unambiguous cadence", () => {
  const [result] = detectRecurring(
    accounts(["2026-05-01", "2026-06-01", "2026-08-01"]),
    [],
    {},
    scope,
    evidence(),
    now,
  );
  assert.equal(result.cadence, null);
  assert.equal(result.overdue_not_observed, null);
});
