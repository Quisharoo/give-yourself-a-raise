import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { EnableBankingTransaction } from "../enable-banking/types.ts";
import { createMcpServer, type McpBankDependencies } from "./tools.ts";

const range = { date_from: "2026-01-01", date_to: "2026-02-01" };
function syntheticBank() {
  const calls: Array<{ accountId: string; query: unknown }> = [];
  const rows: EnableBankingTransaction[] = Array.from(
    { length: 60 },
    (_, i) => ({
      booking_date: "2026-01-15",
      creditor: { name: "Coffee kiosk" },
      credit_debit_indicator: "DBIT",
      entry_reference: `private-entry-${i}`,
      status: i === 59 ? "PDNG" : "BOOK",
      transaction_amount: { amount: "0.10", currency: "EUR" },
    }),
  );
  const dependencies: McpBankDependencies = {
    getBankConnection: async (subject) =>
      subject === "disconnected"
        ? null
        : {
            connectedAt: "2026-01-01",
            consentExpiresAt: null,
            country: "IE",
            provider: "Synthetic",
            sessionId: `server-session-${subject}`,
            subject,
          },
    getSession: async () => ({
      accounts: [
        { uid: "private-account-one", iban: "private-iban" },
        { uid: "private-account-two" },
      ],
    }),
    getAccountDetails: async () => ({
      cash_account_type: "CARD",
      currency: "EUR",
    }),
    getAccountBalances: async () => [
      { balance_amount: { amount: "10.00", currency: "EUR" } },
    ],
    getAllAccountTransactions: async (accountId, query) => {
      calls.push({ accountId, query });
      return rows;
    },
  };
  return { dependencies, calls };
}

async function invoke(
  dependencies: McpBankDependencies,
  method: string,
  params: Record<string, unknown>,
  subject = "owner",
) {
  const server = createMcpServer(subject, "http://localhost", dependencies);
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);
  try {
    const response = await transport.handleRequest(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      }),
    );
    assert.equal(response.status, 200);
    const body = z
      .object({ result: z.record(z.string(), z.unknown()) })
      .parse(await response.json());
    return body.result;
  } finally {
    await server.close();
  }
}

const structured = z.object({
  structuredContent: z.record(z.string(), z.unknown()),
});
function content(result: Record<string, unknown>) {
  return structured.parse(result).structuredContent;
}
async function call(
  deps: McpBankDependencies,
  name: string,
  args: Record<string, unknown>,
  subject?: string,
) {
  return invoke(deps, "tools/call", { name, arguments: args }, subject);
}

test("real MCP initialize/list/call carries account selection, exact whole-result totals and paging", async () => {
  const { dependencies, calls } = syntheticBank();
  const initialized = await invoke(dependencies, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "synthetic-test", version: "1" },
  });
  assert.deepEqual(initialized.serverInfo, {
    name: "give-yourself-a-raise",
    version: "0.1.0",
  });
  const listed = await invoke(dependencies, "tools/list", {});
  assert.equal(z.array(z.unknown()).parse(listed.tools).length, 6);
  const summary = content(
    await call(dependencies, "get_account_summary", range),
  );
  const accounts = z
    .array(z.object({ account_ref: z.string() }))
    .parse(summary.accounts);
  const account_refs = [accounts[0].account_ref];
  calls.length = 0;
  const first = content(
    await call(dependencies, "find_transactions", {
      ...range,
      account_refs,
      limit: 50,
    }),
  );
  assert.equal(first.matched_count, 59);
  assert.equal(z.array(z.unknown()).parse(first.transactions).length, 50);
  assert.deepEqual(first.totals, [
    { currency: "EUR", count: 59, debit: "5.90", credit: "0", net: "-5.90" },
  ]);
  assert.deepEqual(
    calls.map(({ accountId }) => accountId),
    ["private-account-one"],
  );
  const second = content(
    await call(dependencies, "find_transactions", {
      cursor: first.next_cursor,
    }),
  );
  assert.equal(z.array(z.unknown()).parse(second.transactions).length, 9);
  assert.equal(second.next_cursor, null);
  const totals = content(
    await call(dependencies, "get_transaction_totals", {
      ...range,
      account_refs,
    }),
  );
  assert.deepEqual(totals.totals, first.totals);
  assert.equal("transactions" in totals, false);
  for (const output of [summary, first, second, totals]) {
    assert.doesNotMatch(
      JSON.stringify(output),
      /private-account|private-iban|private-entry|server-session/,
    );
  }
});

test("MCP status and account isolation reject bad selectors without leaking private provider errors", async () => {
  const { dependencies, calls } = syntheticBank();
  const summary = content(
    await call(dependencies, "get_account_summary", range),
  );
  const account_ref = z
    .array(z.object({ account_ref: z.string() }))
    .parse(summary.accounts)[0].account_ref;
  calls.length = 0;
  const forbidden = await call(
    dependencies,
    "get_transaction_totals",
    { ...range, account_refs: [account_ref] },
    "another-user",
  );
  assert.equal(forbidden.isError, true);
  assert.equal(calls.length, 0);
  const pending = content(
    await call(dependencies, "get_transaction_totals", {
      ...range,
      account_refs: [account_ref],
      status: "PDNG",
    }),
  );
  assert.equal(pending.matched_count, 1);
  assert.deepEqual(calls[0], {
    accountId: "private-account-one",
    query: {
      dateFrom: "2026-01-01",
      dateTo: "2026-02-01",
      windowDays: 31,
      transactionStatus: "PDNG",
    },
  });
  calls.length = 0;
  await call(dependencies, "get_transaction_totals", {
    ...range,
    status: "all",
  });
  assert.ok(
    calls.every(
      ({ query }) => !JSON.stringify(query).includes("transactionStatus"),
    ),
  );
  calls.length = 0;
  await call(dependencies, "get_transaction_totals", {
    ...range,
    status: "UNKNOWN",
  });
  assert.ok(
    calls.every(
      ({ query }) => !JSON.stringify(query).includes("transactionStatus"),
    ),
  );
  const failingDeps = {
    ...dependencies,
    getSession: async () => {
      throw new Error("private-account-one private-provider-key");
    },
  };
  const failed = await call(failingDeps, "find_transactions", range);
  assert.equal(failed.isError, true);
  assert.doesNotMatch(
    JSON.stringify(failed),
    /private-account|private-provider-key/,
  );
});

test("MCP summary and period comparison expose BOOK-only monthly estimates with excluded counts", async () => {
  const { dependencies } = syntheticBank();
  const summary = content(
    await call(dependencies, "summarize_spending", range),
  );
  assert.match(String(summary.estimate), /Monthly projections/);
  assert.equal(
    z
      .object({ excludedNonBookedTransactions: z.number() })
      .parse(summary.debugCounts).excludedNonBookedTransactions,
    2,
  );
  const compared = content(
    await call(dependencies, "compare_spending_periods", {
      current_from: "2026-01-01",
      current_to: "2026-02-01",
      previous_from: "2026-01-01",
      previous_to: "2026-02-01",
    }),
  );
  assert.equal(compared.discretionary_monthly_change, 0);
  const current = z
    .object({
      analysis: z.object({
        debugCounts: z.object({ excludedNonBookedTransactions: z.number() }),
      }),
    })
    .parse(compared.current);
  assert.equal(current.analysis.debugCounts.excludedNonBookedTransactions, 2);
});
