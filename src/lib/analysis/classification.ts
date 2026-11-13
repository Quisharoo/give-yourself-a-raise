import { z } from "zod";
import { createHash } from "node:crypto";
import {
  formatDecimal,
  transactionMoney,
  transactionEventKind,
  compareDecimal,
  parseDecimal,
} from "@/lib/transactions";
import {
  stableRef,
  type TransactionIdentity,
} from "@/lib/transactions-identity";
import type {
  EnableBankingAccountSnapshot,
  EnableBankingTransaction,
} from "@/lib/enable-banking/types";
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
const exactMoneySchema = z
  .object({
    currency: z.string().regex(/^[A-Z]{3}$/),
    amount: z
      .string()
      .regex(/^\d+(?:\.\d+)?$/)
      .max(256),
  })
  .strict();
export const classificationLabelsSchema = z
  .object({
    purpose: z.enum(PURPOSES),
    project: z.string().trim().min(1).max(100).nullable(),
    flow_kind: z.enum(ECONOMIC_FLOWS).nullable(),
  })
  .strict();
export const transactionOverrideSchema = classificationLabelsSchema
  .extend({ transaction_ref: z.string().regex(/^txn_[A-Za-z0-9_-]{43}$/) })
  .strict();
export type TransactionOverride = z.infer<typeof transactionOverrideSchema>;
export interface ClassificationSnapshot {
  subject: string;
  rules: readonly FinancialRule[];
  overrides: readonly TransactionOverride[];
}
export type ClassificationInput =
  readonly FinancialRule[] | ClassificationSnapshot;
export const financialRuleSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
    priority: z.number().int().min(-100000).max(100000),
    merchant_key: z.string().trim().min(1).max(200).optional(),
    merchant_text: z.string().trim().min(1).max(200).optional(),
    exact_amount: exactMoneySchema.optional(),
    account_ref: z
      .string()
      .regex(/^acc_[A-Za-z0-9_-]{43}$/)
      .optional(),
    zero_amount: z.boolean().optional(),
    direction: z.enum(["debit", "credit", "either"]),
    except_amount: exactMoneySchema.nullable(),
    purpose: z.enum(PURPOSES),
    project: z.string().trim().min(1).max(100).nullable(),
    flow_kind: z.enum(ECONOMIC_FLOWS).nullable(),
  })
  .strict()
  .refine(
    (rule) =>
      rule.merchant_key !== undefined || rule.merchant_text !== undefined,
    "A merchant_key or merchant_text is required.",
  );
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
  transactionRef: string | null;
  overrideSupported: boolean;
  overrideReason: string | null;
  identityEvidence: string | null;
  matchedOverride: boolean;
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
  {
    pattern: /^(?:openai chatgpt|openai chatgpt subscr)(?: |$)/,
    key: "openai_chatgpt",
    label: "ChatGPT",
  },
  { pattern: /^(?:openrouter)(?: |$)/, key: "openrouter", label: "OpenRouter" },
  { pattern: /^(?:render com|render)(?: |$)/, key: "render", label: "Render" },
  {
    pattern: /^(?:register365)(?: |$)/,
    key: "register365",
    label: "Register365",
  },
  { pattern: /^(?:hetzner)(?: |$)/, key: "hetzner", label: "Hetzner" },
  {
    pattern: /^(?:vercel mkt upstash|upstash)(?: |$)/,
    key: "upstash",
    label: "Upstash",
  },
  { pattern: /^(?:vercel)(?: |$)/, key: "vercel", label: "Vercel" },
  { pattern: /^(?:cursor)(?: |$)/, key: "cursor", label: "Cursor" },
  { pattern: /^(?:lovable)(?: |$)/, key: "lovable", label: "Lovable" },
  {
    pattern: /^(?:intellectual property off(?:ice)?)(?: |$)/,
    key: "intellectual_property_office",
    label: "Intellectual Property Office",
  },
  {
    pattern: /^(?:companies registration of(?:fice)?)(?: |$)/,
    key: "companies_registration_office",
    label: "Companies Registration Office",
  },
  {
    pattern: /^(?:wl google google play a|google play)(?: |$)/,
    key: "google_play",
    label: "Google Play",
  },
  {
    pattern: /^(?:exchanged to usd)$/,
    key: "exchanged_to_usd",
    label: "Exchanged to USD",
  },
  { pattern: /^(?:kevin byrne)$/, key: "kevin_byrne", label: "Kevin Byrne" },
  {
    pattern: /^(?:paul michael mccarthy)$/,
    key: "paul_michael_mccarthy",
    label: "Paul Michael McCarthy",
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
  input: ClassificationInput = [],
  context?: TransactionIdentity & { accountRef: string | null },
): NormalizedTransaction {
  const rules = "rules" in input ? input.rules : input;
  const override =
    context?.supported && "overrides" in input
      ? input.overrides.find((item) => item.transaction_ref === context.ref)
      : undefined;
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
        (candidate.merchant_text
          ? rawDescriptor
              .toLowerCase()
              .includes(candidate.merchant_text.toLowerCase())
          : candidate.merchant_key === identity.key) &&
        (!candidate.account_ref ||
          candidate.account_ref === context?.accountRef) &&
        (candidate.zero_amount === undefined ||
          candidate.zero_amount ===
            (transactionMoney(transaction).magnitude.coefficient ===
              BigInt(0))) &&
        (!candidate.exact_amount ||
          (candidate.exact_amount.currency ===
            transaction.transaction_amount.currency &&
            compareDecimal(
              parseDecimal(candidate.exact_amount.amount),
              transactionMoney(transaction).magnitude,
            ) === 0)) &&
        (candidate.direction === "either" ||
          candidate.direction ===
            (transaction.credit_debit_indicator === "DBIT"
              ? "debit"
              : "credit")) &&
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
  if (
    override?.flow_kind &&
    economicFlow !== "transfer" &&
    event !== "refund" &&
    event !== "reversal"
  )
    economicFlow = override.flow_kind;
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
    transactionRef: context?.ref ?? null,
    overrideSupported: context?.supported ?? false,
    overrideReason: context?.reason ?? "stable_account_identity_unavailable",
    identityEvidence: context?.evidence ?? null,
    matchedOverride: override !== undefined,
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
    purpose: override?.purpose ?? rule?.purpose ?? "unassigned",
    project: override ? override.project : (rule?.project ?? null),
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

export function normalizeAccountTransactions(
  account: EnableBankingAccountSnapshot,
  input: ClassificationInput = [],
) {
  const subject = "subject" in input ? input.subject : null;
  const keys = account.transactions.map((row) =>
    row.entry_reference?.trim()
      ? ["entry", row.entry_reference]
      : row.transaction_id?.trim()
        ? ["transaction", row.transaction_id]
        : null,
  );
  const counts = new Map<string, number>();
  for (const key of keys)
    if (key) {
      const value = JSON.stringify(key);
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  const accountReference =
    subject && account.stableIdentity
      ? stableRef(subject, "acc", account.stableIdentity)
      : (account.classificationAccountRef ?? null);
  return account.transactions.map((transaction, index) => {
    const key = keys[index];
    let supported = Boolean(
      subject &&
      account.stableIdentity &&
      key &&
      counts.get(JSON.stringify(key)) === 1,
    );
    const ref =
      subject && account.stableIdentity && key
        ? stableRef(
            subject,
            "txn",
            JSON.stringify([account.stableIdentity, key]),
          )
        : null;
    if (ref && account.unsupportedTransactionRefs?.includes(ref))
      supported = false;
    const evidence = ref
      ? createHash("sha256")
          .update(
            JSON.stringify([
              transaction.transaction_amount,
              transaction.credit_debit_indicator,
              transaction.booking_date ??
                transaction.value_date ??
                transaction.transaction_date,
              transaction.creditor?.name ?? transaction.debtor?.name ?? null,
            ]),
          )
          .digest("hex")
      : null;
    return normalizeTransaction(account.accountId, transaction, input, {
      accountRef: accountReference,
      ref,
      supported,
      evidence,
      reason: supported
        ? null
        : !account.stableIdentity
          ? "stable_account_identity_unavailable"
          : !key
            ? "bank_transaction_identity_unavailable"
            : account.unsupportedTransactionRefs?.includes(ref ?? "")
              ? "conflicting_bank_identity"
              : "duplicate_bank_identity",
    });
  });
}
