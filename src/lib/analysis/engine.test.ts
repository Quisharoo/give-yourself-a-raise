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
