import assert from "node:assert/strict";
import test from "node:test";

import { sampleSpendingAnalysisFixture } from "./fixtures.ts";

import {
  getActionCountToHitTarget,
  getDominantCurrency,
  getFilteredTransactionShare,
} from "./presentation.ts";

test("getDominantCurrency prefers the baseline currency", () => {
  assert.equal(getDominantCurrency(sampleSpendingAnalysisFixture), "EUR");
});

test("getDominantCurrency falls back to currency summary and default", () => {
  assert.equal(
    getDominantCurrency({
      ...sampleSpendingAnalysisFixture,
      baseline: null,
      currencySummary: {
        otherCurrencies: [],
        primaryCurrency: "GBP",
      },
    }),
    "GBP",
  );

  assert.equal(
    getDominantCurrency({
      ...sampleSpendingAnalysisFixture,
      baseline: null,
      currencySummary: {
        otherCurrencies: [],
        primaryCurrency: null,
      },
    }),
    "EUR",
  );
});

test("getFilteredTransactionShare computes the excluded ratio", () => {
  assert.equal(
    getFilteredTransactionShare(sampleSpendingAnalysisFixture.debugCounts),
    (252 + 14 + 6) / 592,
  );
});

test("getActionCountToHitTarget returns the first action count that clears the target", () => {
  assert.equal(getActionCountToHitTarget(sampleSpendingAnalysisFixture.topLevers, 122), 1);
  assert.equal(getActionCountToHitTarget(sampleSpendingAnalysisFixture.topLevers, 200), 2);
  assert.equal(getActionCountToHitTarget(sampleSpendingAnalysisFixture.topLevers, 1000), 0);
  assert.equal(getActionCountToHitTarget(sampleSpendingAnalysisFixture.topLevers, 0), 0);
});
