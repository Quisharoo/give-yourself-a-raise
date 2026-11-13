import { z } from "zod";
import { createHash } from "node:crypto";
import {
  formatDecimal,
  transactionMoney,
  transactionEventKind,
  compareDecimal,
  parseDecimal,
} from "@/lib/transactions";
import type { EnableBankingTransaction } from "@/lib/enable-banking/types";
import {
  AMBIGUOUS_FAMILIES,
  detectMerchantFamily,
  getRuleCategory,
} from "@/lib/analysis/rules";
import type {
  TransactionClassification,
  CategoryKey,
  Confidence,
  FlowKind,
} from "@/lib/analysis/types";

export const ECONOMIC_FLOWS = [
  "expense",
  "income",
  "revenue",
  "refund",
  "transfer",
  "unknown",
] as const;
export const PURPOSES = ["business", "personal", "unassigned"] as const;
export const financialRuleSchema = z.object({
  id: z.string(),
  priority: z.number().int(),
  merchant_key: z.string(),
  direction: z.enum(["debit", "credit", "either"]),
  except_amount: z
    .object({
      currency: z.string().regex(/^[A-Z]{3}$/),
      amount: z.string().regex(/^\d+(?:\.\d+)?$/),
    })
    .nullable(),
  purpose: z.enum(PURPOSES),
  project: z.string().nullable(),
  flow_kind: z.enum(ECONOMIC_FLOWS).nullable(),
});
export type FinancialRule = z.infer<typeof financialRuleSchema>;
export const financialFilterShape = {
  purpose: z.enum(PURPOSES).optional(),
  project: z.string().min(1).max(100).optional(),
  flow_kind: z.enum(ECONOMIC_FLOWS).optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
};
export type FinancialFilter = z.infer<typeof financialFiltersSchema>;
export const financialFiltersSchema = z.object(financialFilterShape);
export interface NormalizedTransaction {
  absAmount: number;
  accountId: string;
  classification: TransactionClassification;
  currency: string;
  date: string;
  description: string;
  merchant: string;
  signedAmount: number;
  transaction: EnableBankingTransaction;
  amountDecimal: string;
  merchantKey: string;
  rawDescriptor: string;
  sourceKey: string;
  economicFlow: (typeof ECONOMIC_FLOWS)[number];
  purpose: (typeof PURPOSES)[number];
  project: string | null;
  matchedRuleId: string | null;
}
export function matchesFinancialFilter(
  row: NormalizedTransaction,
  filter?: FinancialFilter,
) {
  return (
    !filter ||
    ((!filter.purpose || row.purpose === filter.purpose) &&
      (!filter.project || row.project === filter.project) &&
      (!filter.flow_kind || row.economicFlow === filter.flow_kind) &&
      (!filter.currency || row.currency === filter.currency))
  );
}
const aliases = [
  {
    pattern: /\bapple distribution\b/,
    key: "apple_distribution",
    label: "Apple Distribution",
  },
  {
    pattern: /^(?:apple(?: com)?(?: bill)?|itunes)$/,
    key: "apple",
    label: "Apple",
  },
  {
    pattern: /^(?:apple(?: com)? bill|itunes)(?: |$)/,
    key: "apple",
    label: "Apple",
  },
  {
    pattern: /^(?:(?:awx )?join ?brands?|joinbrands com)(?: |$)/,
    key: "join_brands",
    label: "Join Brands",
  },
  {
    pattern: /^(?:amazon prime|amzn ?prime)(?: |$)/,
    key: "amazon_prime",
    label: "Amazon Prime",
  },
  { pattern: /^(?:amazon|amzn)(?: |$)/, key: "amazon", label: "Amazon" },
];
function merchantIdentity(raw: string) {
  const normalized = normalizeText(raw);
  const alias = aliases.find((entry) => entry.pattern.test(normalized));
  return alias
    ? { key: alias.key, label: alias.label }
    : { key: normalized, label: raw };
}
function safeDescriptor(value: string) {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\b[A-Z]{2}\d{2}[A-Z0-9 ]{10,32}\b/gi, "[redacted]")
    .replace(/\b\d{8,}\b/g, "[redacted]")
    .trim()
    .slice(0, 160);
}
function redactIdentifiers(
  value: string,
  identifiers: Array<string | undefined>,
) {
  for (const identifier of identifiers) {
    if (!identifier) continue;
    const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    value = value.replace(
      new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "g"),
      "[redacted]",
    );
  }
  return value;
}
const internalCodes = new Set([
  "EXCHANGE",
  "SAVINGS",
  "OWN_ACCOUNT",
  "INTERNAL_TRANSFER",
]);
const fundingCodes = new Set(["CARD_TOPUP", "TOPUP", "MONEY_ADDED"]);
const currencies = new Set(
  Intl.supportedValuesOf("currency").map((currency) => currency.toLowerCase()),
);
const internalDescriptors = [
  /^(?:from|to) (?:instant access )?savings$/,
  /^(?:card top ?up|top ?up from (?:card|bank))(?: (?:by |ending (?:in )?)?\d{4})?$/,
  /^(?:internal transfer|own account transfer|transfer (?:to|from) (?:my|own) account)$/,
];
function isInternalMovement(
  transaction: EnableBankingTransaction,
  descriptor: string,
) {
  if (
    internalCodes.has(
      transaction.bank_transaction_code?.code?.toUpperCase() ?? "",
    )
  )
    return true;
  const descriptors = [
    descriptor,
    transaction.note,
    ...(transaction.remittance_information ?? []),
  ];
  return descriptors.some((value) => {
    if (!value) return false;
    const normalized = normalizeText(value);
    const exchange =
      /^(?:to|from|exchanged to|exchanged from) ([a-z]{3})$/.exec(normalized);
    return (
      (exchange !== null && currencies.has(exchange[1])) ||
      internalDescriptors.some((pattern) => pattern.test(normalized))
    );
  });
}
export function normalizeTransaction(
  accountId: string,
  transaction: EnableBankingTransaction,
  rules: readonly FinancialRule[] = [],
): NormalizedTransaction {
  const signedAmount = Number(
    formatDecimal(transactionMoney(transaction).signed),
  );
  const absAmount = Math.abs(signedAmount);
  const rawDescriptor = safeDescriptor(
    redactIdentifiers(deriveMerchantLabel(transaction), [
      accountId,
      transaction.entry_reference,
      transaction.transaction_id,
    ]),
  );
  const identity = merchantIdentity(rawDescriptor);
  const merchant = identity.label;
  const description = normalizeText(
    [merchant, transaction.note, ...(transaction.remittance_information ?? [])]
      .filter(Boolean)
      .join(" "),
  );
  const normalizedMerchant = normalizeText(merchant);
  const merchantFamily =
    identity.key === "apple"
      ? "apple"
      : identity.key === "amazon" || identity.key === "amazon_prime"
        ? "amazon"
        : detectMerchantFamily(`${normalizedMerchant} ${description}`);
  let classification = classifyTransaction(
    transaction,
    signedAmount,
    normalizedMerchant,
    merchant,
    description,
    merchantFamily,
  );

  const event = transactionEventKind(transaction.bank_transaction_code);
  const code = transaction.bank_transaction_code?.code?.toUpperCase();
  const internal = isInternalMovement(transaction, rawDescriptor);
  const funding = fundingCodes.has(code ?? "");
  let economicFlow: NormalizedTransaction["economicFlow"] = internal
    ? "transfer"
    : event === "refund"
      ? "refund"
      : event === "reversal"
        ? "unknown"
        : funding
          ? "transfer"
          : signedAmount > 0
            ? /\b(salary|payroll|wages)\b/.test(description)
              ? "income"
              : "unknown"
            : classification.flowKind === "unknown"
              ? "unknown"
              : "expense";
  const rule = [...rules]
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
    .find(
      (candidate) =>
        candidate.merchant_key === identity.key &&
        (candidate.direction === "either" ||
          candidate.direction ===
            (transaction.credit_debit_indicator === "DBIT" ? "debit" : "credit")) &&
        !(
          candidate.except_amount &&
          candidate.except_amount.currency ===
            transaction.transaction_amount.currency &&
          compareDecimal(
            parseDecimal(candidate.except_amount.amount),
            transactionMoney(transaction).magnitude,
          ) === 0
        ),
    );
  if (
    !internal &&
    rule?.flow_kind &&
    event !== "refund" &&
    event !== "reversal"
  )
    economicFlow = rule.flow_kind;
  if (funding && !internal && !rule?.flow_kind && economicFlow === "transfer")
    classification = {
      ...classification,
      confidence: "low",
      source: "heuristic",
      reason:
        "Generic funding code treated as a transfer without an explicit flow rule.",
    };
  if (economicFlow === "transfer")
    classification = {
      ...classification,
      flowKind: "wealth_flow",
      categoryKey:
        code === "EXCHANGE" ? "fx_money_movement" : "investment_savings",
    };
  else if (economicFlow !== "expense")
    classification = { ...classification, flowKind: "income_or_refund" };
  else if (classification.flowKind === "unknown")
    classification = { ...classification, flowKind: "behavioural_spend" };
  return {
    amountDecimal: formatDecimal(transactionMoney(transaction).signed),
    merchantKey: identity.key,
    rawDescriptor,
    sourceKey: createHash("sha256")
      .update(
        JSON.stringify([
          accountId,
          transaction.entry_reference ??
            transaction.transaction_id ??
            transaction,
        ]),
      )
      .digest("hex"),
    economicFlow,
    purpose: rule?.purpose ?? "unassigned",
    project: rule?.project ?? null,
    matchedRuleId: rule?.id ?? null,
    absAmount,
    accountId,
    classification,
    currency: transaction.transaction_amount.currency,
    date:
      transaction.booking_date ||
      transaction.value_date ||
      transaction.transaction_date ||
      "0000-00-00",
    description,
    merchant,
    signedAmount,
    transaction,
  };
}

function classifyTransaction(
  transaction: EnableBankingTransaction,
  signedAmount: number,
  normalizedMerchant: string,
  merchant: string,
  description: string,
  merchantFamily?: string,
): TransactionClassification {
  const bankCode =
    transaction.bank_transaction_code?.code?.toUpperCase() || "UNKNOWN";
  const haystack = `${normalizedMerchant} ${description}`.trim();

  if (signedAmount > 0) {
    return {
      categoryKey: "uncategorized",
      confidence: "medium",
      flowKind: "income_or_refund",
      merchantFamily,
      merchantLabel: merchant,
      normalizedMerchant,
      reason: "Inbound transaction or refund.",
      source: "heuristic",
    };
  }

  if (bankCode === "EXCHANGE") {
    return buildClassification(
      "wealth_flow",
      "fx_money_movement",
      "high",
      merchantFamily,
      merchant,
      normalizedMerchant,
      "FX or wallet exchange.",
      "heuristic",
    );
  }

  if (bankCode === "TRANSFER") {
    const fixedTransferCategory = getFixedCostCategory(haystack);
    if (fixedTransferCategory) {
      return buildClassification(
        "fixed_cost",
        fixedTransferCategory,
        "high",
        merchantFamily,
        merchant,
        normalizedMerchant,
        "Recurring baseline transfer-like outflow.",
        "rule",
      );
    }

    return buildClassification(
      "unknown",
      "uncategorized",
      "low",
      merchantFamily,
      merchant,
      normalizedMerchant,
      "Transfer not safely attributable to discretionary spend.",
      "heuristic",
    );
  }

  if (bankCode === "CHARGE") {
    return buildClassification(
      "fixed_cost",
      "banking_fees",
      "high",
      merchantFamily,
      merchant,
      normalizedMerchant,
      "Banking or platform fee.",
      "rule",
    );
  }

  if (bankCode === "ATM") {
    return buildClassification(
      "behavioural_spend",
      "cash_withdrawal",
      "medium",
      merchantFamily,
      merchant,
      normalizedMerchant,
      "Cash withdrawal.",
      "rule",
    );
  }

  if (bankCode === "CARD_PAYMENT" || bankCode === "UNKNOWN") {
    return classifyCardLikeTransaction(
      haystack,
      merchantFamily,
      merchant,
      normalizedMerchant,
    );
  }

  return buildClassification(
    "unknown",
    "uncategorized",
    "low",
    merchantFamily,
    merchant,
    normalizedMerchant,
    "Unclassified outflow.",
    "heuristic",
  );
}

function classifyCardLikeTransaction(
  haystack: string,
  merchantFamily: string | undefined,
  merchant: string,
  normalizedMerchant: string,
): TransactionClassification {
  const fixedCostCategory = getFixedCostCategory(haystack);
  if (fixedCostCategory) {
    return buildClassification(
      "fixed_cost",
      fixedCostCategory,
      "high",
      merchantFamily,
      merchant,
      normalizedMerchant,
      "Merchant matched fixed-cost rules.",
      "rule",
    );
  }

  const ruleCategory = getRuleCategory(haystack);
  if (ruleCategory) {
    return buildClassification(
      "behavioural_spend",
      ruleCategory,
      "high",
      merchantFamily,
      merchant,
      normalizedMerchant,
      "Merchant matched category rules.",
      "rule",
    );
  }

  if (merchantFamily && AMBIGUOUS_FAMILIES.includes(merchantFamily)) {
    const categoryKey =
      merchantFamily === "apple" || merchantFamily === "google"
        ? "uncertain_digital"
        : "uncertain_shopping";

    return buildClassification(
      "behavioural_spend",
      categoryKey,
      "low",
      merchantFamily,
      merchant,
      normalizedMerchant,
      "Ambiguous merchant family kept broad on purpose.",
      "family",
    );
  }

  return buildClassification(
    "behavioural_spend",
    "uncategorized",
    "low",
    merchantFamily,
    merchant,
    normalizedMerchant,
    "No confident merchant rule matched.",
    "heuristic",
  );
}

function getFixedCostCategory(text: string): CategoryKey | null {
  if (containsAny(text, ["mortgage", "rent", "housing"])) {
    return "housing";
  }

  if (
    containsAny(text, [
      "yuno energy",
      "virgin media",
      "moco",
      "utility",
      "electric",
      "gas",
      "broadband",
    ])
  ) {
    return "utilities";
  }

  if (containsAny(text, ["plan fee", "premium repricing"])) {
    return "banking_fees";
  }

  return null;
}

function deriveMerchantLabel(transaction: EnableBankingTransaction) {
  if (transaction.credit_debit_indicator === "DBIT") {
    return (
      transaction.creditor?.name ||
      transaction.remittance_information?.[0] ||
      transaction.note ||
      "Unknown"
    );
  }

  return (
    transaction.debtor?.name ||
    transaction.remittance_information?.[0] ||
    transaction.note ||
    "Unknown"
  );
}

function buildClassification(
  flowKind: FlowKind,
  categoryKey: CategoryKey,
  confidence: Confidence,
  merchantFamily: string | undefined,
  merchantLabel: string,
  normalizedMerchant: string,
  reason: string,
  source: "family" | "heuristic" | "rule",
): TransactionClassification {
  return {
    categoryKey,
    confidence,
    flowKind,
    merchantFamily,
    merchantLabel,
    normalizedMerchant,
    reason,
    source,
  };
}

function containsAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
