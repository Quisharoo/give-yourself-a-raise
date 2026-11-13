import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

import { analyzeSpending } from "@/lib/analysis/engine";
import {
  bankDependencies,
  readBankSession,
  readBankAccounts,
  safeBankFailure,
  BankReadError,
  balanceOutput,
  assertCurrentConnection,
} from "@/lib/banking/reader";
import { listFinancialRules } from "@/lib/analysis/rule-store";
import {
  financialFilterShape,
  type FinancialFilter,
} from "@/lib/analysis/classification";
import { analysisOutput } from "./presentation";
import { detectRecurring } from "@/lib/analysis/recurring";
import type { AccountFetchObservation } from "@/lib/connections/store";
import { z } from "zod";
import {
  BANK_TRANSACTION_STATUSES,
  TransactionInputError,
} from "@/lib/transactions";
import {
  accountRef,
  dateRange,
  defaultDateRange,
  queryTransactions,
  readTransactionQuery,
  transactionResult,
} from "./transaction-query";
import { MCP_ACCESS_SCOPE } from "@/lib/mcp/auth";

const dateProperty = {
  description: "ISO date in YYYY-MM-DD format.",
  pattern: "^\\d{4}-\\d{2}-\\d{2}$",
  type: "string",
} as const;

const accountRefsProperty = {
  description:
    "Opaque references from get_account_summary for this user and bank connection. Omit for all linked accounts.",
  type: "array",
  minItems: 1,
  items: { type: "string" },
};
const financialProperties = {
  purpose: { type: "string", enum: ["business", "personal", "unassigned"] },
  project: {
    type: "string",
    description: "Exact project label, such as INCREMNT.",
  },
  flow_kind: {
    type: "string",
    enum: ["expense", "income", "revenue", "refund", "transfer", "unknown"],
  },
  currency: { type: "string", pattern: "^[A-Z]{3}$" },
};
const transactionProperties = {
  ...financialProperties,
  status: {
    description:
      "BOOK by default. Bank status BOOK/CNCL/HOLD/OTHR/PDNG/RJCT/SCHD, local UNKNOWN, or all. Missing or unrecognized status is UNKNOWN. all includes available bank-returned statuses, not guaranteed full history.",
    type: "string",
    enum: [...BANK_TRANSACTION_STATUSES, "UNKNOWN", "all"],
    default: "BOOK",
  },
  account_refs: accountRefsProperty,
  category: {
    description:
      "Exact analysis category key, such as grocery or subscriptions.",
    type: "string",
  },
  date_from: dateProperty,
  date_to: dateProperty,
  max_amount: {
    description:
      "Maximum absolute amount. A decimal string preserves exact precision.",
    anyOf: [
      { type: "number", minimum: 0 },
      { type: "string", pattern: "^\\d+(?:\\.\\d+)?$" },
    ],
  },
  merchant: {
    description: "Case-insensitive text contained in the merchant label.",
    type: "string",
  },
  min_amount: {
    description:
      "Minimum absolute amount. A decimal string preserves exact precision.",
    anyOf: [
      { type: "number", minimum: 0 },
      { type: "string", pattern: "^\\d+(?:\\.\\d+)?$" },
    ],
  },
};

const authenticatedSecurity = [{ scopes: [MCP_ACCESS_SCOPE], type: "oauth2" }];
const readOnlyAnnotations = {
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
  readOnlyHint: true,
};

type ChatGptTool = Tool & {
  securitySchemes: typeof authenticatedSecurity;
};

export const CHATGPT_TOOLS: ChatGptTool[] = [
  tool(
    "get_connection_status",
    "Check provider-confirmed bank consent, seven-day renewal warnings and persisted per-account fetch observations without reading transactions.",
    {},
  ),
  tool(
    "get_account_summary",
    "Return linked account types, currencies, balances and transaction counts when provided by the bank. CACC is current, CARD is card, SVGS is savings; missing details do not prove an account is absent. Does not expose account IDs or IBANs.",
    { date_from: dateProperty, date_to: dateProperty },
  ),
  tool(
    "summarize_spending",
    "Estimate monthly discretionary spending, fixed costs, subscriptions and savings levers from BOOK transactions only. Excludes pending and unknown status rows with counts.",
    {
      ...financialProperties,
      account_refs: accountRefsProperty,
      date_from: dateProperty,
      date_to: dateProperty,
    },
  ),
  tool(
    "find_transactions",
    "Find transactions with exact whole-result totals by currency and at most 50 rows per page. Continue with next_cursor. Bank data changes require restarting. Never exposes bank identifiers.",
    {
      ...transactionProperties,
      cursor: {
        description:
          "next_cursor from the previous page. Omit unchanged filters or repeat them exactly. Expires after 15 minutes.",
        type: "string",
      },
      detail: {
        type: "string",
        enum: ["compact", "full"],
        default: "compact",
        description:
          "full adds raw merchant descriptor and classification evidence.",
      },
      limit: { default: 50, maximum: 50, minimum: 1, type: "integer" },
    },
  ),
  tool(
    "get_transaction_totals",
    "Return exact debit, credit and signed net decimal totals by currency over all matching bank-returned rows. Does not guarantee complete bank history or reconcile a card balance. Same filters as find_transactions, without rows or paging.",
    transactionProperties,
  ),
  tool(
    "compare_spending_periods",
    "Compare estimated monthly spending in two explicit periods using BOOK transactions only, with excluded status counts.",
    {
      ...financialProperties,
      account_refs: accountRefsProperty,
      current_from: dateProperty,
      current_to: dateProperty,
      previous_from: dateProperty,
      previous_to: dateProperty,
    },
    ["current_from", "current_to", "previous_from", "previous_to"],
  ),
  tool(
    "list_classification_rules",
    "Inspect this user's persisted merchant-purpose and project rules. Read only.",
    {},
  ),
  tool(
    "get_recurring_transactions",
    "Find observed recurring booked expenses, calendar cadence, exact amount changes and guarded overdue-not-observed candidates. Predictions are estimates, not scheduled bank payments or proof of cancellation.",
    {
      ...financialProperties,
      account_refs: accountRefsProperty,
      date_from: dateProperty,
      date_to: dateProperty,
      limit: { type: "integer", default: 50, minimum: 1, maximum: 50 },
      offset: { type: "integer", default: 0, minimum: 0 },
    },
  ),
];

const dependenciesWithRules = { ...bankDependencies, listFinancialRules };
export type McpBankDependencies = typeof dependenciesWithRules;

export function createMcpServer(
  subject: string,
  appBaseUrl: string,
  dependencies: McpBankDependencies = dependenciesWithRules,
) {
  const server = new Server(
    { name: "give-yourself-a-raise", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: CHATGPT_TOOLS,
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      return await executeTool(
        subject,
        appBaseUrl,
        request.params.name,
        request.params.arguments ?? {},
        dependencies,
      );
    } catch (error) {
      if (error instanceof TransactionInputError)
        return toolError("invalid_request", error.message, appBaseUrl);
      const failure = safeBankFailure(error);
      return toolError(
        failure.code,
        failure.message,
        appBaseUrl,
        failure.dataStatus,
      );
    }
  });

  return server;
}

async function executeTool(
  subject: string,
  appBaseUrl: string,
  name: string,
  rawArguments: Record<string, unknown>,
  dependencies: McpBankDependencies,
): Promise<CallToolResult> {
  const storedConnection = await dependencies.getBankConnection(subject);

  if (!storedConnection) {
    if (name === "get_connection_status")
      return toolSuccess({
        connected: false,
        connect_url: new URL("/", appBaseUrl).toString(),
        message: "Open the connection URL to link your bank.",
      });
    return toolError(
      "not_connected",
      "No bank connection exists for this user.",
      appBaseUrl,
    );
  }
  const connection = storedConnection;
  async function connectionSuccess(value: Record<string, unknown>) {
    await assertCurrentConnection(connection, dependencies);
    return toolSuccess(value);
  }
  if (name === "list_classification_rules")
    return connectionSuccess({
      rules: await dependencies.listFinancialRules(subject),
    });
  const scope = { subject, sessionId: connection.sessionId };
  let sessionResult;
  try {
    sessionResult = await readBankSession(connection, dependencies);
  } catch (error) {
    const failure = safeBankFailure(error);
    throw new BankReadError(
      failure.code,
      failure.message,
      await dependencies.getAccountFetchObservations(connection),
    );
  }
  const { session, consent } = sessionResult;
  if (name === "get_connection_status")
    return connectionSuccess({
      connected: true,
      connected_at: connection.connectedAt,
      consent_expires_at: consent.expires_at,
      consent,
      country: connection.country,
      provider: connection.provider,
      reconnect_url: new URL("/", appBaseUrl).toString(),
      data_status: await dependencies.getAccountFetchObservations(connection),
    });
  if (consent.state === "expired")
    throw new BankReadError(
      "consent_expired",
      "Bank consent has expired. Reconnect your bank.",
      await dependencies.getAccountFetchObservations(connection),
    );
  const rules = await dependencies.listFinancialRules(subject);
  let dataStatus: AccountFetchObservation[] = [];
  async function loadAccounts(
    range: { dateFrom: string; dateTo: string },
    refs?: string[],
    status?: string,
    balances = false,
  ) {
    const result = await readBankAccounts(
      connection,
      session,
      dependencies,
      range,
      refs,
      status,
      balances,
    );
    dataStatus = result.dataStatus;
    return result;
  }
  function withStatus(result: Record<string, unknown>) {
    return { ...result, consent, data_status: dataStatus };
  }
  function periodTotals(
    accounts: Parameters<typeof queryTransactions>[0],
    range: { dateFrom: string; dateTo: string },
  ) {
    const request = readTransactionQuery(
      {
        date_from: range.dateFrom,
        date_to: range.dateTo,
        ...readFinancialFilters(rawArguments),
      },
      scope,
      false,
    );
    return transactionResult(
      queryTransactions(accounts, request.query, scope, rules),
      request,
      scope,
      false,
    );
  }

  if (name === "get_account_summary") {
    const range = readDateRange(rawArguments, 30);
    const { accounts } = await loadAccounts(range, undefined, "all", true);
    const details = await Promise.all(
      accounts.map((account) =>
        dependencies
          .getAccountDetails(account.accountId)
          .catch((error: unknown) => {
            const failure = safeBankFailure(error);
            if (failure.code === "consent_expired") throw failure;
            return null;
          }),
      ),
    );
    const result = {
      accounts: accounts.map((account, index) => ({
        account_ref: accountRef(scope, account.accountId),
        account_type: safeAccountType(details[index]?.cash_account_type),
        currency: safeAccountCurrency(details[index]?.currency),
        details_available: details[index] !== null,
        balances: account.balances.map(balanceOutput),
        name: `Linked account ${index + 1}`,
        transaction_count: account.transactions.length,
      })),
      date_from: range.dateFrom,
      date_to: range.dateTo,
    };
    return connectionSuccess(withStatus(result));
  }

  if (name === "summarize_spending") {
    const range = readDateRange(rawArguments, 90);
    const { accounts } = await loadAccounts(
      range,
      readAccountRefs(rawArguments),
    );
    return connectionSuccess(
      withStatus({
        ...periodTotals(accounts, range),
        ...analysisOutput(
          analyzeSpending(accounts, {
            windowDays: range.windowDays,
            rules,
            filters: readFinancialFilters(rawArguments),
          }),
        ),
      }),
    );
  }

  if (name === "find_transactions" || name === "get_transaction_totals") {
    const paging = name === "find_transactions";
    const request = readTransactionQuery(rawArguments, scope, paging);
    const { accounts } = await loadAccounts(
      dateRange(request.query.date_from, request.query.date_to),
      request.query.account_refs,
      request.query.status,
    );
    return connectionSuccess(
      withStatus(
        transactionResult(
          queryTransactions(accounts, request.query, scope, rules),
          request,
          scope,
          paging,
        ),
      ),
    );
  }

  if (name === "compare_spending_periods") {
    const current = readNamedDateRange(
      rawArguments,
      "current_from",
      "current_to",
    );
    const previous = readNamedDateRange(
      rawArguments,
      "previous_from",
      "previous_to",
    );
    const [{ accounts: currentOverview }, { accounts: previousOverview }] =
      await Promise.all([
        loadAccounts(current, readAccountRefs(rawArguments)),
        loadAccounts(previous, readAccountRefs(rawArguments)),
      ]);
    const currentAnalysis = analyzeSpending(currentOverview, {
      windowDays: current.windowDays,
      rules,
      filters: readFinancialFilters(rawArguments),
    });
    const previousAnalysis = analyzeSpending(previousOverview, {
      windowDays: previous.windowDays,
      rules,
      filters: readFinancialFilters(rawArguments),
    });
    const currentSpend =
      currentAnalysis.baseline?.discretionaryMonthlySpend ?? 0;
    const previousSpend =
      previousAnalysis.baseline?.discretionaryMonthlySpend ?? 0;
    return connectionSuccess(
      withStatus({
        current: {
          ...periodTotals(currentOverview, current),
          analysis: analysisOutput(currentAnalysis),
        },
        discretionary_monthly_change: roundCurrency(
          currentSpend - previousSpend,
        ),
        previous: {
          ...periodTotals(previousOverview, previous),
          analysis: analysisOutput(previousAnalysis),
        },
      }),
    );
  }
  if (name === "get_recurring_transactions") {
    const range = readDateRange(rawArguments, 366);
    const { accounts, transactionEvidence } = await loadAccounts(
      range,
      readAccountRefs(rawArguments),
      "all",
    );
    const paging = z
      .object({
        limit: z.number().int().min(1).max(50).default(50),
        offset: z.number().int().min(0).default(0),
      })
      .safeParse(rawArguments);
    if (!paging.success)
      throw new TransactionInputError(
        "Recurring limit must be 1 to 50 and offset must be nonnegative.",
      );
    const recurring = detectRecurring(
      accounts,
      rules,
      readFinancialFilters(rawArguments),
      scope,
      transactionEvidence,
    );
    const end = paging.data.offset + paging.data.limit;
    return connectionSuccess(
      withStatus({
        date_from: range.dateFrom,
        date_to: range.dateTo,
        recurring: recurring.slice(paging.data.offset, end),
        matched_count: recurring.length,
        next_offset: end < recurring.length ? end : null,
        paging_note:
          "Offsets refer to this live result. If bank data changes, restart at offset zero.",
        estimate:
          "Cadence and next dates are estimates from returned BOOK expenses. Overdue means a charge was not observed, not proof it was not billed. Bank history completeness is unknown.",
      }),
    );
  }
  return toolError("unknown_tool", "Unknown banking tool.", appBaseUrl);
}

export function safeAccountType(value: unknown): string | null {
  return typeof value === "string" &&
    ["CACC", "CASH", "CARD", "LOAN", "SVGS", "OTHR"].includes(value)
    ? value
    : null;
}

export function safeAccountCurrency(value: unknown): string | null {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value) ? value : null;
}

function tool(
  name: string,
  description: string,
  properties: Record<string, object>,
  required: string[] = [],
): ChatGptTool {
  return {
    _meta: { securitySchemes: authenticatedSecurity },
    annotations: readOnlyAnnotations,
    description,
    inputSchema: {
      additionalProperties: false,
      properties,
      required,
      type: "object",
    },
    name,
    securitySchemes: authenticatedSecurity,
    title: name.split("_").map(capitalize).join(" "),
  };
}

const rangeSchema = z.object({
  date_from: z.string().optional(),
  date_to: z.string().optional(),
});
function readDateRange(values: Record<string, unknown>, defaultDays: number) {
  const parsed = rangeSchema.safeParse(values);
  if (!parsed.success)
    throw new TransactionInputError("Dates must use YYYY-MM-DD format.");
  const defaults = defaultDateRange(defaultDays);
  return dateRange(
    parsed.data.date_from ?? defaults.date_from,
    parsed.data.date_to ?? defaults.date_to,
  );
}

function readNamedDateRange(
  values: Record<string, unknown>,
  fromKey: string,
  toKey: string,
) {
  const from = values[fromKey];
  const to = values[toKey];
  if (typeof from !== "string" || typeof to !== "string")
    throw new TransactionInputError(`${fromKey} and ${toKey} are required.`);
  return dateRange(from, to);
}

function readAccountRefs(values: Record<string, unknown>) {
  const parsed = z
    .array(z.string())
    .nonempty()
    .optional()
    .safeParse(values.account_refs);
  if (!parsed.success)
    throw new TransactionInputError(
      "account_refs must be a nonempty array of account references.",
    );
  return parsed.data;
}

function toolSuccess(
  structuredContent: Record<string, unknown>,
): CallToolResult {
  return {
    content: [{ text: JSON.stringify(structuredContent), type: "text" }],
    structuredContent,
  };
}

function toolError(
  code: string,
  message: string,
  appBaseUrl: string,
  dataStatus: AccountFetchObservation[] = [],
): CallToolResult {
  const structuredContent = {
    error: {
      code,
      message,
      reconnect_url: new URL("/", appBaseUrl).toString(),
    },
    data_status: dataStatus,
  };
  return {
    content: [{ text: JSON.stringify(structuredContent), type: "text" }],
    structuredContent,
    isError: true,
  };
}
function readFinancialFilters(raw: Record<string, unknown>): FinancialFilter {
  const parsed = z.object(financialFilterShape).safeParse(raw);
  if (!parsed.success)
    throw new TransactionInputError(
      "Invalid purpose, project, flow_kind or currency filter.",
    );
  return parsed.data;
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
