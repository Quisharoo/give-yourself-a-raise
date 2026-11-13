import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { beforeEach } from "node:test";
import { NextRequest } from "next/server";
import type { BankConnection } from "../connections/store";
import { EnableBankingError } from "../enable-banking/client";
import type { EnableBankingAccountSnapshot } from "../enable-banking/types";
import { normalizeAccountTransactions } from "../analysis/classification";
import { bankAccountIdentity } from "../transactions-identity";
import { syntheticPersistence } from "../mcp/fixtures";

const require = createRequire(import.meta.url);
let clerkUser: string | null = "user_private_owner";
let connection: BankConnection | null;
let revokeFailure: Error | null = null;
let readFailure: Error | null = null;
let providerExpiry: unknown = undefined;
let savedConsentExpiry: string | null | undefined = undefined;
const effects: string[] = [];
const cookieValues = new Map<string, string>();
let analysisAccounts: EnableBankingAccountSnapshot[] = [];
let persistence = syntheticPersistence();
const accountDetails = { identification_hash: "synthetic-account", currency: "EUR", cash_account_type: "CARD" };

function replaceExports(specifier: string, replacements: Record<string, unknown>) {
  const original: Record<string, unknown> = require(specifier);
  const loaded = require.cache[require.resolve(specifier)];
  assert.ok(loaded);
  loaded.exports = { ...original, ...replacements };
}

replaceExports("@clerk/nextjs/server", {
  auth: async () => ({ userId: clerkUser }),
  clerkMiddleware: (handler: (auth: () => Promise<{ userId: string | null }>, request: NextRequest) => unknown) =>
    (request: NextRequest) => handler(async () => ({ userId: clerkUser }), request),
});
replaceExports("next/headers", {
  cookies: async () => ({
    get: (name: string) => cookieValues.has(name) ? { value: cookieValues.get(name) } : undefined,
    delete: (name: string) => { effects.push(`clear:${name}`); },
  }),
});
replaceExports("../connections/store", {
  getBankConnection: async (subject: string) => { effects.push(`load:${subject}`); return connection; },
  saveBankConnection: async (input: { consentExpiresAt: string | null }) => { effects.push("save"); savedConsentExpiry = input.consentExpiresAt; },
  deleteBankConnection: async (subject: string, sessionId: string) => {
    effects.push(`delete:${subject}:${sessionId}`);
    return true;
  },
});
replaceExports("../analysis/rule-store", {
  listFinancialRules: async () => [],
  getClassificationSnapshot: async (subject: string) => ({ subject, rules: [], overrides: await persistence.listTransactionOverrides(subject) }),
  observeTransactionIdentities: (subject: string, observations: Parameters<typeof persistence.observeTransactionIdentities>[1]) => persistence.observeTransactionIdentities(subject, observations),
});
replaceExports("../enable-banking/client", {
  hasEnableBankingConfig: () => true,
  getSessionOverview: async (sessionId: string) => {
    effects.push(`read:${sessionId}`);
    if (readFailure) throw readFailure;
    return { accounts: analysisAccounts, session: { session_id: "private-provider-session", accounts: [] } };
  },
  getAccountDetails: async () => accountDetails,
  getSession: async (sessionId: string) => { effects.push(`read:${sessionId}`); return { accounts: [], session_id: "private-provider-session" }; },
  startAuthorization: async () => { effects.push("authorize"); return { url: "https://bank.example/consent" }; },
  createSession: async () => { effects.push("create"); return { session_id: "created-session", access: { valid_until: providerExpiry } }; },
  deleteSession: async (sessionId: string) => {
    effects.push(`revoke:${sessionId}`);
    if (revokeFailure) throw revokeFailure;
  },
});

const sessionRoute: typeof import("../../app/api/enable-banking/session/route") = require("../../app/api/enable-banking/session/route");
const analysisRoute: typeof import("../../app/api/enable-banking/analysis/route") = require("../../app/api/enable-banking/analysis/route");
const connectRoute: typeof import("../../app/api/enable-banking/connect/route") = require("../../app/api/enable-banking/connect/route");
const callbackRoute: typeof import("../../app/api/enable-banking/callback/route") = require("../../app/api/enable-banking/callback/route");
const disconnectRoute: Record<string, (request: NextRequest) => Promise<Response>> = require("../../app/api/enable-banking/disconnect/route");
const { proxy }: typeof import("../../proxy") = require("../../proxy");

beforeEach(() => {
  process.env.APP_BASE_URL = "https://app.example";
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "test-publishable-key";
  process.env.CLERK_SECRET_KEY = "test-secret-key";
  process.env.PRIVATE_PLUGIN_SUBJECT = "user_private_owner";
  process.env.APP_LOGIN_PASSWORD = "test-password";
  process.env.APP_LOGIN_SECRET = "test-signing-secret";
  delete process.env.ENABLE_BANKING_CAPTURE_LOCAL;
  clerkUser = "user_private_owner";
  connection = { connectionId: "synthetic-generation", connectedAt: "2026-11-13", consentExpiresAt: null, country: "IE", provider: "Test", sessionId: "stored-owner-session", subject: "user_private_owner" };
  revokeFailure = null;
  readFailure = null;
  providerExpiry = undefined; savedConsentExpiry = undefined;
  effects.length = 0;
  analysisAccounts = [];
  persistence = syntheticPersistence();
  cookieValues.clear();
  cookieValues.set("enable_banking_session_id", "attacker-cookie-session");
  cookieValues.set("enable_banking_state", "state");
});

test("dashboard observations suppress a conflicting saved override and refuse later writes", async () => {
  const previousKey = process.env.BANK_CONNECTION_ENCRYPTION_KEY;
  process.env.BANK_CONNECTION_ENCRYPTION_KEY = Buffer.alloc(32, 29).toString("base64");
  try {
    const subject = "user_private_owner";
    const account: EnableBankingAccountSnapshot = {
      accountId: "rotating-account",
      stableIdentity: bankAccountIdentity("Test", "IE", accountDetails).stableIdentity,
      balances: [],
      transactions: [{
        entry_reference: "one-entry",
        status: "BOOK",
        booking_date: "2026-11-01",
        creditor: { name: "Amazon" },
        credit_debit_indicator: "DBIT",
        bank_transaction_code: { code: "CARD_PAYMENT" },
        transaction_amount: { amount: "10.00", currency: "EUR" },
      }],
    };
    const original = normalizeAccountTransactions(account, { subject, rules: [], overrides: [] })[0];
    assert(original.transactionRef && original.identityEvidence);
    await persistence.observeTransactionIdentities(subject, [{ transaction_ref: original.transactionRef, evidence: original.identityEvidence, supported: true }]);
    const labels = { transaction_ref: original.transactionRef, purpose: "business", project: "INCREMNT", flow_kind: "transfer" };
    await persistence.setTransactionOverride(subject, labels);
    analysisAccounts = [account];
    const read = () => analysisRoute.GET(request("/api/enable-banking/analysis?dateFrom=2026-11-01&dateTo=2026-11-13"));
    const before = await read();
    assert.equal(before.status, 200);
    assert.equal((await before.json()).debugCounts.wealthFlowTransactions, 1);
    account.transactions[0].transaction_amount.amount = "20.00";
    const after = await read();
    assert.equal(after.status, 200);
    const analysis = await after.json();
    assert.equal(analysis.debugCounts.wealthFlowTransactions, 0);
    assert.equal(analysis.debugCounts.behaviouralTransactions, 1);
    await assert.rejects(persistence.setTransactionOverride(subject, labels), /Override refused/);
  } finally {
    if (previousKey === undefined) delete process.env.BANK_CONNECTION_ENCRYPTION_KEY;
    else process.env.BANK_CONNECTION_ENCRYPTION_KEY = previousKey;
  }
});

function request(path: string, method = "GET", origin?: string) {
  return new NextRequest(`https://app.example${path}`, {
    method,
    headers: {
      cookie: [...cookieValues].map(([key, value]) => `${key}=${value}`).join("; "),
      ...(origin === undefined ? {} : { origin }),
    },
  });
}

for (const [name, route] of [["session", sessionRoute], ["analysis", analysisRoute]] as const) {
  test(`${name} rejects anonymous and nonowner callers without storage or provider work`, async () => {
    for (const user of [null, "user_other"]) {
      clerkUser = user;
      const response = await route.GET(request(`/api/enable-banking/${name}`));
      assert.equal(response.status, 401);
      assert.deepEqual(effects, []);
    }
  });
  test(`${name} reads the owner's stored connection despite a conflicting bank cookie`, async () => {
    const response = await route.GET(request(`/api/enable-banking/${name}`));
    assert.equal(response.status, 200);
    assert.deepEqual(effects, ["load:user_private_owner", "read:stored-owner-session"]);
  });
  test(`${name} needs no bank cookie and returns 404 without a stored connection`, async () => {
    cookieValues.delete("enable_banking_session_id");
    assert.equal((await route.GET(request(`/api/enable-banking/${name}`))).status, 200);
    effects.length = 0;
    connection = null;
    assert.equal((await route.GET(request(`/api/enable-banking/${name}`))).status, 404);
    assert.deepEqual(effects, ["load:user_private_owner"]);
  });
}

test("direct connect and callback reject a nonowner before provider work", async () => {
  clerkUser = "user_other";
  for (const [route, path] of [
    [connectRoute, "/api/enable-banking/connect?country=IE&name=Test"],
    [callbackRoute, "/api/enable-banking/callback?code=test-code&state=state"],
  ] as const) {
    assert.equal((await route.GET(request(path))).status, 401);
    assert.deepEqual(effects, []);
  }
});

test("callback persists the owner's connection and clears the legacy bank cookie", async () => {
  const response = await callbackRoute.GET(request("/api/enable-banking/callback?code=test-code&state=state"));
  assert.equal(response.status, 307);
  assert.deepEqual(effects, ["create", "save"]);
  const cookie = response.headers.get("set-cookie") ?? "";
  assert.match(cookie, /enable_banking_session_id=;/);
  assert.doesNotMatch(cookie, /created-session/);
});

test("disconnect GET and HEAD cannot mutate the bank connection", async () => {
  for (const method of ["GET", "HEAD"]) {
    const handler = disconnectRoute[method];
    if (handler) assert.equal((await handler(request("/api/enable-banking/disconnect", method))).status, 405);
    assert.deepEqual(effects, []);
  }
});

test("disconnect rejects foreign, missing, null and malformed origins before effects", async () => {
  assert.equal(typeof disconnectRoute.POST, "function");
  for (const origin of [undefined, "null", "https://evil.example", "https://app.example.evil", "https://app.example/path", "!"]) {
    const response = await disconnectRoute.POST(request("/api/enable-banking/disconnect", "POST", origin));
    assert.equal(response.status, 403);
    assert.deepEqual(effects, []);
  }
});

test("disconnect rejects missing canonical origin and nonowner without effects", async () => {
  assert.equal(typeof disconnectRoute.POST, "function");
  delete process.env.APP_BASE_URL;
  assert.equal((await disconnectRoute.POST(request("/api/enable-banking/disconnect", "POST", "https://app.example"))).status, 503);
  assert.deepEqual(effects, []);
  process.env.APP_BASE_URL = "https://app.example";
  clerkUser = "user_other";
  assert.equal((await disconnectRoute.POST(request("/api/enable-banking/disconnect", "POST", "https://app.example"))).status, 401);
  assert.deepEqual(effects, []);
});

test("same-origin owner disconnect revokes only the selected session and redirects with 303", async () => {
  assert.equal(typeof disconnectRoute.POST, "function");
  const response = await disconnectRoute.POST(request("/api/enable-banking/disconnect", "POST", "https://app.example"));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "https://app.example/");
  assert.deepEqual(effects, ["load:user_private_owner", "revoke:stored-owner-session", "delete:user_private_owner:stored-owner-session"]);
  assert.match(response.headers.get("set-cookie") ?? "", /enable_banking_session_id=;/);
});

test("provider revocation failure preserves the stored connection and hides provider detail", async () => {
  assert.equal(typeof disconnectRoute.POST, "function");
  revokeFailure = new Error("provider detail must not escape");
  const response = await disconnectRoute.POST(request("/api/enable-banking/disconnect", "POST", "https://app.example"));
  assert.equal(response.status, 502);
  assert.deepEqual(effects, ["load:user_private_owner", "revoke:stored-owner-session"]);
  assert.doesNotMatch(await response.text(), /provider detail/);
});

test("disconnect of an absent connection is repeatable", async () => {
  assert.equal(typeof disconnectRoute.POST, "function");
  connection = null;
  for (let index = 0; index < 2; index++) {
    assert.equal((await disconnectRoute.POST(request("/api/enable-banking/disconnect", "POST", "https://app.example"))).status, 303);
  }
  assert.deepEqual(effects, ["load:user_private_owner", "load:user_private_owner"]);
});

test("web authentication fails closed for absent and partial Clerk configuration", async () => {
  const { createAuthSessionToken } = require("./session") as typeof import("./session");
  cookieValues.set("gyr-auth", createAuthSessionToken());
  delete process.env.CLERK_SECRET_KEY;
  assert.equal((await sessionRoute.GET(request("/api/enable-banking/session"))).status, 401);
  assert.deepEqual(effects, []);
  assert.equal((await proxy(request("/"), undefined as never))?.status, 503);
  delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  delete process.env.APP_LOGIN_PASSWORD;
  delete process.env.APP_LOGIN_SECRET;
  assert.equal((await proxy(request("/"), undefined as never))?.status, 503);
  for (const path of ["/login", "/mcp", "/.well-known/oauth-protected-resource"]) {
    assert.equal((await proxy(request(path), undefined as never))?.status, 200);
  }
});

test("Clerk nonowner is forbidden by the web proxy", async () => {
  clerkUser = "user_other";
  assert.equal((await proxy(request("/"), undefined as never))?.status, 403);
  assert.deepEqual(effects, []);
});


test("disconnect can retry local deletion after the provider session is already absent", async () => {
  revokeFailure = new EnableBankingError("Session not found", 404);
  const response = await disconnectRoute.POST(request("/api/enable-banking/disconnect", "POST", "https://app.example"));
  assert.equal(response.status, 303);
  assert.deepEqual(effects, ["load:user_private_owner", "revoke:stored-owner-session", "delete:user_private_owner:stored-owner-session"]);
});

test("bank read errors omit upstream response details", async () => {
  readFailure = new EnableBankingError("provider private message", 502, { private: "provider private response" });
  for (const route of [sessionRoute, analysisRoute]) {
    const response = await route.GET(request("/api/enable-banking/session"));
    assert.equal(response.status, 502);
    assert.doesNotMatch(await response.text(), /provider private/);
  }
});

test("missing owner configuration denies direct web routes and proxy without effects", async () => {
  for (const value of [undefined, "   "]) {
    if (value === undefined) delete process.env.PRIVATE_PLUGIN_SUBJECT;
    else process.env.PRIVATE_PLUGIN_SUBJECT = value;
    assert.equal((await sessionRoute.GET(request("/api/enable-banking/session"))).status, 401);
    assert.equal((await proxy(request("/"), undefined as never))?.status, 503);
    assert.deepEqual(effects, []);
  }
});

test("a valid fallback session reads the owner's stored connection with Clerk wholly absent", async () => {
  delete process.env.CLERK_SECRET_KEY;
  delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const { createAuthSessionToken } = require("./session") as typeof import("./session");
  cookieValues.set("gyr-auth", createAuthSessionToken());
  assert.equal((await sessionRoute.GET(request("/api/enable-banking/session"))).status, 200);
  assert.deepEqual(effects, ["load:user_private_owner", "read:stored-owner-session"]);
});


test("web bank data is not cacheable and session credentials stay server-side", async () => {
  for (const [route, path] of [
    [sessionRoute, "/api/enable-banking/session"],
    [sessionRoute, "/api/enable-banking/session?summary=1"],
    [analysisRoute, "/api/enable-banking/analysis"],
  ] as const) {
    const response = await route.GET(request(path));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.doesNotMatch(await response.text(), /private-provider-session|session_id/);
  }
});

test("callback persists actual provider expiry and keeps missing or malformed expiry unknown", async () => {
  for (const [provider, expected] of [["2026-12-02T10:00:00Z", "2026-12-02T10:00:00.000Z"], [undefined, null], ["bad", null]] as const) {
    providerExpiry = provider;
    const response = await callbackRoute.GET(request("/api/enable-banking/callback?code=test-code&state=state"));
    assert.equal(response.status, 307); assert.equal(savedConsentExpiry, expected);
  }
});
