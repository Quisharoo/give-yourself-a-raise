import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import {
  authenticateMcpRequest,
  getAuth0Audiences,
  getMcpResourceUrl,
  MCP_ACCESS_SCOPE,
  McpAuthenticationError,
  requireBankDataAccess,
} from "./auth.ts";

beforeEach(() => {
  process.env.AUTH0_OWNER_SUBJECT = "auth0|owner";
  process.env.PRIVATE_PLUGIN_SUBJECT = "user_private_owner";
});

test("accepts both exact root resource identifiers while preserving non-root audiences", () => {
  const previous = process.env.AUTH0_AUDIENCE;
  try {
    process.env.AUTH0_AUDIENCE = "https://example.test";
    assert.deepEqual(getAuth0Audiences(), ["https://example.test", "https://example.test/"]);
    process.env.AUTH0_AUDIENCE = "https://example.test/";
    assert.deepEqual(getAuth0Audiences(), ["https://example.test", "https://example.test/"]);
    process.env.AUTH0_AUDIENCE = "https://example.test/mcp";
    assert.deepEqual(getAuth0Audiences(), ["https://example.test/mcp"]);
  } finally {
    if (previous === undefined) delete process.env.AUTH0_AUDIENCE;
    else process.env.AUTH0_AUDIENCE = previous;
  }
});

test("uses the canonical app origin as the OAuth protected resource", () => {
  const previousAppBaseUrl = process.env.APP_BASE_URL;
  const previousVercelEnv = process.env.VERCEL_ENV;
  delete process.env.APP_BASE_URL;
  process.env.VERCEL_ENV = "preview";

  try {
    assert.equal(
      getMcpResourceUrl(new Request("https://preview.example.test/mcp")),
      "https://preview.example.test",
    );
  } finally {
    if (previousAppBaseUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = previousAppBaseUrl;
    if (previousVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previousVercelEnv;
  }
});

test("accepts an Auth0 access token with the bank-data scope", () => {
  const previousPrivateSubject = process.env.PRIVATE_PLUGIN_SUBJECT;
  process.env.PRIVATE_PLUGIN_SUBJECT = "user_private_owner";
  const authenticated = requireBankDataAccess({
    client_id: "chatgpt-client",
    scope: MCP_ACCESS_SCOPE,
    sub: "auth0|owner",
  });

  assert.deepEqual(authenticated, {
    clientId: "chatgpt-client",
    scopes: [MCP_ACCESS_SCOPE],
    subject: "user_private_owner",
  });

  if (previousPrivateSubject === undefined) delete process.env.PRIVATE_PLUGIN_SUBJECT;
  else process.env.PRIVATE_PLUGIN_SUBJECT = previousPrivateSubject;
});

test("requires both owner identities, including nonblank configuration", () => {
  for (const key of ["AUTH0_OWNER_SUBJECT", "PRIVATE_PLUGIN_SUBJECT"]) {
    const previous = process.env[key];
    for (const value of [undefined, "   "]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
      assert.throws(() => requireBankDataAccess({
        azp: "chatgpt-client", scope: MCP_ACCESS_SCOPE, sub: "auth0|owner",
      }), McpAuthenticationError);
    }
    process.env[key] = previous;
  }
});

test("rejects another Auth0 user and the mapped Clerk subject before owner mapping", () => {
  for (const sub of ["auth0|other-user", "user_private_owner"]) {
    assert.throws(() => requireBankDataAccess({
      client_id: "grok-client", scope: MCP_ACCESS_SCOPE, sub,
    }), McpAuthenticationError);
  }
});

test("accepts the owner from hosted Grok and ChatGPT client claims", () => {
  for (const client of [{ client_id: "grok-client" }, { azp: "chatgpt-client" }]) {
    assert.equal(requireBankDataAccess({
      ...client, scope: MCP_ACCESS_SCOPE, sub: "auth0|owner",
    }).subject, "user_private_owner");
  }
});

test("rejects an Auth0 access token without the required bank-data scope", () => {
  assert.throws(
    () => requireBankDataAccess({
      client_id: "chatgpt-client",
      scope: "openid profile",
      sub: "auth0|owner",
    }),
    McpAuthenticationError,
  );
});

test("rejects an MCP request without a bearer token", async () => {
  await assert.rejects(
    authenticateMcpRequest(new Request("https://example.test/mcp")),
    McpAuthenticationError,
  );
});
