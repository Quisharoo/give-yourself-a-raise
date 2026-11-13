import assert from "node:assert/strict";
import test from "node:test";

import { analyzeSpending } from "./engine.ts";
import type { EnableBankingAccountSnapshot } from "../enable-banking/types.ts";

const accounts: EnableBankingAccountSnapshot[] = [
  {
    accountId: "not-returned-to-chatgpt",
    balances: [],
    transactions: [
      {
        status: "BOOK",
        bank_transaction_code: { code: "CARD_PAYMENT" },
        booking_date: "2026-08-01",
        credit_debit_indicator: "DBIT",
        creditor: { name: "Coffee kiosk" },
        transaction_amount: { amount: "30", currency: "EUR" },
      },
    ],
  },
];

test("normalizes monthly spending using the requested analysis window", () => {
  const thirtyDays = analyzeSpending(accounts, { windowDays: 30 });
  const ninetyDays = analyzeSpending(accounts, { windowDays: 90 });

  assert.equal(thirtyDays.baseline?.discretionaryMonthlySpend, 30);
  assert.equal(ninetyDays.baseline?.discretionaryMonthlySpend, 10);
});

test("monthly estimates exclude all non-booked statuses and normalize CRDT negative provider amounts as credit", () => {
  const booked = accounts[0].transactions[0];
  const rows = [
    booked,
    ...[
      "PDNG",
      "HOLD",
      "CNCL",
      "OTHR",
      "RJCT",
      "SCHD",
      undefined,
      "bank-specific",
    ].map((status) => ({ ...booked, status })),
    {
      ...booked,
      credit_debit_indicator: "CRDT" as const,
      transaction_amount: { amount: "-1.20", currency: "EUR" },
    },
  ];
  const result = analyzeSpending([{ ...accounts[0], transactions: rows }], {
    windowDays: 30,
  });
  assert.equal(result.baseline?.discretionaryMonthlySpend, 30);
  assert.equal(result.debugCounts.excludedNonBookedTransactions, 8);
  assert.equal(result.debugCounts.statusCounts?.UNKNOWN, 2);
  assert.equal(result.debugCounts.totalTransactions, 2);
  assert.match(result.estimate!, /Monthly projections/);
});
