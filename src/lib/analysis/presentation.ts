import type { AnalysisDebugCounts, AnalysisLever, SpendingAnalysis } from "./types";

export function getDominantCurrency(analysis: SpendingAnalysis) {
  return analysis.baseline?.currency ?? analysis.currencySummary.primaryCurrency ?? "EUR";
}

export function getFilteredTransactionShare(debugCounts: AnalysisDebugCounts) {
  const filteredTransactions =
    debugCounts.wealthFlowTransactions +
    debugCounts.fixedCostTransactions +
    debugCounts.excludedOneOffTransactions;

  return debugCounts.totalTransactions ? filteredTransactions / debugCounts.totalTransactions : 0;
}

export function getActionCountToHitTarget(levers: AnalysisLever[], targetAmount: number) {
  if (!targetAmount) {
    return 0;
  }

  let runningTotal = 0;

  for (let index = 0; index < levers.length; index += 1) {
    runningTotal += levers[index].estimatedHalfCutImpact;

    if (runningTotal >= targetAmount) {
      return index + 1;
    }
  }

  return 0;
}
