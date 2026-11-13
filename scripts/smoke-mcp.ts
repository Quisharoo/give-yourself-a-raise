import assert from "node:assert/strict";
import { z } from "zod";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  createMcpServer,
  type McpBankDependencies,
} from "../src/lib/mcp/tools.ts";

const endpoint = "http://localhost:3000/mcp";
const range = { date_from: "2026-01-01", date_to: "2026-02-01" };
const dependencies: McpBankDependencies = {
  getBankConnection: async (subject) => ({
    subject,
    sessionId: "synthetic-server-session",
    connectedAt: "2026-01-01",
    consentExpiresAt: null,
    country: "IE",
    provider: "Synthetic",
  }),
  getSession: async () => ({ accounts: ["synthetic-private-account"] }),
  getAccountDetails: async () => ({
    cash_account_type: "CARD",
    currency: "EUR",
  }),
  getAccountBalances: async () => [],
  getAllAccountTransactions: async () =>
    ["0.10", "0.20"].map((amount, index) => ({
      booking_date: "2026-01-15",
      status: "BOOK",
      credit_debit_indicator: "DBIT",
      entry_reference: `synthetic-entry-${index}`,
      creditor: { name: "Coffee kiosk" },
      transaction_amount: { amount, currency: "EUR" },
    })),
};

async function main() {
  const initialize = await invoke("initialize", {
    capabilities: {},
    clientInfo: { name: "local-smoke", version: "1.0.0" },
    protocolVersion: "2025-03-26",
  });
  assert.equal(
    z.object({ name: z.string() }).parse(initialize.serverInfo).name,
    "give-yourself-a-raise",
  );
  const listed = await invoke("tools/list", {});
  const tools = z
    .array(
      z.object({
        annotations: z.object({ readOnlyHint: z.boolean() }),
        securitySchemes: z.array(z.object({ scopes: z.array(z.string()) })),
      }),
    )
    .parse(listed.tools);
  assert.equal(tools.length, 6);
  assert.equal(tools[0].annotations.readOnlyHint, true);
  assert.equal(tools[0].securitySchemes[0].scopes[0], "read:bank_data");
  const summary = await call("get_account_summary", range);
  const account_refs = z
    .array(z.object({ account_ref: z.string() }))
    .parse(summary.accounts)
    .map((account) => account.account_ref);
  const first = await call("find_transactions", {
    ...range,
    account_refs,
    limit: 1,
  });
  assert.equal(z.array(z.unknown()).parse(first.transactions).length, 1);
  assert.equal(first.matched_count, 2);
  const second = await call("find_transactions", { cursor: first.next_cursor });
  assert.equal(z.array(z.unknown()).parse(second.transactions).length, 1);
  assert.equal(second.next_cursor, null);
  const totals = await call("get_transaction_totals", {
    ...range,
    account_refs,
    status: "all",
  });
  assert.deepEqual(totals.totals, [
    { currency: "EUR", count: 2, debit: "0.30", credit: "0", net: "-0.30" },
  ]);
  assert.equal("transactions" in totals, false);
  console.log(
    `MCP smoke passed: initialize, ${tools.length} read-only tools, account selection, paging and exact totals using synthetic bank data`,
  );
}

async function call(name: string, args: Record<string, unknown>) {
  const result = await invoke("tools/call", { name, arguments: args });
  assert.notEqual(result.isError, true);
  return z.record(z.string(), z.unknown()).parse(result.structuredContent);
}

async function invoke(method: string, params: Record<string, unknown>) {
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
    sessionIdGenerator: undefined,
  });
  const server = createMcpServer(
    "smoke-user",
    "http://localhost:3000",
    dependencies,
  );
  await server.connect(transport);
  try {
    const response = await transport.handleRequest(
      new Request(endpoint, {
        body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );
    assert.equal(response.status, 200);
    return z
      .object({ result: z.record(z.string(), z.unknown()) })
      .parse(await response.json()).result;
  } finally {
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
