import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

import { analyzeSpending, getSpendingTransactions } from "@/lib/analysis/engine";
import type { SpendingTransaction } from "@/lib/analysis/types";
import { getBankConnection } from "@/lib/connections/store";
import { getSessionOverview } from "@/lib/enable-banking/client";
import { MCP_ACCESS_SCOPE } from "@/lib/mcp/auth";

const dateProperty = {
  description: "ISO date in YYYY-MM-DD format.",
  pattern: "^\\d{4}-\\d{2}-\\d{2}$",
  type: "string",
} as const;

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
  tool("get_connection_status", "Check whether this user has connected Revolut and when consent expires.", {}),
  tool(
    "get_account_summary",
    "Return privacy-safe account balances and transaction counts. Does not expose account IDs or IBANs.",
    { date_from: dateProperty, date_to: dateProperty },
  ),
  tool(
    "summarize_spending",
    "Summarize discretionary spending, fixed-cost context, subscriptions, and the clearest savings levers for a date range.",
    { date_from: dateProperty, date_to: dateProperty },
  ),
  tool(
    "find_transactions",
    "Find privacy-safe transactions by date, merchant text, category, or amount. Returns at most 50 rows and never returns bank identifiers.",
    {
      category: { description: "Exact analysis category key, such as grocery or subscriptions.", type: "string" },
      date_from: dateProperty,
      date_to: dateProperty,
      limit: { default: 20, maximum: 50, minimum: 1, type: "integer" },
      max_amount: { description: "Maximum absolute transaction amount.", minimum: 0, type: "number" },
      merchant: { description: "Case-insensitive text contained in the merchant label.", type: "string" },
      min_amount: { description: "Minimum absolute transaction amount.", minimum: 0, type: "number" },
    },
  ),
  tool(
    "compare_spending_periods",
    "Compare two explicit spending periods using the same conservative classification rules.",
    {
      current_from: dateProperty,
      current_to: dateProperty,
      previous_from: dateProperty,
      previous_to: dateProperty,
    },
    ["current_from", "current_to", "previous_from", "previous_to"],
  ),
];

export function createMcpServer(subject: string, appBaseUrl: string) {
  const server = new Server(
    { name: "give-yourself-a-raise", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: CHATGPT_TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      return await executeTool(subject, appBaseUrl, request.params.name, request.params.arguments ?? {});
    } catch (error) {
      return toolError(error instanceof Error ? error.message : "The bank-data request failed.");
    }
  });

  return server;
}

async function executeTool(
  subject: string,
  appBaseUrl: string,
  name: string,
  rawArguments: Record<string, unknown>,
): Promise<CallToolResult> {
  const connection = await getBankConnection(subject);

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
          message: "Open the connection URL to link Revolut, then retry this tool.",
        };

    return toolSuccess(result);
  }

  if (!connection) {
    return toolError(
      `No Revolut connection exists for this user. Connect it at ${new URL("/", appBaseUrl).toString()}`,
    );
  }

  if (name === "get_account_summary") {
    const range = readDateRange(rawArguments, 30);
    const overview = await getSessionOverview(connection.sessionId, range);
    const result = {
      accounts: overview.accounts.map((account) => ({
        balances: account.balances.map((balance) => ({
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
    const overview = await getSessionOverview(connection.sessionId, range);
    return toolSuccess({
      date_from: range.dateFrom,
      date_to: range.dateTo,
      ...analyzeSpending(overview.accounts, { windowDays: range.windowDays }),
    });
  }

  if (name === "find_transactions") {
    const range = readDateRange(rawArguments, 30);
    const overview = await getSessionOverview(connection.sessionId, range);
    const merchant = optionalString(rawArguments.merchant)?.toLowerCase();
    const category = optionalString(rawArguments.category);
    const minAmount = optionalNonNegativeNumber(rawArguments.min_amount);
    const maxAmount = optionalNonNegativeNumber(rawArguments.max_amount);
    const limit = integerInRange(rawArguments.limit, 20, 1, 50);
    const transactions = getSpendingTransactions(overview.accounts).filter((transaction) =>
      matchesTransaction(transaction, { category, maxAmount, merchant, minAmount }),
    );
    return toolSuccess({
      date_from: range.dateFrom,
      date_to: range.dateTo,
      matched_count: transactions.length,
      transactions: transactions.slice(0, limit),
      truncated: transactions.length > limit,
    });
  }

  if (name === "compare_spending_periods") {
    const current = readNamedDateRange(rawArguments, "current_from", "current_to");
    const previous = readNamedDateRange(rawArguments, "previous_from", "previous_to");
    const [currentOverview, previousOverview] = await Promise.all([
      getSessionOverview(connection.sessionId, current),
      getSessionOverview(connection.sessionId, previous),
    ]);
    const currentAnalysis = analyzeSpending(currentOverview.accounts, {
      windowDays: current.windowDays,
    });
    const previousAnalysis = analyzeSpending(previousOverview.accounts, {
      windowDays: previous.windowDays,
    });
    const currentSpend = currentAnalysis.baseline?.discretionaryMonthlySpend ?? 0;
    const previousSpend = previousAnalysis.baseline?.discretionaryMonthlySpend ?? 0;
    return toolSuccess({
      current: { date_from: current.dateFrom, date_to: current.dateTo, analysis: currentAnalysis },
      discretionary_monthly_change: roundCurrency(currentSpend - previousSpend),
      previous: { date_from: previous.dateFrom, date_to: previous.dateTo, analysis: previousAnalysis },
    });
  }

  return toolError(`Unknown tool: ${name}`);
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
    inputSchema: { properties, required, type: "object" },
    name,
    securitySchemes: authenticatedSecurity,
    title: name.split("_").map(capitalize).join(" "),
  };
}

function readDateRange(values: Record<string, unknown>, defaultDays: number) {
  const today = new Date();
  const fallbackTo = formatDate(today);
  const fallbackFrom = formatDate(new Date(today.getTime() - defaultDays * 24 * 60 * 60 * 1000));
  return validateRange(
    optionalString(values.date_from) ?? fallbackFrom,
    optionalString(values.date_to) ?? fallbackTo,
  );
}

function readNamedDateRange(values: Record<string, unknown>, fromKey: string, toKey: string) {
  const from = requiredString(values[fromKey], fromKey);
  const to = requiredString(values[toKey], toKey);
  return validateRange(from, to);
}

function validateRange(dateFrom: string, dateTo: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    throw new Error("Dates must use YYYY-MM-DD format.");
  }

  const from = new Date(`${dateFrom}T00:00:00Z`);
  const to = new Date(`${dateTo}T00:00:00Z`);
  const days = (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);

  if (!Number.isFinite(days) || days < 0) {
    throw new Error("date_from must be on or before date_to.");
  }

  if (days > 366) {
    throw new Error("A bank-data request cannot span more than 366 days.");
  }

  return { dateFrom, dateTo, windowDays: Math.max(1, days) };
}

function matchesTransaction(
  transaction: SpendingTransaction,
  filters: {
    category?: string;
    maxAmount?: number;
    merchant?: string;
    minAmount?: number;
  },
) {
  const amount = Math.abs(transaction.amount);
  return (
    (!filters.category || transaction.categoryKey === filters.category) &&
    (!filters.merchant || transaction.merchant.toLowerCase().includes(filters.merchant)) &&
    (filters.minAmount === undefined || amount >= filters.minAmount) &&
    (filters.maxAmount === undefined || amount <= filters.maxAmount)
  );
}

function toolSuccess(structuredContent: Record<string, unknown>): CallToolResult {
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

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredString(value: unknown, field: string) {
  const parsed = optionalString(value);
  if (!parsed) throw new Error(`${field} is required.`);
  return parsed;
}

function optionalNonNegativeNumber(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("Amount filters must be non-negative numbers.");
  }
  return value;
}

function integerInRange(value: unknown, fallback: number, min: number, max: number) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || typeof value !== "number" || value < min || value > max) {
    throw new Error(`limit must be an integer from ${min} to ${max}.`);
  }
  return value;
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
