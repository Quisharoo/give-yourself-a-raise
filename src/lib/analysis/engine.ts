import type { EnableBankingAccountSnapshot, EnableBankingTransaction } from "@/lib/enable-banking/types";
import {
  AMBIGUOUS_FAMILIES,
  CATEGORY_LABELS,
  CONTROLLABILITY_SCORES,
  WEALTH_FLOW_KEYWORDS,
  detectMerchantFamily,
  getRuleCategory,
} from "@/lib/analysis/rules";
import type {
  CategoryKey,
  Confidence,
  FlowKind,
  PatternKind,
  SpendingAnalysis,
  TransactionClassification,
} from "@/lib/analysis/types";

interface NormalizedTransaction {
  absAmount: number;
  accountId: string;
  classification: TransactionClassification;
  currency: string;
  date: string;
  description: string;
  merchant: string;
  signedAmount: number;
  transaction: EnableBankingTransaction;
}

interface MerchantAggregate {
  averageSpend: number;
  categoryKey: CategoryKey;
  confidence: Confidence;
  count: number;
  currency: string;
  family?: string;
  label: string;
  monthlySpend: number;
  pattern: PatternKind;
  reason: string;
  sampleAmount: number;
  totalSpend: number;
  transactions: NormalizedTransaction[];
}

const ANALYSIS_WINDOW_DAYS = 90;
const BRIEF_TARGET_RATIO = 0.1;
const ONE_OFF_THRESHOLD = 100;

export function analyzeSpending(accounts: EnableBankingAccountSnapshot[]): SpendingAnalysis {
  const normalized = accounts.flatMap((account) =>
    account.transactions.map((transaction) => normalizeTransaction(account.accountId, transaction)),
  );

  const totalTransactions = normalized.length;
  const behavioural = normalized.filter((transaction) => transaction.classification.flowKind === "behavioural_spend");
  const fixedCost = normalized.filter((transaction) => transaction.classification.flowKind === "fixed_cost");
  const wealthFlow = normalized.filter((transaction) => transaction.classification.flowKind === "wealth_flow");
  const uncertain = behavioural.filter((transaction) => isUncertainCategory(transaction.classification.categoryKey));

  const primaryCurrency = detectPrimaryCurrency(behavioural);
  const otherCurrencies = Array.from(
    new Set(
      behavioural
        .map((transaction) => transaction.currency)
        .filter((currency) => currency && currency !== primaryCurrency),
    ),
  ).sort();

  const primaryBehavioural = behavioural.filter((transaction) => transaction.currency === primaryCurrency);
  const primaryFixedCost = fixedCost.filter((transaction) => transaction.currency === primaryCurrency);
  const primaryUncertain = uncertain.filter((transaction) => transaction.currency === primaryCurrency);

  const merchantAggregates = buildMerchantAggregates(primaryBehavioural);
  const excludedOneOffTransactions = merchantAggregates
    .filter((aggregate) => shouldExcludeAggregateFromLeverMath(aggregate))
    .reduce((total, aggregate) => total + aggregate.count, 0);

  const recurringAggregates = merchantAggregates.filter(
    (aggregate) => !shouldExcludeAggregateFromLeverMath(aggregate),
  );

  const baseline = primaryCurrency
    ? buildBaseline(recurringAggregates, primaryCurrency)
    : null;

  const topLevers = baseline
    ? buildTopLevers(recurringAggregates, baseline.raiseTarget)
    : [];

  return {
    accountCount: accounts.length,
    baseline,
    currencySummary: {
      otherCurrencies,
      primaryCurrency,
    },
    debugCounts: {
      behaviouralTransactions: behavioural.length,
      excludedOneOffTransactions,
      fixedCostTransactions: fixedCost.length,
      totalTransactions,
      uncertainTransactions: uncertain.length,
      wealthFlowTransactions: wealthFlow.length,
    },
    fixedCostContext: buildFixedCostContext(primaryFixedCost),
    generatedAt: new Date().toISOString(),
    habitMerchants: recurringAggregates
      .filter((aggregate) => aggregate.pattern === "habit")
      .sort((left, right) => right.monthlySpend - left.monthlySpend)
      .slice(0, 8)
      .map((aggregate) => ({
        averageSpend: roundCurrency(aggregate.averageSpend),
        categoryKey: aggregate.categoryKey,
        confidence: aggregate.confidence,
        count: aggregate.count,
        label: aggregate.label,
        monthlySpend: roundCurrency(aggregate.monthlySpend),
        pattern: aggregate.pattern,
      })),
    subscriptions: recurringAggregates
      .filter((aggregate) => aggregate.pattern === "subscription_candidate")
      .sort((left, right) => right.monthlySpend - left.monthlySpend)
      .slice(0, 8)
      .map((aggregate) => ({
        confidence: aggregate.confidence,
        count: aggregate.count,
        label: aggregate.label,
        monthlySpend: roundCurrency(aggregate.monthlySpend),
        sampleAmount: roundCurrency(aggregate.sampleAmount),
      })),
    topLevers,
    uncertainSpend: buildUncertainSpend(primaryUncertain),
  };
}

function buildBaseline(aggregates: MerchantAggregate[], currency: string) {
  const discretionaryMonthlySpend = roundCurrency(
    aggregates.reduce((total, aggregate) => total + aggregate.monthlySpend, 0),
  );

  return {
    currency,
    discretionaryMonthlySpend,
    raiseTarget: roundCurrency(discretionaryMonthlySpend * BRIEF_TARGET_RATIO),
    targetPercentage: BRIEF_TARGET_RATIO,
  };
}

function buildFixedCostContext(transactions: NormalizedTransaction[]) {
  const byCategory = new Map<CategoryKey, { merchantExamples: Set<string>; monthlySpend: number }>();

  for (const transaction of transactions) {
    const current = byCategory.get(transaction.classification.categoryKey) ?? {
      merchantExamples: new Set<string>(),
      monthlySpend: 0,
    };

    current.monthlySpend += monthlyEquivalent(transaction.absAmount);
    current.merchantExamples.add(transaction.merchant);
    byCategory.set(transaction.classification.categoryKey, current);
  }

  return Array.from(byCategory.entries())
    .map(([categoryKey, value]) => ({
      categoryKey,
      label: CATEGORY_LABELS[categoryKey],
      merchantExamples: Array.from(value.merchantExamples).slice(0, 3),
      monthlySpend: roundCurrency(value.monthlySpend),
    }))
    .sort((left, right) => right.monthlySpend - left.monthlySpend)
    .slice(0, 6);
}

function buildMerchantAggregates(transactions: NormalizedTransaction[]): MerchantAggregate[] {
  const groups = new Map<string, NormalizedTransaction[]>();

  for (const transaction of transactions) {
    const key = `${transaction.currency}:${transaction.classification.normalizedMerchant}`;
    const current = groups.get(key) ?? [];
    current.push(transaction);
    groups.set(key, current);
  }

  return Array.from(groups.values()).map((group) => {
    const sorted = [...group].sort((left, right) => left.date.localeCompare(right.date));
    const totalSpend = sorted.reduce((total, transaction) => total + transaction.absAmount, 0);
    const count = sorted.length;
    const averageSpend = totalSpend / count;
    const classification = sorted[0].classification;
    const pattern = detectPattern(sorted, averageSpend);
    const upgradedCategory = upgradeAggregateCategory(classification.categoryKey, classification.merchantFamily, pattern);
    const confidence = upgradeConfidence(classification.confidence, upgradedCategory, classification.categoryKey);

    return {
      averageSpend,
      categoryKey: upgradedCategory,
      confidence,
      count,
      currency: sorted[0].currency,
      family: classification.merchantFamily,
      label: sorted[0].merchant,
      monthlySpend: monthlyEquivalent(totalSpend),
      pattern,
      reason: classification.reason,
      sampleAmount: sorted[0].absAmount,
      totalSpend,
      transactions: sorted,
    };
  });
}

function buildTopLevers(aggregates: MerchantAggregate[], raiseTarget: number) {
  const byCategory = new Map<
    CategoryKey,
    {
      confidence: Confidence;
      merchantExamples: Set<string>;
      monthlySpend: number;
    }
  >();

  for (const aggregate of aggregates) {
    if (isUncertainCategory(aggregate.categoryKey)) {
      continue;
    }

    const current = byCategory.get(aggregate.categoryKey) ?? {
      confidence: aggregate.confidence,
      merchantExamples: new Set<string>(),
      monthlySpend: 0,
    };

    current.monthlySpend += aggregate.monthlySpend;
    current.confidence = combineConfidence(current.confidence, aggregate.confidence);
    current.merchantExamples.add(aggregate.label);
    byCategory.set(aggregate.categoryKey, current);
  }

  return Array.from(byCategory.entries())
    .map(([categoryKey, value]) => {
      const estimatedHalfCutImpact = roundCurrency(value.monthlySpend * 0.5);
      const targetCoverage = raiseTarget > 0 ? estimatedHalfCutImpact / raiseTarget : 0;

      return {
        categoryKey,
        confidence: value.confidence,
        controllabilityScore: CONTROLLABILITY_SCORES[categoryKey],
        estimatedHalfCutImpact,
        label: CATEGORY_LABELS[categoryKey],
        merchantExamples: Array.from(value.merchantExamples).slice(0, 4),
        monthlySpend: roundCurrency(value.monthlySpend),
        targetCoverage: roundPercentage(targetCoverage),
      };
    })
    .sort((left, right) => {
      const leftRank = left.monthlySpend * left.controllabilityScore;
      const rightRank = right.monthlySpend * right.controllabilityScore;
      return rightRank - leftRank;
    })
    .slice(0, 3);
}

function buildUncertainSpend(transactions: NormalizedTransaction[]) {
  const groups = new Map<string, NormalizedTransaction[]>();

  for (const transaction of transactions) {
    const key = `${transaction.currency}:${transaction.classification.normalizedMerchant}`;
    const current = groups.get(key) ?? [];
    current.push(transaction);
    groups.set(key, current);
  }

  return Array.from(groups.values())
    .map((group) => ({
      label: group[0].merchant,
      merchantFamily: group[0].classification.merchantFamily,
      monthlySpend: roundCurrency(monthlyEquivalent(group.reduce((total, transaction) => total + transaction.absAmount, 0))),
      reason: group[0].classification.reason,
      transactionCount: group.length,
    }))
    .sort((left, right) => right.monthlySpend - left.monthlySpend)
    .slice(0, 8);
}

function detectPattern(transactions: NormalizedTransaction[], averageSpend: number): PatternKind {
  if (transactions.length === 1) {
    return transactions[0].absAmount >= ONE_OFF_THRESHOLD ? "one_off" : "sporadic";
  }

  const intervals = getIntervalsInDays(transactions.map((transaction) => transaction.date));
  const tightAmounts = hasTightAmounts(transactions.map((transaction) => transaction.absAmount), averageSpend);
  const monthlyCadence = hasCadence(intervals, 24, 38);

  if (monthlyCadence && tightAmounts) {
    return "subscription_candidate";
  }

  if (transactions.length >= 3 || hasCadence(intervals, 5, 10)) {
    return "habit";
  }

  return "sporadic";
}

function normalizeTransaction(accountId: string, transaction: EnableBankingTransaction): NormalizedTransaction {
  const amount = Number(transaction.transaction_amount.amount);
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const signedAmount =
    transaction.credit_debit_indicator === "CRDT" ? safeAmount : Math.abs(safeAmount) * -1;
  const absAmount = Math.abs(signedAmount);
  const merchant = deriveMerchantLabel(transaction);
  const description = normalizeText(
    [merchant, transaction.note, ...(transaction.remittance_information ?? [])]
      .filter(Boolean)
      .join(" "),
  );
  const normalizedMerchant = normalizeText(merchant);
  const merchantFamily = detectMerchantFamily(`${normalizedMerchant} ${description}`);
  const classification = classifyTransaction(transaction, signedAmount, normalizedMerchant, merchant, description, merchantFamily);

  return {
    absAmount,
    accountId,
    classification,
    currency: transaction.transaction_amount.currency,
    date: transaction.booking_date || transaction.value_date || transaction.transaction_date || "0000-00-00",
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
  const bankCode = transaction.bank_transaction_code?.code?.toUpperCase() || "UNKNOWN";
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
    return buildClassification("wealth_flow", "fx_money_movement", "high", merchantFamily, merchant, normalizedMerchant, "FX or wallet exchange.", "heuristic");
  }

  if (bankCode === "TRANSFER") {
    if (containsAny(haystack, WEALTH_FLOW_KEYWORDS)) {
      return buildClassification("wealth_flow", "investment_savings", "high", merchantFamily, merchant, normalizedMerchant, "Savings, investing, or internal money movement.", "heuristic");
    }

    const fixedTransferCategory = getFixedCostCategory(haystack);
    if (fixedTransferCategory) {
      return buildClassification("fixed_cost", fixedTransferCategory, "high", merchantFamily, merchant, normalizedMerchant, "Recurring baseline transfer-like outflow.", "rule");
    }

    return buildClassification("unknown", "uncategorized", "low", merchantFamily, merchant, normalizedMerchant, "Transfer not safely attributable to discretionary spend.", "heuristic");
  }

  if (bankCode === "CHARGE") {
    return buildClassification("fixed_cost", "banking_fees", "high", merchantFamily, merchant, normalizedMerchant, "Banking or platform fee.", "rule");
  }

  if (bankCode === "ATM") {
    return buildClassification("behavioural_spend", "cash_withdrawal", "medium", merchantFamily, merchant, normalizedMerchant, "Cash withdrawal.", "rule");
  }

  if (bankCode === "CARD_PAYMENT" || bankCode === "UNKNOWN") {
    return classifyCardLikeTransaction(haystack, merchantFamily, merchant, normalizedMerchant);
  }

  return buildClassification("unknown", "uncategorized", "low", merchantFamily, merchant, normalizedMerchant, "Unclassified outflow.", "heuristic");
}

function classifyCardLikeTransaction(
  haystack: string,
  merchantFamily: string | undefined,
  merchant: string,
  normalizedMerchant: string,
): TransactionClassification {
  const fixedCostCategory = getFixedCostCategory(haystack);
  if (fixedCostCategory) {
    return buildClassification("fixed_cost", fixedCostCategory, "high", merchantFamily, merchant, normalizedMerchant, "Merchant matched fixed-cost rules.", "rule");
  }

  const ruleCategory = getRuleCategory(haystack);
  if (ruleCategory) {
    return buildClassification("behavioural_spend", ruleCategory, "high", merchantFamily, merchant, normalizedMerchant, "Merchant matched category rules.", "rule");
  }

  if (merchantFamily && AMBIGUOUS_FAMILIES.includes(merchantFamily)) {
    const categoryKey = merchantFamily === "apple" || merchantFamily === "google"
      ? "uncertain_digital"
      : "uncertain_shopping";

    return buildClassification("behavioural_spend", categoryKey, "low", merchantFamily, merchant, normalizedMerchant, "Ambiguous merchant family kept broad on purpose.", "family");
  }

  return buildClassification("behavioural_spend", "uncategorized", "low", merchantFamily, merchant, normalizedMerchant, "No confident merchant rule matched.", "heuristic");
}

function getFixedCostCategory(text: string): CategoryKey | null {
  if (containsAny(text, ["mortgage", "rent", "housing"])) {
    return "housing";
  }

  if (containsAny(text, ["yuno energy", "virgin media", "moco", "utility", "electric", "gas", "broadband"])) {
    return "utilities";
  }

  if (containsAny(text, ["plan fee", "premium repricing"])) {
    return "banking_fees";
  }

  return null;
}

function upgradeAggregateCategory(
  currentCategory: CategoryKey,
  merchantFamily: string | undefined,
  pattern: PatternKind,
): CategoryKey {
  if (pattern === "subscription_candidate") {
    return "subscriptions";
  }

  if (merchantFamily === "apple" || merchantFamily === "google") {
    return currentCategory === "uncategorized" ? "uncertain_digital" : currentCategory;
  }

  if (merchantFamily === "amazon" || merchantFamily === "paypal") {
    return currentCategory === "uncategorized" ? "uncertain_shopping" : currentCategory;
  }

  return currentCategory;
}

function upgradeConfidence(
  current: Confidence,
  upgradedCategory: CategoryKey,
  originalCategory: CategoryKey,
): Confidence {
  if (upgradedCategory === "subscriptions" && originalCategory !== "subscriptions") {
    return current === "low" ? "medium" : current;
  }

  return current;
}

function shouldExcludeAggregateFromLeverMath(aggregate: MerchantAggregate) {
  return (
    aggregate.pattern === "one_off" &&
    (aggregate.totalSpend >= ONE_OFF_THRESHOLD || isUncertainCategory(aggregate.categoryKey))
  );
}

function detectPrimaryCurrency(transactions: NormalizedTransaction[]) {
  const byCurrency = new Map<string, number>();

  for (const transaction of transactions) {
    byCurrency.set(transaction.currency, (byCurrency.get(transaction.currency) ?? 0) + transaction.absAmount);
  }

  const ranked = Array.from(byCurrency.entries()).sort((left, right) => right[1] - left[1]);
  return ranked[0]?.[0] ?? null;
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

function combineConfidence(left: Confidence, right: Confidence): Confidence {
  const order: Confidence[] = ["low", "medium", "high"];
  return order[Math.min(order.indexOf(left), order.indexOf(right))];
}

function getIntervalsInDays(dates: string[]) {
  const intervals: number[] = [];

  for (let index = 1; index < dates.length; index += 1) {
    const previous = new Date(dates[index - 1]);
    const current = new Date(dates[index]);
    const diff = Math.round((current.getTime() - previous.getTime()) / (1000 * 60 * 60 * 24));

    if (Number.isFinite(diff) && diff > 0) {
      intervals.push(diff);
    }
  }

  return intervals;
}

function hasCadence(intervals: number[], minDays: number, maxDays: number) {
  if (intervals.length === 0) {
    return false;
  }

  const matches = intervals.filter((interval) => interval >= minDays && interval <= maxDays);
  return matches.length >= Math.max(1, Math.floor(intervals.length / 2));
}

function hasTightAmounts(amounts: number[], average: number) {
  if (amounts.length < 2 || average <= 0) {
    return false;
  }

  const variance =
    amounts.reduce((total, amount) => total + (amount - average) ** 2, 0) / amounts.length;
  const deviationRatio = Math.sqrt(variance) / average;
  return deviationRatio <= 0.15;
}

function containsAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}

function monthlyEquivalent(amount: number) {
  return (amount / ANALYSIS_WINDOW_DAYS) * 30;
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function isUncertainCategory(categoryKey: CategoryKey) {
  return categoryKey === "uncertain_digital" || categoryKey === "uncertain_shopping" || categoryKey === "uncategorized";
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function roundPercentage(value: number) {
  return Math.round(value * 1000) / 1000;
}
