export type FlowKind =
  | "behavioural_spend"
  | "fixed_cost"
  | "income_or_refund"
  | "unknown"
  | "wealth_flow";

export type PatternKind = "habit" | "one_off" | "sporadic" | "subscription_candidate";

export type CategoryKey =
  | "banking_fees"
  | "cash_withdrawal"
  | "coffee_snacks"
  | "delivery"
  | "eating_out"
  | "fx_money_movement"
  | "grocery"
  | "health_fitness"
  | "housing"
  | "investment_savings"
  | "shopping_clothing"
  | "shopping_general"
  | "subscriptions"
  | "transport"
  | "travel"
  | "uncertain_digital"
  | "uncertain_shopping"
  | "uncategorized"
  | "utilities";

export type ClassificationSource = "family" | "heuristic" | "rule";

export type Confidence = "high" | "low" | "medium";

export interface TransactionClassification {
  categoryKey: CategoryKey;
  confidence: Confidence;
  flowKind: FlowKind;
  merchantFamily?: string;
  merchantLabel: string;
  normalizedMerchant: string;
  reason: string;
  source: ClassificationSource;
}

export interface AnalysisBaseline {
  currency: string;
  discretionaryMonthlySpend: number;
  raiseTarget: number;
  targetPercentage: number;
}

export interface AnalysisLever {
  categoryKey: CategoryKey;
  confidence: Confidence;
  controllabilityScore: number;
  estimatedHalfCutImpact: number;
  label: string;
  merchantExamples: string[];
  monthlySpend: number;
  targetCoverage: number;
}

export interface HabitMerchant {
  averageSpend: number;
  categoryKey: CategoryKey;
  confidence: Confidence;
  count: number;
  label: string;
  monthlySpend: number;
  pattern: PatternKind;
}

export interface SubscriptionAuditItem {
  confidence: Confidence;
  count: number;
  label: string;
  monthlySpend: number;
  sampleAmount: number;
}

export interface FixedCostItem {
  categoryKey: CategoryKey;
  label: string;
  merchantExamples: string[];
  monthlySpend: number;
}

export interface UncertainSpendItem {
  label: string;
  merchantFamily?: string;
  monthlySpend: number;
  reason: string;
  transactionCount: number;
}

export interface AnalysisDebugCounts {
  behaviouralTransactions: number;
  excludedOneOffTransactions: number;
  fixedCostTransactions: number;
  totalTransactions: number;
  uncertainTransactions: number;
  wealthFlowTransactions: number;
}

export interface SpendingAnalysis {
  accountCount: number;
  baseline: AnalysisBaseline | null;
  currencySummary: {
    otherCurrencies: string[];
    primaryCurrency: string | null;
  };
  debugCounts: AnalysisDebugCounts;
  fixedCostContext: FixedCostItem[];
  generatedAt: string;
  habitMerchants: HabitMerchant[];
  subscriptions: SubscriptionAuditItem[];
  topLevers: AnalysisLever[];
  uncertainSpend: UncertainSpendItem[];
}
