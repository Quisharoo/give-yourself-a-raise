import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTransaction } from "./classification";
import { INITIAL_OWNER_RULES } from "./rule-store";
import type { EnableBankingTransaction } from "../enable-banking/types";

function row(
  merchant: string,
  amount = "10.00",
  currency = "EUR",
  direction: "DBIT" | "CRDT" = "DBIT",
  code = "CARD_PAYMENT",
): EnableBankingTransaction {
  return {
    status: "BOOK",
    booking_date: "2026-11-01",
    credit_debit_indicator: direction,
    creditor: { name: merchant },
    debtor: { name: merchant },
    transaction_amount: { amount, currency },
    bank_transaction_code: { code },
  };
}
const cases = [
  ["Apple.com/bill", "9.99", "EUR", "apple", "unassigned", null],
  ["Apple.com/bill", "9.990", "EUR", "apple", "unassigned", null],
  ["Apple.com/bill", "9.99", "USD", "apple", "business", null],
  ["Apple.com/bill", "19.99", "EUR", "apple", "business", null],
  ["Applegreen", "19.99", "EUR", "applegreen", "unassigned", null],
  ["Awx*JoinBrands", "20", "EUR", "join_brands", "business", "INCREMNT"],
  ["Join Brands", "20", "EUR", "join_brands", "business", "INCREMNT"],
  ["Joinbrands.com", "20", "EUR", "join_brands", "business", "INCREMNT"],
  ["Amazon*marketplace", "30", "EUR", "amazon", "personal", null],
  ["Amznprime*subscription", "30", "EUR", "amazon_prime", "personal", null],
] as const;
for (const [merchant, amount, currency, key, purpose, project] of cases)
  test(`classifies ${merchant} ${currency}${amount} with exact owner rules`, () => {
    const result = normalizeTransaction(
      "private-account",
      row(merchant, amount, currency),
      INITIAL_OWNER_RULES,
    );
    assert.equal(result.merchantKey, key);
    assert.equal(result.purpose, purpose);
    assert.equal(result.project, project);
    assert.equal(result.rawDescriptor, merchant);
    assert.equal(result.economicFlow, "expense");
    if (merchant === "Applegreen")
      assert.notEqual(result.classification.merchantFamily, "apple");
  });
for (const direction of ["DBIT", "CRDT"] as const)
  for (const [merchant, code] of [
    ["To EUR", "TRANSFER"],
    ["From Instant Access Savings", "TRANSFER"],
    ["Card top-up", "CARD_PAYMENT"],
    ["FX wallet", "EXCHANGE"],
    ["Savings", "SAVINGS"],
  ])
    test(`confirmed internal ${merchant} ${direction} never enters income or expenses`, () => {
      const result = normalizeTransaction(
        "private-account",
        row(merchant, "100", "EUR", direction, code),
        INITIAL_OWNER_RULES,
      );
      assert.equal(result.economicFlow, "transfer");
      assert.equal(result.classification.flowKind, "wealth_flow");
    });
test("external payout, salary, refunds and unidentified credits retain separate economic meanings", () => {
  assert.equal(
    normalizeTransaction(
      "a",
      row("Apple Distribution International", "100", "EUR", "CRDT", "TRANSFER"),
      INITIAL_OWNER_RULES,
    ).economicFlow,
    "revenue",
  );
  assert.equal(
    normalizeTransaction("a", row("Salary", "100", "EUR", "CRDT", "TRANSFER"))
      .economicFlow,
    "income",
  );
  assert.equal(
    normalizeTransaction("a", row("Somebody", "100", "EUR", "CRDT", "TRANSFER"))
      .economicFlow,
    "unknown",
  );
  assert.equal(
    normalizeTransaction("a", row("Somebody", "100", "EUR", "CRDT"))
      .economicFlow,
    "unknown",
  );
  assert.equal(
    normalizeTransaction(
      "a",
      row("Apple Distribution", "100", "EUR", "CRDT", "REFUND"),
      INITIAL_OWNER_RULES,
    ).economicFlow,
    "refund",
  );
  assert.equal(
    normalizeTransaction("a", row("Mobile top up", "10")).economicFlow,
    "expense",
  );
});
test("owner preferences do not apply without the owner's persisted rules and cannot override confirmed transfers", () => {
  assert.equal(
    normalizeTransaction("a", row("Apple.com/bill", "20")).purpose,
    "unassigned",
  );
  const transfer = normalizeTransaction(
    "a",
    row("Apple Distribution", "20", "EUR", "CRDT", "EXCHANGE"),
    INITIAL_OWNER_RULES,
  );
  assert.equal(transfer.economicFlow, "transfer");
});
test("raw labels are bounded and strip control characters and IBANs", () => {
  const result = normalizeTransaction(
    "private-account",
    row("Merchant\nIE64IRCE92050112345678 " + "long ".repeat(100)),
  );
  assert.ok(result.rawDescriptor.length <= 160);
  assert.doesNotMatch(result.rawDescriptor, /IE64IRCE|\n/);
});

test("generic transfer notes cannot establish an internal movement", () => {
  const salary = {
    ...row("Salary", "100", "EUR", "CRDT", "TRANSFER"),
    note: "Monthly salary auto savings",
  };
  assert.equal(normalizeTransaction("a", salary).economicFlow, "income");
  for (const note of [
    "Payment to european contractor",
    "Investment advisory services",
    "Monthly payment to savings consultant",
  ]) {
    const external = {
      ...row("Supplier", "100", "EUR", "DBIT", "TRANSFER"),
      note,
    };
    assert.equal(normalizeTransaction("a", external).economicFlow, "unknown");
    assert.notEqual(
      normalizeTransaction("a", external).classification.flowKind,
      "wealth_flow",
    );
  }
  const payout = {
    ...row("Apple Distribution", "100", "EUR", "CRDT", "TRANSFER"),
    note: "Investment advisory services",
  };
  assert.equal(
    normalizeTransaction("a", payout, INITIAL_OWNER_RULES).economicFlow,
    "revenue",
  );
});
