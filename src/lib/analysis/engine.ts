import { normalizeTransaction, type NormalizedTransaction, type FinancialRule, matchesFinancialFilter, type FinancialFilter } from "@/lib/analysis/classification";
import {
  transactionStatus,
  transactionStatusCounts,
} from "@/lib/transactions";
import type { EnableBankingAccountSnapshot } from "@/lib/enable-banking/types";
import {
  CATEGORY_LABELS,
  CONTROLLABILITY_SCORES,
} from "@/lib/analysis/rules";
import type {
  CategoryKey,
  Confidence,
  PatternKind,
  SpendingAnalysis,
  SpendingTransaction,
} from "@/lib/analysis/types";

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

const DEFAULT_ANALYSIS_WINDOW_DAYS = 90;
const BRIEF_TARGET_RATIO = 0.1;
const ONE_OFF_THRESHOLD = 100;

export function analyzeSpending(
  accounts: EnableBankingAccountSnapshot[],
  options: { windowDays?: number; rules?: FinancialRule[]; filters?: FinancialFilter } = {},
): SpendingAnalysis {
  const windowDays = normalizeWindowDays(options.windowDays);
  const normalized = accounts.flatMap((account) =>
    account.transactions
      .filter((transaction) => transactionStatus(transaction.status) === "BOOK")
      .map((transaction) => normalizeTransaction(account.accountId, transaction, options.rules)),
  ).filter((row) => matchesFinancialFilter(row, options.filters));

  const statusCounts = transactionStatusCounts(
    accounts.flatMap((account) => account.transactions),
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

  const merchantAggregates = buildMerchantAggregates(primaryBehavioural, windowDays);
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
    estimate: "Monthly projections from BOOK bank-returned rows, not exact period totals or a completeness guarantee.",
    baseline,
    currencySummary: {
      otherCurrencies,
      primaryCurrency,
    },
    debugCounts: {
      behaviouralTransactions: behavioural.length,
      excludedNonBookedTransactions: Object.entries(statusCounts)
        .filter(([status]) => status !== "BOOK")
        .reduce((total, [, count]) => total + count, 0),
      statusCounts,
      excludedOneOffTransactions,
      fixedCostTransactions: fixedCost.length,
      totalTransactions,
      uncertainTransactions: uncertain.length,
      wealthFlowTransactions: wealthFlow.length,
    },
    fixedCostContext: buildFixedCostContext(primaryFixedCost, windowDays),
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
    uncertainSpend: buildUncertainSpend(primaryUncertain, windowDays),
  };
}

export function getSpendingTransactions(
  accounts: EnableBankingAccountSnapshot[],
): SpendingTransaction[] {
  return accounts
    .flatMap((account) =>
      account.transactions.map((transaction) => normalizeTransaction(account.accountId, transaction)),
    )
    .map((transaction) => ({
      amount: roundCurrency(transaction.signedAmount),
      categoryKey: transaction.classification.categoryKey,
      categoryLabel: CATEGORY_LABELS[transaction.classification.categoryKey],
      confidence: transaction.classification.confidence,
      currency: transaction.currency,
      date: transaction.date,
      flowKind: transaction.classification.flowKind,
      merchant: transaction.merchant,
    }))
    .sort((left, right) => right.date.localeCompare(left.date));
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

function buildFixedCostContext(transactions: NormalizedTransaction[], windowDays: number) {
  const byCategory = new Map<CategoryKey, { merchantExamples: Set<string>; monthlySpend: number }>();

  for (const transaction of transactions) {
    const current = byCategory.get(transaction.classification.categoryKey) ?? {
      merchantExamples: new Set<string>(),
      monthlySpend: 0,
    };

    current.monthlySpend += monthlyEquivalent(transaction.absAmount, windowDays);
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

function buildMerchantAggregates(
  transactions: NormalizedTransaction[],
  windowDays: number,
): MerchantAggregate[] {
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
    const upgradedCategory = classification.categoryKey;
    const confidence = classification.confidence;

    return {
      averageSpend,
      categoryKey: upgradedCategory,
      confidence,
      count,
      currency: sorted[0].currency,
      family: classification.merchantFamily,
      label: sorted[0].merchant,
      monthlySpend: monthlyEquivalent(totalSpend, windowDays),
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

function buildUncertainSpend(transactions: NormalizedTransaction[], windowDays: number) {
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
      monthlySpend: roundCurrency(monthlyEquivalent(group.reduce((total, transaction) => total + transaction.absAmount, 0), windowDays)),
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

function monthlyEquivalent(amount: number, windowDays: number) {
  return (amount / windowDays) * 30;
}

function normalizeWindowDays(value: number | undefined) {
  if (value === undefined) {
    return DEFAULT_ANALYSIS_WINDOW_DAYS;
  }

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Analysis window must be a positive number of days.");
  }

  return value;
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
