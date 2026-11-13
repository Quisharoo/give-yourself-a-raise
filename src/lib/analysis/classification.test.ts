import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTransaction, type FinancialRule } from "./classification";
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
  ["Apple.com/bill", "9.99", "EUR", "apple", "personal", null],
  ["Apple.com/bill", "9.990", "EUR", "apple", "personal", null],
  ["Apple.com/bill", "9.99", "USD", "apple", "business", "INCREMNT"],
  ["Apple.com/bill", "19.99", "EUR", "apple", "business", "INCREMNT"],
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

test("owner payout rules identify external revenue carried by a generic funding code", () => {
  const payout = {
    ...row("Apple Distribution International", "100", "EUR", "CRDT", "TOPUP"),
    bank_transaction_code: { code: "TOPUP", sub_code: null },
  };
  const result = normalizeTransaction("a", payout, INITIAL_OWNER_RULES);
  assert.equal(result.matchedRuleId, "owner-apple-distribution");
  assert.equal(result.purpose, "business");
  assert.equal(result.project, "INCREMNT");
  assert.equal(result.economicFlow, "revenue");
});

test("zero-amount rules use bank direction and preserve the zero amount", () => {
  const debit = normalizeTransaction(
    "a",
    row("Join Brands", "0.00"),
    INITIAL_OWNER_RULES,
  );
  assert.equal(debit.purpose, "business");
  assert.equal(debit.project, "INCREMNT");
  assert.equal(debit.matchedRuleId, "owner-join-brands");
  assert.equal(debit.economicFlow, "expense");
  assert.equal(debit.amountDecimal, "0.00");
  const credit = normalizeTransaction(
    "a",
    row("Join Brands", "0.00", "EUR", "CRDT"),
    INITIAL_OWNER_RULES,
  );
  assert.equal(credit.matchedRuleId, null);
});

const externalRule: FinancialRule = {
  id: "custom-marketplace-revenue",
  priority: 100,
  merchant_key: "independent marketplace",
  direction: "credit",
  except_amount: null,
  purpose: "business",
  project: "Other project",
  flow_kind: "revenue",
};

for (const code of ["TOPUP", "CARD_TOPUP", "MONEY_ADDED"]) {
  for (const [sub_code, expected] of [
    ["REFUND", "refund"],
    ["REVERSAL", "unknown"],
  ])
    test(`${code} ${sub_code} takes precedence over funding defaults and flow rules`, () => {
      const transaction = {
        ...row("Independent Marketplace", "15.25", "EUR", "CRDT", code),
        bank_transaction_code: { code, sub_code },
      };
      for (const rules of [[], [externalRule]]) {
        const result = normalizeTransaction("a", transaction, rules);
        assert.equal(result.economicFlow, expected);
        assert.doesNotMatch(result.classification.reason, /funding/i);
      }
    });
  test(`${code} permits an explicit external flow rule without a merchant-specific branch`, () => {
    const transaction = row(
      "Independent Marketplace",
      "15.25",
      "EUR",
      "CRDT",
      code,
    );
    const before = normalizeTransaction("a", transaction);
    for (const flow_kind of ["revenue", "income"] as const) {
      const result = normalizeTransaction("a", transaction, [
        { ...externalRule, flow_kind },
      ]);
      assert.equal(result.economicFlow, flow_kind);
      assert.equal(result.matchedRuleId, externalRule.id);
      assert.equal(result.sourceKey, before.sourceKey);
    }
  });
  for (const direction of ["DBIT", "CRDT"] as const)
    test(`${code} ${direction} without an explicit flow rule remains a heuristic transfer`, () => {
      const transaction = row(
        "Independent Marketplace",
        "15.25",
        "EUR",
        direction,
        code,
      );
      for (const rules of [
        [],
        [{ ...externalRule, direction: "either" as const, flow_kind: null }],
      ]) {
        const result = normalizeTransaction("a", transaction, rules);
        assert.equal(result.economicFlow, "transfer");
        assert.equal(result.classification.flowKind, "wealth_flow");
        assert.equal(result.classification.source, "heuristic");
        assert.equal(result.classification.confidence, "low");
        assert.match(result.classification.reason, /funding/i);
      }
    });
}

for (const code of ["EXCHANGE", "OWN_ACCOUNT", "INTERNAL_TRANSFER", "SAVINGS"])
  test(`${code} cannot be overridden by an explicit external revenue rule`, () => {
    const result = normalizeTransaction(
      "a",
      row("Independent Marketplace", "15.25", "EUR", "CRDT", code),
      [externalRule],
    );
    assert.equal(result.matchedRuleId, externalRule.id);
    assert.equal(result.economicFlow, "transfer");
  });

for (const descriptor of [
  "To EUR",
  "From Instant Access Savings",
  "Card top-up",
  "Own account transfer",
])
  for (const field of ["note", "remittance_information"] as const)
    test(`confirmed ${field} ${descriptor} protects TOPUP from an external revenue rule`, () => {
      const transaction = row(
        "Independent Marketplace",
        "15.25",
        "EUR",
        "CRDT",
        "TOPUP",
      );
      if (field === "note") transaction.note = descriptor;
      else transaction.remittance_information = [descriptor];
      const result = normalizeTransaction("a", transaction, [externalRule]);
      assert.equal(result.matchedRuleId, externalRule.id);
      assert.equal(result.economicFlow, "transfer");
    });

test("seeded aliases keep owner labels separate from canonical merchant names", () => {
  for (const [descriptor, merchant] of [
    ["Openai *chatgpt Subscr", "ChatGPT"],
    ["OpenRouter", "OpenRouter"],
    ["Render.com", "Render"],
    ["Register365", "Register365"],
    ["Hetzner", "Hetzner"],
    ["Vercel Mkt Upstash", "Upstash"],
    ["Vercel", "Vercel"],
    ["Cursor", "Cursor"],
    ["Lovable", "Lovable"],
    ["Intellectual Property Off", "Intellectual Property Office"],
    ["Companies Registration Of", "Companies Registration Office"],
  ]) {
    const unlabeled = normalizeTransaction("account", row(descriptor));
    assert.equal(unlabeled.merchant, merchant);
    assert.equal(unlabeled.purpose, "unassigned");
    const labeled = normalizeTransaction(
      "account",
      row(descriptor),
      INITIAL_OWNER_RULES,
    );
    assert.equal(labeled.purpose, "business");
    assert.equal(labeled.project, "INCREMNT");
    assert.equal(labeled.economicFlow, "expense");
  }
  assert.equal(
    normalizeTransaction(
      "account",
      row("apple.com/bill", "0"),
      INITIAL_OWNER_RULES,
    ).purpose,
    "unassigned",
  );
  assert.equal(
    normalizeTransaction("account", row("Amazon Prime"), INITIAL_OWNER_RULES)
      .matchedRuleId,
    "owner-amazon-prime",
  );
  for (const descriptor of [
    "Wl*google Google Play A",
    "Exchanged to USD",
    "Kevin Byrne",
    "Paul Michael McCarthy",
  ])
    assert.equal(
      normalizeTransaction("account", row(descriptor), INITIAL_OWNER_RULES)
        .purpose,
      "personal",
    );
});

test("literal merchant rules honor exact amount, direction, account, priority and zero constraints", async () => {
  const { financialRuleSchema } = await import("./classification");
  const rule = financialRuleSchema.parse({
    id: "one-merchant",
    priority: 200,
    merchant_text: "*chatgpt",
    direction: "debit",
    except_amount: null,
    exact_amount: { currency: "EUR", amount: "10.00" },
    zero_amount: false,
    purpose: "personal",
    project: null,
    flow_kind: "expense",
  });
  assert.equal(
    normalizeTransaction("account", row("Openai *chatgpt Subscr"), [rule])
      .purpose,
    "personal",
  );
  assert.equal(
    normalizeTransaction("account", row("Openai chatgpt Subscr"), [rule])
      .purpose,
    "unassigned",
  );
  assert.equal(
    normalizeTransaction(
      "account",
      row("Openai *chatgpt Subscr", "10", "USD"),
      [rule],
    ).purpose,
    "unassigned",
  );
  assert.equal(
    normalizeTransaction(
      "account",
      row("Openai *chatgpt Subscr", "10", "EUR", "CRDT"),
      [rule],
    ).purpose,
    "unassigned",
  );
  assert.equal(
    normalizeTransaction("account", row("Openai *chatgpt Subscr", "0"), [rule])
      .purpose,
    "unassigned",
  );
  const tied = { ...rule, id: "a-first", purpose: "business" as const };
  assert.equal(
    normalizeTransaction("account", row("Openai *chatgpt Subscr"), [rule, tied])
      .matchedRuleId,
    "a-first",
  );
  assert.equal(
    financialRuleSchema.safeParse({ ...rule, merchant_text: undefined })
      .success,
    false,
  );
});

test("one-off overrides protect financial events and ambiguous bank identities", async () => {
  const { normalizeAccountTransactions } = await import("./classification");
  const originalKey = process.env.BANK_CONNECTION_ENCRYPTION_KEY;
  process.env.BANK_CONNECTION_ENCRYPTION_KEY = Buffer.alloc(32, 19).toString(
    "base64",
  );
  try {
    const account = {
      accountId: "rotating-account",
      stableIdentity: "bank-hash",
      balances: [],
      transactions: [{ ...row("Amazon"), entry_reference: "entry-one" }],
    };
    const snapshot = {
      subject: "owner",
      rules: INITIAL_OWNER_RULES,
      overrides: [],
    };
    const original = normalizeAccountTransactions(account, snapshot)[0];
    assert(original.transactionRef);
    assert.equal(original.overrideSupported, true);
    const labels = {
      transaction_ref: original.transactionRef,
      purpose: "business" as const,
      project: "INCREMNT",
      flow_kind: "expense" as const,
    };
    const input = { ...snapshot, overrides: [labels] };
    assert.equal(
      normalizeAccountTransactions(account, input)[0].purpose,
      "business",
    );
    const amazonRule = INITIAL_OWNER_RULES.find((rule) => rule.id === "owner-amazon");
    assert(amazonRule);
    const transferRule: FinancialRule = {
      ...amazonRule,
      flow_kind: "transfer",
    };
    for (const code of ["CARD_PAYMENT", "TOPUP"]) {
      const overridden = normalizeAccountTransactions(
        {
          ...account,
          transactions: [{ ...account.transactions[0], bank_transaction_code: { code } }],
        },
        { ...input, rules: code === "CARD_PAYMENT" ? [transferRule] : [] },
      )[0];
      assert.equal(overridden.matchedOverride, true);
      assert.equal(overridden.economicFlow, "expense");
      assert.equal(overridden.classification.flowKind, "behavioural_spend");
    }
    assert.equal(original.overrideReason, null);
    const secondOwner = normalizeAccountTransactions(account, {
      ...input,
      subject: "another-owner",
    })[0];
    assert.notEqual(secondOwner.transactionRef, original.transactionRef);
    assert.equal(secondOwner.purpose, "personal");
    const duplicate = normalizeAccountTransactions(
      {
        ...account,
        transactions: [...account.transactions, ...account.transactions],
      },
      input,
    );
    assert(
      duplicate.every(
        (item) => !item.overrideSupported && item.purpose === "personal",
      ),
    );
    for (const code of ["REFUND", "REVERSAL", "INTERNAL_TRANSFER"]) {
      const transaction = {
        ...row(
          "Amazon",
          "10",
          "EUR",
          code === "REFUND" ? "CRDT" : "DBIT",
          code,
        ),
        entry_reference: "entry-one",
      };
      const classified = normalizeAccountTransactions(
        { ...account, transactions: [transaction] },
        input,
      )[0];
      assert.equal(
        classified.economicFlow,
        code === "REFUND"
          ? "refund"
          : code === "REVERSAL"
            ? "unknown"
            : "transfer",
      );
    }
    assert.equal(
      normalizeAccountTransactions(
        { ...account, stableIdentity: undefined },
        input,
      )[0].overrideSupported,
      false,
    );
    assert.equal(
      normalizeAccountTransactions(
        { ...account, transactions: [row("Amazon")] },
        input,
      )[0].overrideSupported,
      false,
    );
  } finally {
    if (originalKey === undefined)
      delete process.env.BANK_CONNECTION_ENCRYPTION_KEY;
    else process.env.BANK_CONNECTION_ENCRYPTION_KEY = originalKey;
  }
});
