import assert from "node:assert/strict";
import test from "node:test";
import {
  BankReadError,
  consentStatus,
  readBankAccounts,
  type BankDependencies,
} from "./reader";
import { detectRecurring } from "../analysis/recurring";
import type { BankConnection } from "../connections/store";
import type { EnableBankingTransaction } from "../enable-banking/types";
import { syntheticPersistence } from "../mcp/fixtures";
import { accountRef } from "../mcp/transaction-query";
const now = Date.parse("2026-11-13T00:00:00Z");
test("seven-day consent warning boundaries distinguish unknown, expiring, active and expired", () => {
  assert.equal(consentStatus(null, now).state, "unknown");
  assert.equal(
    consentStatus(new Date(now).toISOString(), now).state,
    "expired",
  );
  assert.equal(
    consentStatus(new Date(now - 1).toISOString(), now).state,
    "expired",
  );
  assert.equal(
    consentStatus(new Date(now + 1).toISOString(), now).state,
    "expiring",
  );
  assert.equal(
    consentStatus(new Date(now + 7 * 86400000).toISOString(), now).state,
    "expiring",
  );
  assert.equal(
    consentStatus(new Date(now + 7 * 86400000 + 1).toISOString(), now).state,
    "active",
  );
});

const connection: BankConnection = {
  subject: "owner",
  connectionId: "current-generation",
  sessionId: "private-session",
  connectedAt: "2026-01-01",
  consentExpiresAt: null,
  country: "IE",
  provider: "Synthetic",
};
const session = { accounts: ["private-account"] };
const scope = { subject: connection.subject, sessionId: connection.sessionId };
const range = { dateFrom: "2026-08-01", dateTo: "2026-11-13" };
function charges(): EnableBankingTransaction[] {
  return ["2026-08-01", "2026-09-01", "2026-10-01"].map((date) => ({
    status: "BOOK",
    booking_date: date,
    credit_debit_indicator: "DBIT",
    creditor: { name: "Recurring service" },
    transaction_amount: { amount: "10.00", currency: "EUR" },
  }));
}
function dependencies(): BankDependencies {
  return {
    ...syntheticPersistence(),
    getBankConnection: async () => connection,
    getSession: async () => session,
    getAccountDetails: async () => ({}),
    getAccountBalances: async () => [],
    getAllAccountTransactions: async () => charges(),
  };
}
for (const concurrentResult of ["success", "failed"] as const)
  test(`successful request keeps its own coverage after a newer historical fetch ${concurrentResult}`, async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: new Date(now) });
    const deps = dependencies();
    const started = Promise.withResolvers<void>();
    const pendingRows = Promise.withResolvers<EnableBankingTransaction[]>();
    deps.getAllAccountTransactions = async (_accountId, query) => {
      if (query?.dateTo === range.dateTo) {
        started.resolve();
        return pendingRows.promise;
      }
      if (concurrentResult === "failed")
        throw new Error("Synthetic provider failure");
      return charges();
    };
    const current = readBankAccounts(connection, session, deps, range);
    await started.promise;
    try {
      const historical = readBankAccounts(connection, session, deps, {
        ...range,
        dateTo: "2026-10-31",
      });
      if (concurrentResult === "failed")
        await assert.rejects(historical, BankReadError);
      else await historical;
    } finally {
      pendingRows.resolve(charges());
    }
    const result = await current;
    assert.equal(result.dataStatus[0].last_result, concurrentResult);
    assert.equal(result.dataStatus[0].request.date_to, "2026-10-31");
    assert.equal(
      result.transactionEvidence[0].account_ref,
      accountRef(scope, "private-account"),
    );
    assert.equal(result.transactionEvidence[0].coverage.date_to, "2026-11-13");
    assert.equal(result.transactionEvidence[0].coverage.returned_count, 3);
    const [recurring] = detectRecurring(
      result.accounts,
      [],
      {},
      scope,
      result.transactionEvidence,
      now,
    );
    assert.equal(recurring.overdue_not_observed, true);
    assert.equal(recurring.evidence_reason, null);
  });
test("a failed account prevents a partial request from returning recurrence evidence", async () => {
  const deps = dependencies();
  deps.getAllAccountTransactions = async (accountId) => {
    if (accountId === "failed-account")
      throw new Error("Synthetic provider failure");
    return charges();
  };
  await assert.rejects(
    readBankAccounts(
      connection,
      { accounts: ["private-account", "failed-account"] },
      deps,
      range,
    ),
    (error: unknown) => {
      assert.ok(error instanceof BankReadError);
      assert.equal(error.code, "bank_unavailable");
      assert.deepEqual(error.dataStatus.map((row) => row.last_result).sort(), [
        "failed",
        "success",
      ]);
      assert.equal("transactionEvidence" in error, false);
      return true;
    },
  );
});
