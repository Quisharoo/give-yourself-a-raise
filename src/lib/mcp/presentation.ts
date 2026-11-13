import type { SpendingAnalysis } from "@/lib/analysis/types";

export function analysisOutput(value: SpendingAnalysis) {
  return {
    estimate: value.estimate,
    account_count: value.accountCount,
    generated_at: value.generatedAt,
    baseline: value.baseline && {
      currency: value.baseline.currency,
      discretionary_monthly_spend: value.baseline.discretionaryMonthlySpend,
      raise_target: value.baseline.raiseTarget,
      target_percentage: value.baseline.targetPercentage,
    },
    currency_summary: {
      primary_currency: value.currencySummary.primaryCurrency,
      other_currencies: value.currencySummary.otherCurrencies,
    },
    debug_counts: {
      behavioural_transactions: value.debugCounts.behaviouralTransactions,
      excluded_non_booked_transactions:
        value.debugCounts.excludedNonBookedTransactions,
      status_counts: value.debugCounts.statusCounts,
      excluded_one_off_transactions:
        value.debugCounts.excludedOneOffTransactions,
      fixed_cost_transactions: value.debugCounts.fixedCostTransactions,
      total_transactions: value.debugCounts.totalTransactions,
      uncertain_transactions: value.debugCounts.uncertainTransactions,
      wealth_flow_transactions: value.debugCounts.wealthFlowTransactions,
    },
    fixed_cost_context: value.fixedCostContext.map((row) => ({
      category_key: row.categoryKey,
      label: row.label,
      merchant_examples: row.merchantExamples,
      monthly_spend: row.monthlySpend,
    })),
    habit_merchants: value.habitMerchants.map((row) => ({
      average_spend: row.averageSpend,
      category_key: row.categoryKey,
      confidence: row.confidence,
      count: row.count,
      label: row.label,
      monthly_spend: row.monthlySpend,
      pattern: row.pattern,
    })),
    subscriptions: value.subscriptions.map((row) => ({
      confidence: row.confidence,
      count: row.count,
      label: row.label,
      monthly_spend: row.monthlySpend,
      sample_amount: row.sampleAmount,
    })),
    top_levers: value.topLevers.map((row) => ({
      category_key: row.categoryKey,
      confidence: row.confidence,
      controllability_score: row.controllabilityScore,
      estimated_half_cut_impact: row.estimatedHalfCutImpact,
      label: row.label,
      merchant_examples: row.merchantExamples,
      monthly_spend: row.monthlySpend,
      target_coverage: row.targetCoverage,
    })),
    uncertain_spend: value.uncertainSpend.map((row) => ({
      label: row.label,
      merchant_family: row.merchantFamily,
      monthly_spend: row.monthlySpend,
      reason: row.reason,
      transaction_count: row.transactionCount,
    })),
  };
}
