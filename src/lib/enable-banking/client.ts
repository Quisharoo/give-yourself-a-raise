import { randomUUID, sign } from "node:crypto";
import { readFileSync } from "node:fs";

import type {
  EnableBankingApplication,
  EnableBankingAspsp,
  EnableBankingAspspListResponse,
  EnableBankingAuthorizationResponse,
  EnableBankingBalancesResponse,
  EnableBankingPsuType,
  EnableBankingSession,
  EnableBankingSessionAccountReference,
  EnableBankingSessionOverview,
  EnableBankingTransactionsResponse,
} from "@/lib/enable-banking/types";

const ENABLE_BANKING_BASE_URL = "https://api.enablebanking.com";
const ENABLE_BANKING_AUDIENCE = "api.enablebanking.com";
const ENABLE_BANKING_ISSUER = "enablebanking.com";

export const ENABLE_BANKING_SESSION_COOKIE = "enable_banking_session_id";
export const ENABLE_BANKING_STATE_COOKIE = "enable_banking_state";

type PsuHeaders = Partial<Record<
  | "Psu-Accept"
  | "Psu-Accept-Charset"
  | "Psu-Accept-Encoding"
  | "Psu-Accept-Language"
  | "Psu-Ip-Address"
  | "Psu-Referer"
  | "Psu-User-Agent",
  string
>>;

type JsonValue =
  | boolean
  | null
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

interface EnableBankingConfig {
  applicationId: string;
  callbackUrl?: string;
  privateKeyPem: string;
}

interface EnableBankingRequestInit extends Omit<RequestInit, "body" | "headers"> {
  body?: JsonValue;
  headers?: HeadersInit;
}

interface StartAuthorizationInput {
  aspsp: {
    country: string;
    name: string;
  };
  psuHeaders?: PsuHeaders;
  psuType?: EnableBankingPsuType;
  redirectUrl: string;
  state: string;
  validUntil?: string;
}

interface TransactionsQuery {
  continuationKey?: string;
  dateFrom?: string;
  dateTo?: string;
  strategy?: "default" | "longest";
  transactionStatus?: string;
}

export class EnableBankingError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "EnableBankingError";
  }
}

export function hasEnableBankingConfig(): boolean {
  return Boolean(getEnableBankingConfig());
}

export function getEnableBankingConfig(): EnableBankingConfig | null {
  const applicationId = process.env.ENABLE_BANKING_APPLICATION_ID?.trim();
  const privateKeyPem = readEnableBankingPrivateKey();

  if (!applicationId || !privateKeyPem) {
    return null;
  }

  return {
    applicationId,
    callbackUrl: process.env.ENABLE_BANKING_CALLBACK_URL?.trim(),
    privateKeyPem,
  };
}

export function createEnableBankingState(): string {
  return randomUUID();
}

export function getEnableBankingCallbackUrl(origin?: string): string {
  const config = requireEnableBankingConfig();

  if (config.callbackUrl) {
    return config.callbackUrl;
  }

  const appBaseUrl = process.env.APP_BASE_URL?.trim() || origin;

  if (!appBaseUrl) {
    throw new EnableBankingError(
      "Missing APP_BASE_URL or ENABLE_BANKING_CALLBACK_URL for Enable Banking redirect handling.",
    );
  }

  return new URL("/api/enable-banking/callback", appBaseUrl).toString();
}

export function extractPsuHeaders(headers: Headers): PsuHeaders {
  const forwardedFor = headers.get("x-forwarded-for");
  const forwardedIp = forwardedFor?.split(",")[0]?.trim();

  const psuHeaders: PsuHeaders = {
    "Psu-Accept": headers.get("accept") ?? undefined,
    "Psu-Accept-Charset": headers.get("accept-charset") ?? undefined,
    "Psu-Accept-Encoding": headers.get("accept-encoding") ?? undefined,
    "Psu-Accept-Language": headers.get("accept-language") ?? undefined,
    "Psu-Ip-Address":
      forwardedIp || headers.get("x-real-ip") || headers.get("cf-connecting-ip") || undefined,
    "Psu-Referer": headers.get("referer") ?? undefined,
    "Psu-User-Agent": headers.get("user-agent") ?? undefined,
  };

  return Object.fromEntries(
    Object.entries(psuHeaders).filter((entry): entry is [keyof PsuHeaders, string] =>
      Boolean(entry[1]),
    ),
  );
}

export async function getApplication(): Promise<EnableBankingApplication> {
  return enableBankingRequest<EnableBankingApplication>("/application");
}

export async function listAspsps(country: string): Promise<EnableBankingAspsp[]> {
  const params = new URLSearchParams({
    country: country.toUpperCase(),
  });
  const response = await enableBankingRequest<EnableBankingAspspListResponse>(
    `/aspsps?${params.toString()}`,
  );
  return response.aspsps;
}

export async function findAspsps(country: string, query?: string): Promise<EnableBankingAspsp[]> {
  const aspsps = await listAspsps(country);
  const normalizedQuery = query?.trim().toLowerCase();

  if (!normalizedQuery) {
    return aspsps;
  }

  return aspsps.filter((aspsp) => aspsp.name.toLowerCase().includes(normalizedQuery));
}

export async function startAuthorization({
  aspsp,
  psuHeaders,
  psuType = "personal",
  redirectUrl,
  state,
  validUntil,
}: StartAuthorizationInput): Promise<EnableBankingAuthorizationResponse> {
  const consentExpiry =
    validUntil ?? new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();

  return enableBankingRequest<EnableBankingAuthorizationResponse>("/auth", {
    body: {
      access: {
        valid_until: consentExpiry,
      },
      aspsp,
      psu_type: psuType,
      redirect_url: redirectUrl,
      state,
    },
    headers: psuHeaders,
    method: "POST",
  });
}

export async function createSession(code: string, psuHeaders?: PsuHeaders): Promise<EnableBankingSession> {
  return enableBankingRequest<EnableBankingSession>("/sessions", {
    body: {
      code,
    },
    headers: psuHeaders,
    method: "POST",
  });
}

export async function getSession(sessionId: string): Promise<EnableBankingSession> {
  return enableBankingRequest<EnableBankingSession>(`/sessions/${sessionId}`);
}

export async function getAccountBalances(accountId: string, psuHeaders?: PsuHeaders) {
  const response = await enableBankingRequest<EnableBankingBalancesResponse>(
    `/accounts/${accountId}/balances`,
    {
      headers: psuHeaders,
    },
  );
  return response.balances;
}

export async function getAccountTransactions(
  accountId: string,
  query: TransactionsQuery = {},
  psuHeaders?: PsuHeaders,
) {
  const params = new URLSearchParams();

  if (query.continuationKey) {
    params.set("continuation_key", query.continuationKey);
  }
  if (query.dateFrom) {
    params.set("date_from", query.dateFrom);
  }
  if (query.dateTo) {
    params.set("date_to", query.dateTo);
  }
  if (query.strategy) {
    params.set("strategy", query.strategy);
  }
  if (query.transactionStatus) {
    params.set("transaction_status", query.transactionStatus);
  }

  const suffix = params.size > 0 ? `?${params.toString()}` : "";

  return enableBankingRequest<EnableBankingTransactionsResponse>(
    `/accounts/${accountId}/transactions${suffix}`,
    {
      headers: psuHeaders,
    },
  );
}

export async function getAllAccountTransactions(
  accountId: string,
  query: Omit<TransactionsQuery, "continuationKey"> = {},
  psuHeaders?: PsuHeaders,
) {
  const transactions: EnableBankingTransactionsResponse["transactions"] = [];
  let continuationKey: string | undefined;

  do {
    const page = await getAccountTransactions(
      accountId,
      {
        ...query,
        continuationKey,
      },
      psuHeaders,
    );

    transactions.push(...page.transactions);
    continuationKey = page.continuation_key ?? undefined;
  } while (continuationKey);

  return transactions;
}

export async function getSessionOverview(
  sessionId: string,
  query: Omit<TransactionsQuery, "continuationKey"> = {},
  psuHeaders?: PsuHeaders,
): Promise<EnableBankingSessionOverview> {
  const session = await getSession(sessionId);
  const accountReferences = normalizeAccountReferences(session.accounts);

  const accounts = await Promise.all(
    accountReferences.map(async (account) => ({
      accountId: account.uid,
      balances: await getAccountBalances(account.uid, psuHeaders),
      iban: account.iban,
      name: account.name,
      transactions: await getAllAccountTransactions(account.uid, query, psuHeaders),
    })),
  );

  return {
    accounts,
    session,
  };
}

function normalizeAccountReferences(
  accounts: EnableBankingSession["accounts"],
): EnableBankingSessionAccountReference[] {
  return accounts.map((account) => {
    if (typeof account === "string") {
      return { uid: account };
    }

    return {
      iban: account.iban,
      name: account.name,
      uid: account.uid,
    };
  });
}

async function enableBankingRequest<T>(
  path: string,
  init: EnableBankingRequestInit = {},
): Promise<T> {
  const { applicationId, privateKeyPem } = requireEnableBankingConfig();
  const token = createApplicationJwt(applicationId, privateKeyPem);
  const headers = new Headers(init.headers);

  headers.set("Authorization", `Bearer ${token}`);

  if (init.body) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${ENABLE_BANKING_BASE_URL}${path}`, {
    ...init,
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
    headers,
  });

  const rawBody = await response.text();
  const parsedBody = rawBody ? parseJsonSafely(rawBody) : null;

  if (!response.ok) {
    const message =
      (typeof parsedBody === "object" &&
        parsedBody !== null &&
        "message" in parsedBody &&
        typeof parsedBody.message === "string" &&
        parsedBody.message) ||
      `Enable Banking request failed: ${response.status}`;

    throw new EnableBankingError(message, response.status, parsedBody ?? rawBody);
  }

  return parsedBody as T;
}

function createApplicationJwt(applicationId: string, privateKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 60 * 5;

  const header = encodeBase64Url(
    JSON.stringify({
      alg: "RS256",
      kid: applicationId,
      typ: "JWT",
    }),
  );

  const payload = encodeBase64Url(
    JSON.stringify({
      aud: ENABLE_BANKING_AUDIENCE,
      exp: expiresAt,
      iat: now,
      iss: ENABLE_BANKING_ISSUER,
    }),
  );

  const input = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(input), privateKeyPem).toString("base64url");

  return `${input}.${signature}`;
}

function readEnableBankingPrivateKey(): string | null {
  const inlinePem = process.env.ENABLE_BANKING_PRIVATE_KEY_PEM?.trim();

  if (inlinePem) {
    return normalizePem(inlinePem);
  }

  const keyPath = process.env.ENABLE_BANKING_PRIVATE_KEY_PATH?.trim();

  if (!keyPath) {
    return null;
  }

  return normalizePem(readFileSync(keyPath, "utf8"));
}

function normalizePem(value: string): string {
  const normalized = value.replace(/\\n/g, "\n").trim();
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

function requireEnableBankingConfig(): EnableBankingConfig {
  const config = getEnableBankingConfig();

  if (!config) {
    throw new EnableBankingError(
      "Enable Banking is not configured. Set ENABLE_BANKING_APPLICATION_ID and either ENABLE_BANKING_PRIVATE_KEY_PEM or ENABLE_BANKING_PRIVATE_KEY_PATH.",
    );
  }

  return config;
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function parseJsonSafely(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}
