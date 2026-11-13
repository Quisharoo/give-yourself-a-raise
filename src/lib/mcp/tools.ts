import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

import { analyzeSpending } from "@/lib/analysis/engine";
import { getBankConnection } from "@/lib/connections/store";
import {
  getAccountDetails,
  getSession,
  getAccountBalances,
  getAllAccountTransactions,
} from "@/lib/enable-banking/client";
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
  selectAccounts,
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
const transactionProperties = {
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
    "Check whether this user has connected Revolut and when consent expires.",
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
      limit: { default: 20, maximum: 50, minimum: 1, type: "integer" },
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
      account_refs: accountRefsProperty,
      current_from: dateProperty,
      current_to: dateProperty,
      previous_from: dateProperty,
      previous_to: dateProperty,
    },
    ["current_from", "current_to", "previous_from", "previous_to"],
  ),
];

const bankDependencies = {
  getBankConnection,
  getSession,
  getAccountDetails,
  getAccountBalances,
  getAllAccountTransactions,
};
export type McpBankDependencies = typeof bankDependencies;

export function createMcpServer(
  subject: string,
  appBaseUrl: string,
  dependencies: McpBankDependencies = bankDependencies,
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
      return toolError(
        error instanceof TransactionInputError
          ? error.message
          : "The bank-data request failed. Retry or reconnect your bank.",
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
  const connection = await dependencies.getBankConnection(subject);

  if (name === "get_connection_status") {
    const result = connection
      ? {
          connected: true,
          connected_at: connection.connectedAt,
          consent_expires_at: connection.consentExpiresAt,
          country: connection.country,
          provider: connection.provider,
        }
      : {
          connect_url: new URL("/", appBaseUrl).toString(),
          connected: false,
          message:
            "Open the connection URL to link Revolut, then retry this tool.",
        };

    return toolSuccess(result);
  }

  if (!connection) {
    return toolError(
      `No Revolut connection exists for this user. Connect it at ${new URL("/", appBaseUrl).toString()}`,
    );
  }

  const scope = { subject, sessionId: connection.sessionId };
  async function loadAccounts(
    range: { dateFrom: string; dateTo: string },
    refs?: string[],
    status?: string,
  ) {
    const session = await dependencies.getSession(scope.sessionId);
    const accounts = selectAccounts(session, scope, refs);
    return Promise.all(
      accounts.map(async (account) => ({
        accountId: account.uid,
        balances: [],
        name: account.name,
        transactions: await dependencies.getAllAccountTransactions(
          account.uid,
          {
            ...range,
            ...(status && status !== "all" && status !== "UNKNOWN"
              ? { transactionStatus: status }
              : {}),
          },
        ),
      })),
    );
  }

  if (name === "get_account_summary") {
    const range = readDateRange(rawArguments, 30);
    const accounts = await loadAccounts(range);
    const details = await Promise.all(
      accounts.map((account) =>
        dependencies.getAccountDetails(account.accountId).catch(() => null),
      ),
    );
    const balances = await Promise.all(
      accounts.map((account) =>
        dependencies.getAccountBalances(account.accountId),
      ),
    );
    const result = {
      accounts: accounts.map((account, index) => ({
        account_ref: accountRef(scope, account.accountId),
        account_type: safeAccountType(details[index]?.cash_account_type),
        currency: safeAccountCurrency(details[index]?.currency),
        details_available: details[index] !== null,
        balances: balances[index].map((balance) => ({
          amount: Number(balance.balance_amount.amount),
          currency: balance.balance_amount.currency,
          type: balance.balance_type ?? null,
        })),
        name: account.name ?? "Revolut account",
        transaction_count: account.transactions.length,
      })),
      date_from: range.dateFrom,
      date_to: range.dateTo,
    };
    return toolSuccess(result);
  }

  if (name === "summarize_spending") {
    const range = readDateRange(rawArguments, 90);
    const accounts = await loadAccounts(range, readAccountRefs(rawArguments));
    return toolSuccess({
      date_from: range.dateFrom,
      date_to: range.dateTo,
      ...analyzeSpending(accounts, { windowDays: range.windowDays }),
    });
  }

  if (name === "find_transactions" || name === "get_transaction_totals") {
    const paging = name === "find_transactions";
    const request = readTransactionQuery(rawArguments, scope, paging);
    const accounts = await loadAccounts(
      dateRange(request.query.date_from, request.query.date_to),
      request.query.account_refs,
      request.query.status,
    );
    return toolSuccess(
      transactionResult(
        queryTransactions(accounts, request.query, scope),
        request,
        scope,
        paging,
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
    const [currentOverview, previousOverview] = await Promise.all([
      loadAccounts(current, readAccountRefs(rawArguments)),
      loadAccounts(previous, readAccountRefs(rawArguments)),
    ]);
    const currentAnalysis = analyzeSpending(currentOverview, {
      windowDays: current.windowDays,
    });
    const previousAnalysis = analyzeSpending(previousOverview, {
      windowDays: previous.windowDays,
    });
    const currentSpend =
      currentAnalysis.baseline?.discretionaryMonthlySpend ?? 0;
    const previousSpend =
      previousAnalysis.baseline?.discretionaryMonthlySpend ?? 0;
    return toolSuccess({
      current: {
        date_from: current.dateFrom,
        date_to: current.dateTo,
        analysis: currentAnalysis,
      },
      discretionary_monthly_change: roundCurrency(currentSpend - previousSpend),
      previous: {
        date_from: previous.dateFrom,
        date_to: previous.dateTo,
        analysis: previousAnalysis,
      },
    });
  }

  return toolError(`Unknown tool: ${name}`);
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

function toolError(message: string): CallToolResult {
  return {
    content: [{ text: message, type: "text" }],
    isError: true,
  };
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
