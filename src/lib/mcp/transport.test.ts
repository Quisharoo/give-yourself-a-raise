import { syntheticPersistence } from "./fixtures";
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
    ...syntheticPersistence(),
    getBankConnection: async (subject) =>
      subject === "disconnected"
        ? null
        : {
            connectionId: "synthetic-generation",
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
  assert.equal(z.array(z.unknown()).parse(listed.tools).length, 8);
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
  assert.ok(z.array(z.unknown()).parse(first.transactions).length <= 50);
  assert.equal(first.page_limited_by_size, true);
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
  const found = [
    ...z
      .array(z.object({ transaction_ref: z.string() }))
      .parse(first.transactions),
    ...z
      .array(z.object({ transaction_ref: z.string() }))
      .parse(second.transactions),
  ];
  let next = second.next_cursor;
  while (typeof next === "string") {
    const page = content(
      await call(dependencies, "find_transactions", { cursor: next }),
    );
    found.push(
      ...z
        .array(z.object({ transaction_ref: z.string() }))
        .parse(page.transactions),
    );
    next = page.next_cursor;
  }
  assert.equal(next, null);
  assert.equal(found.length, 59);
  assert.equal(new Set(found.map((row) => row.transaction_ref)).size, 59);
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
      .object({ excluded_non_booked_transactions: z.number() })
      .parse(summary.debug_counts).excluded_non_booked_transactions,
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
        debug_counts: z.object({
          excluded_non_booked_transactions: z.number(),
        }),
      }),
    })
    .parse(compared.current);
  assert.equal(
    current.analysis.debug_counts.excluded_non_booked_transactions,
    2,
  );
});

test("MCP status corrects legacy fabricated expiry using provider consent without fetching transactions", async () => {
  const { dependencies, calls } = syntheticBank();
  const saved: Array<string | null> = [];
  const expires = new Date(Date.now() + 5 * 86400000).toISOString();
  dependencies.updateConsentExpiry = async (_connection, expiry) => {
    saved.push(expiry);
  };
  dependencies.getSession = async () => ({
    accounts: ["private-account-one"],
    access: { valid_until: expires },
  });
  const status = content(await call(dependencies, "get_connection_status", {}));
  assert.equal(status.consent_expires_at, expires);
  assert.equal(
    z.object({ state: z.string() }).parse(status.consent).state,
    "expiring",
  );
  assert.deepEqual(saved, [expires]);
  assert.equal(calls.length, 0);
  dependencies.getSession = async () => ({
    accounts: [],
    access: { valid_until: "invalid" },
  });
  const unknown = content(
    await call(dependencies, "get_connection_status", {}),
  );
  assert.equal(unknown.consent_expires_at, null);
  assert.deepEqual(saved, [expires, null]);
});
test("MCP expired consent blocks all bank-data tools and returns safe structured reconnect errors", async () => {
  const { dependencies, calls } = syntheticBank();
  dependencies.getSession = async () => ({
    accounts: ["private-account-one"],
    access: { valid_until: "2020-01-01T00:00:00Z" },
  });
  for (const name of [
    "get_account_summary",
    "find_transactions",
    "get_transaction_totals",
    "summarize_spending",
    "compare_spending_periods",
    "get_recurring_transactions",
  ]) {
    const result = await call(dependencies, name, range);
    assert.equal(result.isError, true);
    assert.deepEqual(content(result).error, {
      code: "consent_expired",
      message: "Bank consent has expired. Reconnect your bank.",
      reconnect_url: "http://localhost/",
    });
  }
  assert.equal(calls.length, 0);
});
test("MCP recognizes early provider expiry at session and transaction stages without conflating unrelated 401s", async () => {
  const { EnableBankingError } = await import("../enable-banking/client");
  for (const stage of ["session", "transactions"] as const)
    for (const providerCode of ["EXPIRED_SESSION", "INVALID_SIGNATURE"]) {
      const { dependencies } = syntheticBank();
      const fail = async () => {
        throw new EnableBankingError(
          "private-iban private-account private-provider-key",
          401,
          { error: providerCode, message: "private-session" },
        );
      };
      if (stage === "session") dependencies.getSession = fail;
      else dependencies.getAllAccountTransactions = fail;
      const result = await call(dependencies, "get_transaction_totals", range);
      assert.equal(result.isError, true);
      assert.equal(
        z.object({ code: z.string() }).parse(content(result).error).code,
        providerCode === "EXPIRED_SESSION"
          ? "consent_expired"
          : "bank_unavailable",
      );
      assert.doesNotMatch(
        JSON.stringify(result),
        /private-|INVALID_SIGNATURE|EXPIRED_SESSION/,
      );
    }
});
test("MCP persists independent account/resource outcomes, preserves prior success after failure and distinguishes empty success", async () => {
  const { dependencies } = syntheticBank();
  await call(dependencies, "get_account_summary", range);
  const initial = content(
    await call(dependencies, "get_connection_status", {}),
  );
  const schema = z.array(
    z.object({
      account_ref: z.string(),
      resource: z.string(),
      last_result: z.string(),
      last_success: z
        .object({
          completed_at: z.string(),
          returned_count: z.number(),
          latest_booked_transaction_date: z.string().nullable(),
        })
        .nullable(),
    }),
  );
  const old = schema.parse(initial.data_status);
  assert.equal(old.length, 4);
  dependencies.getAllAccountTransactions = async (accountId) => {
    if (accountId === "private-account-one")
      throw new Error("private provider failed on later page");
    return [];
  };
  const failed = await call(dependencies, "get_transaction_totals", range);
  assert.equal(failed.isError, true);
  assert.equal("totals" in content(failed), false);
  const after = schema.parse(content(failed).data_status);
  const failedTx = after.find(
    (row) => row.resource === "transactions" && row.last_result === "failed",
  )!;
  const emptyTx = after.find(
    (row) => row.resource === "transactions" && row.last_result === "success",
  )!;
  assert.deepEqual(
    failedTx.last_success,
    old.find(
      (row) =>
        row.account_ref === failedTx.account_ref &&
        row.resource === "transactions",
    )!.last_success,
  );
  assert.equal(emptyTx.last_success!.returned_count, 0);
  assert.equal(emptyTx.last_success!.latest_booked_transaction_date, null);
  assert.deepEqual(
    after.filter((row) => row.resource === "balances"),
    old.filter((row) => row.resource === "balances"),
  );
  const beforeStatus = await dependencies.getAccountFetchObservations(
    (await dependencies.getBankConnection("owner"))!,
  );
  dependencies.getAllAccountTransactions = async () => {
    throw new Error("Status must not fetch transactions");
  };
  const persisted = content(
    await call(dependencies, "get_connection_status", {}),
  );
  assert.deepEqual(persisted.data_status, beforeStatus);
});
test("MCP rejects invalid bank dates and amounts before recording success", async () => {
  for (const bad of [
    { booking_date: "2026-02-30", amount: "1" },
    { booking_date: "2026-01-01", amount: "1e9" },
    { booking_date: null, value_date: null, transaction_date: null, amount: "1" },
    { booking_date: "2026-01-01", value_date: "not-a-date", amount: "1" },
    { booking_date: "2026-01-01", transaction_date: "2026-02-30", amount: "1" },
  ]) {
    const { dependencies } = syntheticBank();
    dependencies.getAllAccountTransactions = async () => [
      {
        status: "BOOK",
        booking_date: bad.booking_date,
        value_date: bad.value_date,
        transaction_date: bad.transaction_date,
        credit_debit_indicator: "DBIT",
        transaction_amount: { amount: bad.amount, currency: "EUR" },
      },
    ];
    const failed = await call(dependencies, "find_transactions", range);
    assert.equal(failed.isError, true);
    assert.equal(
      z.object({ code: z.string() }).parse(content(failed).error).code,
      "invalid_bank_data",
    );
    assert.ok(
      z
        .array(z.object({ last_result: z.string(), last_success: z.null() }))
        .parse(content(failed).data_status)
        .every((row) => row.last_result === "failed"),
    );
  }
});
test("MCP summary and search accept nullable provider dates with exact values and successful coverage", async () => {
  const { dependencies } = syntheticBank();
  dependencies.getSession = async () => ({ accounts: ["private-account-one"] });
  dependencies.getAccountBalances = async () => [
    {
      balance_amount: { amount: "9007199254740993.12345", currency: "EUR" },
      reference_date: "2026-01-31",
      last_change_date_time: null,
    },
  ];
  dependencies.getAllAccountTransactions = async () =>
    [
      {
        booking_date: "2026-01-15",
        value_date: "2026-01-14",
        transaction_date: null,
      },
      { booking_date: "2026-01-16", value_date: null, transaction_date: null },
      { booking_date: null, value_date: "2026-01-17", transaction_date: null },
      { booking_date: null, value_date: null, transaction_date: "2026-01-18" },
    ].map((dates, index) => ({
      ...dates,
      status: "BOOK",
      credit_debit_indicator: index === 3 ? "CRDT" : "DBIT",
      entry_reference: `private-null-date-${index}`,
      transaction_amount: {
        amount: ["0.10", "0.20", "0.30", "1.00"][index],
        currency: "EUR",
      },
    }));
  const summaryResult = await call(dependencies, "get_account_summary", range);
  assert.notEqual(summaryResult.isError, true);
  const summary = content(summaryResult);
  const [account] = z
    .array(
      z.object({
        transaction_count: z.number(),
        balances: z.array(z.record(z.string(), z.unknown())),
      }),
    )
    .parse(summary.accounts);
  assert.equal(account.transaction_count, 4);
  assert.deepEqual(account.balances, [
    {
      amount_decimal: "9007199254740993.12345",
      currency: "EUR",
      type: null,
      reference_date: "2026-01-31",
      last_change_date_time: null,
    },
  ]);
  const searchResult = await call(dependencies, "find_transactions", range);
  assert.notEqual(searchResult.isError, true);
  const search = content(searchResult);
  assert.equal(search.matched_count, 4);
  assert.deepEqual(search.totals, [
    { currency: "EUR", count: 4, debit: "0.60", credit: "1.00", net: "0.40" },
  ]);
  assert.deepEqual(
    z
      .array(z.object({ date: z.string(), amount_decimal: z.string() }))
      .parse(search.transactions)
      .sort((left, right) => left.date.localeCompare(right.date)),
    [
      { date: "2026-01-15", amount_decimal: "-0.10" },
      { date: "2026-01-16", amount_decimal: "-0.20" },
      { date: "2026-01-17", amount_decimal: "-0.30" },
      { date: "2026-01-18", amount_decimal: "1.00" },
    ],
  );
  for (const output of [summary, search]) {
    const statuses = z
      .array(
        z.object({
          resource: z.string(),
          last_result: z.literal("success"),
          last_success: z.object({
            returned_count: z.number(),
            pagination_complete: z.literal(true),
            earliest_transaction_date: z.string().nullable(),
            latest_transaction_date: z.string().nullable(),
            latest_booked_transaction_date: z.string().nullable(),
          }),
        }),
      )
      .parse(output.data_status);
    assert.equal(statuses.length, 2);
    assert.deepEqual(
      statuses.find((row) => row.resource === "transactions")?.last_success,
      {
        returned_count: 4,
        pagination_complete: true,
        earliest_transaction_date: "2026-01-15",
        latest_transaction_date: "2026-01-18",
        latest_booked_transaction_date: "2026-01-18",
      },
    );
    assert.equal(
      statuses.find((row) => row.resource === "balances")?.last_success
        .returned_count,
      1,
    );
  }
});
test("MCP malformed non-null balance dates fail without successful balance coverage", async () => {
  for (const dates of [
    { reference_date: "2026-02-30", last_change_date_time: null },
    { reference_date: null, last_change_date_time: "not-a-timestamp" },
  ]) {
    const { dependencies } = syntheticBank();
    dependencies.getAccountBalances = async () => [
      {
        balance_amount: { amount: "10.00", currency: "EUR" },
        ...dates,
      },
    ];
    const failed = await call(dependencies, "get_account_summary", range);
    assert.equal(failed.isError, true);
    assert.equal(
      z.object({ code: z.string() }).parse(content(failed).error).code,
      "invalid_bank_data",
    );
    const balances = z
      .array(
        z.object({
          resource: z.string(),
          last_result: z.string(),
          last_success: z.unknown(),
        }),
      )
      .parse(content(failed).data_status)
      .filter((row) => row.resource === "balances");
    assert.equal(balances.length, 2);
    assert.ok(
      balances.every(
        (row) => row.last_result === "failed" && row.last_success === null,
      ),
    );
  }
});
test("MCP exact balances preserve large fractional decimals and provider as-of values", async () => {
  const { dependencies } = syntheticBank();
  dependencies.getAccountBalances = async () => [
    {
      balance_amount: { amount: "9007199254740993.12345", currency: "EUR" },
      reference_date: "2026-01-31",
      last_change_date_time: "2026-01-31T12:00:00Z",
      balance_type: "CLBD",
    },
  ];
  const summary = content(
    await call(dependencies, "get_account_summary", range),
  );
  const balances = z
    .array(z.object({ balances: z.array(z.record(z.string(), z.unknown())) }))
    .parse(summary.accounts)[0].balances;
  assert.deepEqual(balances[0], {
    amount_decimal: "9007199254740993.12345",
    currency: "EUR",
    type: "CLBD",
    reference_date: "2026-01-31",
    last_change_date_time: "2026-01-31T12:00:00Z",
  });
  assert.equal("amount" in balances[0], false);
});
test("MCP caps complete compact snake_case pages by bytes and retains opt-in full evidence", async () => {
  const { dependencies } = syntheticBank();
  const compact = await call(dependencies, "find_transactions", range);
  const rows = z
    .array(z.record(z.string(), z.unknown()))
    .parse(content(compact).transactions);
  assert.ok(rows.length > 0 && rows.length <= 50);
  assert.equal(content(compact).page_limited_by_size, true);
  assert.equal("raw_descriptor" in rows[0], false);
  assert.equal("amount" in rows[0], false);
  const full = await call(dependencies, "find_transactions", {
    ...range,
    detail: "full",
  });
  const fullRows = z
    .array(z.record(z.string(), z.unknown()))
    .parse(content(full).transactions);
  assert.equal(fullRows[0].raw_descriptor, "Coffee kiosk");
  assert.ok(fullRows[0].classification_reason);
  const compactBytes = Buffer.byteLength(JSON.stringify(compact));
  const fullBytes = Buffer.byteLength(JSON.stringify(full));
  assert.ok(
    compactBytes < 36000,
    `compact MCP payload was ${compactBytes} bytes`,
  );
  assert.ok(fullBytes < 36000, `full MCP payload was ${fullBytes} bytes`);
  assert.ok(fullRows.length < rows.length);
  function checkKeys(value: unknown) {
    if (Array.isArray(value)) {
      for (const child of value) checkKeys(child);
      return;
    }
    if (value && typeof value === "object")
      for (const [key, child] of Object.entries(value)) {
        assert.doesNotMatch(key, /[a-z][A-Z]/);
        checkKeys(child);
      }
  }
  checkKeys(content(compact));
  checkKeys(content(full));
  console.log(
    JSON.stringify({
      fixture: "synthetic_compact_50",
      compact_bytes: compactBytes,
      full_bytes: fullBytes,
    }),
  );
});

test("one fixture produces the same owner/project totals across search, totals, summary and comparison", async () => {
  const { INITIAL_OWNER_RULES } = await import("../analysis/rule-store");
  const { dependencies } = syntheticBank();
  dependencies.getSession = async () => ({ accounts: ["private-account-one"] });
  dependencies.listFinancialRules = async (subject) =>
    subject === "owner" ? INITIAL_OWNER_RULES : [];
  const examples: Array<[string, string, "CRDT" | "DBIT", string]> = [
    ["Awx*JoinBrands", "20.10", "DBIT", "CARD_PAYMENT"],
    ["Join Brands", "10.20", "DBIT", "CARD_PAYMENT"],
    ["Apple Distribution International", "100.00", "CRDT", "TRANSFER"],
    ["Apple.com/bill", "19.99", "DBIT", "CARD_PAYMENT"],
    ["Apple.com/bill", "9.990", "DBIT", "CARD_PAYMENT"],
    ["Amazon*marketplace", "50", "DBIT", "CARD_PAYMENT"],
    ["From Instant Access Savings", "500", "CRDT", "TRANSFER"],
  ];
  dependencies.getAllAccountTransactions = async () =>
    examples.map(([merchant, amount, direction, code], index) => ({
      booking_date: "2026-01-15",
      status: "BOOK",
      creditor: { name: merchant },
      debtor: { name: merchant },
      credit_debit_indicator: direction,
      bank_transaction_code: { code },
      entry_reference: `private-reference-${index}`,
      transaction_amount: { amount, currency: "EUR" },
    }));
  const filters = { purpose: "business", project: "INCREMNT", currency: "EUR" };
  const found = content(
    await call(dependencies, "find_transactions", { ...range, ...filters }),
  );
  assert.equal(found.matched_count, 3);
  assert.deepEqual(found.totals, [
    {
      currency: "EUR",
      count: 3,
      debit: "30.30",
      credit: "100.00",
      net: "69.70",
    },
  ]);
  assert.deepEqual(found.classified_totals, [
    {
      currency: "EUR",
      expense: "30.30",
      income: "0",
      revenue: "100.00",
      refund: "0",
      transfer: "0",
      unknown: "0",
    },
  ]);
  const totals = content(
    await call(dependencies, "get_transaction_totals", {
      ...range,
      ...filters,
    }),
  );
  const summary = content(
    await call(dependencies, "summarize_spending", { ...range, ...filters }),
  );
  const comparison = content(
    await call(dependencies, "compare_spending_periods", {
      ...filters,
      current_from: range.date_from,
      current_to: range.date_to,
      previous_from: range.date_from,
      previous_to: range.date_to,
    }),
  );
  const current = z.record(z.string(), z.unknown()).parse(comparison.current);
  const previous = z.record(z.string(), z.unknown()).parse(comparison.previous);
  for (const result of [totals, summary, current, previous]) {
    assert.deepEqual(result.totals, found.totals);
    assert.deepEqual(result.classified_totals, found.classified_totals);
  }
  const byRaw = content(
    await call(dependencies, "find_transactions", {
      ...range,
      merchant: "Awx*JoinBrands",
      detail: "full",
    }),
  );
  assert.equal(byRaw.matched_count, 1);
  const rows = z
    .array(z.record(z.string(), z.unknown()))
    .parse(byRaw.transactions);
  assert.equal(rows[0].merchant, "Join Brands");
  assert.equal(rows[0].raw_descriptor, "Awx*JoinBrands");
  const other = content(
    await call(
      dependencies,
      "find_transactions",
      { ...range, purpose: "business" },
      "another-user",
    ),
  );
  assert.equal(other.matched_count, 0);
  const inspected = content(
    await call(dependencies, "list_classification_rules", {}),
  );
  assert.deepEqual(inspected.rules, INITIAL_OWNER_RULES);
});
test("MCP transaction references survive rule changes while old paging cursors are rejected", async () => {
  const { INITIAL_OWNER_RULES } = await import("../analysis/rule-store");
  const { dependencies } = syntheticBank();
  const first = content(
    await call(dependencies, "find_transactions", { ...range, limit: 1 }),
  );
  const before = z
    .array(z.object({ transaction_ref: z.string() }))
    .parse(first.transactions)[0].transaction_ref;
  dependencies.listFinancialRules = async () => INITIAL_OWNER_RULES;
  const expired = await call(dependencies, "find_transactions", {
    cursor: first.next_cursor,
  });
  assert.equal(expired.isError, true);
  const restarted = content(
    await call(dependencies, "find_transactions", { ...range, limit: 1 }),
  );
  assert.equal(
    z
      .array(z.object({ transaction_ref: z.string() }))
      .parse(restarted.transactions)[0].transaction_ref,
    before,
  );
});
test("MCP recurring results honor canonical owner filters, evidence coverage and bounded paging", async () => {
  const { INITIAL_OWNER_RULES } = await import("../analysis/rule-store");
  const { dependencies } = syntheticBank();
  dependencies.getSession = async () => ({ accounts: ["private-account-one"] });
  dependencies.listFinancialRules = async () => INITIAL_OWNER_RULES;
  const today = new Date().toISOString().slice(0, 10);
  dependencies.getAllAccountTransactions = async () =>
    ["2026-08-01", "2026-09-01", "2026-10-01"].flatMap((date, index) =>
      ["Awx*JoinBrands", "Amazon Prime"].map((merchant) => ({
        status: "BOOK",
        booking_date: date,
        credit_debit_indicator: "DBIT",
        creditor: { name: merchant },
        transaction_amount: {
          amount: index === 2 ? "10.99" : "9.99",
          currency: "EUR",
        },
      })),
    );
  const request = {
    date_from: "2026-08-01",
    date_to: today,
    purpose: "business",
    project: "INCREMNT",
    currency: "EUR",
  };
  const output = content(
    await call(dependencies, "get_recurring_transactions", request),
  );
  const recurring = z
    .array(z.record(z.string(), z.unknown()))
    .parse(output.recurring);
  assert.equal(recurring.length, 1);
  assert.equal(recurring[0].merchant, "Join Brands");
  assert.equal(recurring[0].cadence, "monthly");
  assert.equal(recurring[0].charge_state, "overdue_not_observed");
  assert.equal(recurring[0].provider_history_complete, "unknown");
  const historical = content(
    await call(dependencies, "get_recurring_transactions", {
      ...request,
      date_to: "2026-10-31",
    }),
  );
  assert.equal(
    z
      .array(z.object({ overdue_not_observed: z.null() }))
      .parse(historical.recurring).length,
    1,
  );
  const paged = content(
    await call(dependencies, "get_recurring_transactions", {
      date_from: "2026-08-01",
      date_to: today,
      limit: 1,
    }),
  );
  assert.equal(z.array(z.unknown()).parse(paged.recurring).length, 1);
  assert.equal(paged.matched_count, 2);
  assert.equal(paged.next_offset, 1);
});
test("MCP discards data from a connection replaced while its fetch was running", async () => {
  const { dependencies } = syntheticBank();
  const original = dependencies.getBankConnection;
  let replaced = false;
  dependencies.getBankConnection = async (subject) => {
    const result = await original(subject);
    return result && replaced
      ? { ...result, connectionId: "replacement-generation" }
      : result;
  };
  dependencies.getAllAccountTransactions = async () => {
    replaced = true;
    return [];
  };
  const result = await call(dependencies, "get_transaction_totals", range);
  assert.equal(result.isError, true);
  assert.equal(
    z.object({ code: z.string() }).parse(content(result).error).code,
    "connection_changed",
  );
});
test("MCP discards provider session status when a reconnect replaces the connection", async () => {
  const { dependencies } = syntheticBank();
  const original = dependencies.getBankConnection;
  let replaced = false;
  dependencies.getBankConnection = async (subject) => {
    const result = await original(subject);
    return result && replaced
      ? {
          ...result,
          connectionId: "replacement-generation",
          connectedAt: "2026-11-13",
        }
      : result;
  };
  dependencies.getSession = async () => {
    replaced = true;
    return {
      accounts: ["private-account-one"],
      access: { valid_until: "2027-02-01T00:00:00Z" },
    };
  };
  const result = await call(dependencies, "get_connection_status", {});
  assert.equal(result.isError, true);
  assert.equal(
    z.object({ code: z.string() }).parse(content(result).error).code,
    "connection_changed",
  );
  assert.equal(content(result).consent, undefined);
});
test("MCP historical recurrence cannot borrow coverage from a concurrent newer read", async (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-11-13T12:00:00Z"),
  });
  const { dependencies } = syntheticBank();
  dependencies.getSession = async () => ({ accounts: ["private-account-one"] });
  let releaseHistorical!: (rows: EnableBankingTransaction[]) => void;
  const historicalRows = new Promise<EnableBankingTransaction[]>((resolve) => {
    releaseHistorical = resolve;
  });
  let historicalStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    historicalStarted = resolve;
  });
  const charge = (date: string): EnableBankingTransaction => ({
    status: "BOOK",
    booking_date: date,
    credit_debit_indicator: "DBIT",
    creditor: { name: "Recurring service" },
    transaction_amount: { amount: "10.00", currency: "EUR" },
  });
  dependencies.getAllAccountTransactions = async (_accountId, query) => {
    if (query?.dateTo === "2026-10-31") {
      historicalStarted();
      return historicalRows;
    }
    return [charge("2026-11-01")];
  };
  const historical = call(dependencies, "get_recurring_transactions", {
    date_from: "2026-08-01",
    date_to: "2026-10-31",
  });
  await started;
  try {
    const newer = content(
      await call(dependencies, "find_transactions", {
        date_from: "2026-11-01",
        date_to: "2026-11-13",
      }),
    );
    assert.equal(newer.matched_count, 1);
  } finally {
    releaseHistorical([
      charge("2026-08-01"),
      charge("2026-09-01"),
      charge("2026-10-01"),
    ]);
  }
  const output = content(await historical);
  const [recurring] = z
    .array(z.record(z.string(), z.unknown()))
    .parse(output.recurring);
  assert.equal(recurring.next_expected_date, "2026-11-01");
  assert.equal(recurring.overdue_not_observed, null);
  assert.equal(recurring.charge_state, "insufficient_evidence");
  assert.equal(recurring.evidence_reason, "insufficient_date_coverage");
  const [status] = z
    .array(
      z.object({
        last_success: z.object({
          date_to: z.string(),
          latest_booked_transaction_date: z.string(),
        }),
      }),
    )
    .parse(output.data_status);
  assert.equal(status.last_success.date_to, "2026-11-13");
  assert.equal(
    status.last_success.latest_booked_transaction_date,
    "2026-11-01",
  );
});

test("MCP account summary rejects a connection replaced during account details", async () => {
  const { dependencies } = syntheticBank();
  const getConnection = dependencies.getBankConnection;
  let replaced = false;
  dependencies.getBankConnection = async (subject) => {
    const connection = await getConnection(subject);
    return connection && replaced
      ? { ...connection, connectionId: "new-generation" }
      : connection;
  };
  dependencies.getAccountDetails = async () => {
    replaced = true;
    return { cash_account_type: "CARD", currency: "EUR" };
  };
  const result = await call(dependencies, "get_account_summary", range);
  assert.equal(result.isError, true);
  assert.equal(
    z.object({ code: z.string() }).parse(content(result).error).code,
    "connection_changed",
  );
  assert.equal(content(result).accounts, undefined);
});

for (const name of ["get_connection_status", "find_transactions"])
  test(`MCP ${name} rejects a connection replaced during observation lookup`, async () => {
    const { dependencies } = syntheticBank();
    const getConnection = dependencies.getBankConnection;
    let replaced = false;
    dependencies.getBankConnection = async (subject) => {
      const connection = await getConnection(subject);
      return connection && replaced
        ? { ...connection, connectionId: "new-generation" }
        : connection;
    };
    dependencies.getAccountFetchObservations = async () => {
      replaced = true;
      return [];
    };
    const result = await call(
      dependencies,
      name,
      name === "find_transactions" ? range : {},
    );
    assert.equal(result.isError, true);
    assert.equal(
      z.object({ code: z.string() }).parse(content(result).error).code,
      "connection_changed",
    );
    assert.equal(content(result).consent, undefined);
  });
