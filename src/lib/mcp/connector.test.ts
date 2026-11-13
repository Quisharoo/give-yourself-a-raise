import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";

import { InitializeResultSchema, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { z } from "zod";

import { POST } from "../../app/mcp/route.ts";
import { authenticateMcpRequest } from "./auth.ts";

const appBaseUrl = "https://connector.example.test";
const ownerSubject = "auth0|connector-owner";
const bankSubject = "user_connector_owner";
const protocolVersion = "2025-11-25";
const rpcResponseSchema = z.object({
  id: z.number(),
  jsonrpc: z.literal("2.0"),
  result: z.unknown(),
});

test("hosted MCP authorizes only the owner while preserving bearer-only connectors", { timeout: 20_000 }, async (t) => {
  const environmentKeys = [
    "APP_BASE_URL",
    "AUTH0_AUDIENCE",
    "AUTH0_ISSUER_BASE_URL",
    "AUTH0_OWNER_SUBJECT",
    "PRIVATE_PLUGIN_SUBJECT",
    "VERCEL_ENV",
    "DATABASE_URL",
    "ENABLE_BANKING_APPLICATION_ID",
    "ENABLE_BANKING_PRIVATE_KEY_PEM",
    "ENABLE_BANKING_PRIVATE_KEY_PATH",
  ];
  const previousEnvironment = new Map(environmentKeys.map((name) => [name, process.env[name]]));
  t.after(() => {
    for (const [name, value] of previousEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const keyPair = await generateKeyPair("RS256");
  const untrustedKeyPair = await generateKeyPair("RS256");
  const publicKey = await exportJWK(keyPair.publicKey);
  const jwksPaths: string[] = [];
  const jwksServer = createServer((request, response) => {
    jwksPaths.push(request.url ?? "");
    if (request.method !== "GET" || request.url !== "/.well-known/jwks.json") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ keys: [{ ...publicKey, alg: "RS256", kid: "connector-fixture", use: "sig" }] }));
  });
  jwksServer.listen(0, "127.0.0.1");
  await once(jwksServer, "listening");
  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      jwksServer.close((error) => error ? reject(error) : resolve());
      jwksServer.closeAllConnections();
    });
  });
  const address = jwksServer.address();
  assert.ok(address && typeof address !== "string");
  const issuer = `http://127.0.0.1:${address.port}/`;

  process.env.APP_BASE_URL = appBaseUrl;
  process.env.AUTH0_AUDIENCE = appBaseUrl;
  process.env.AUTH0_ISSUER_BASE_URL = issuer;
  process.env.AUTH0_OWNER_SUBJECT = ownerSubject;
  process.env.PRIVATE_PLUGIN_SUBJECT = bankSubject;
  delete process.env.VERCEL_ENV;
  delete process.env.DATABASE_URL;
  delete process.env.ENABLE_BANKING_APPLICATION_ID;
  delete process.env.ENABLE_BANKING_PRIVATE_KEY_PEM;
  delete process.env.ENABLE_BANKING_PRIVATE_KEY_PATH;

  async function signToken(claims: JWTPayload, privateKey = keyPair.privateKey) {
    return new SignJWT({
      aud: appBaseUrl,
      exp: Math.floor(Date.now() / 1000) + 300,
      iss: issuer,
      scope: "read:bank_data",
      sub: ownerSubject,
      ...claims,
    }).setProtectedHeader({ alg: "RS256", kid: "connector-fixture" }).sign(privateKey);
  }

  function connectorRequest(token: string | undefined, method: string, params?: object) {
    const headers = new Headers({
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": protocolVersion,
    });
    if (token !== undefined) headers.set("Authorization", `Bearer ${token}`);
    return new Request(`${appBaseUrl}/mcp`, {
      body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
      headers,
      method: "POST",
    });
  }

  async function assertUnauthorized(token: string | undefined) {
    const response = await POST(connectorRequest(token, "tools/call", {
      arguments: {},
      name: "get_connection_status",
    }));
    assert.equal(response.status, 401);
    assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/);
    assert.equal(
      response.headers.get("www-authenticate"),
      `Bearer resource_metadata="${appBaseUrl}/.well-known/oauth-protected-resource", scope="read:bank_data"`,
    );
    const body = z.object({
      error: z.literal("unauthorized"),
      error_description: z.string().min(1),
    }).parse(await response.json());
    assert.equal(body.error, "unauthorized");
  }

  const connectors = [
    { claims: { client_id: "grok-fixture-client" }, name: "Grok client_id", clientId: "grok-fixture-client" },
    { claims: { azp: "chatgpt-fixture-client" }, name: "ChatGPT azp", clientId: "chatgpt-fixture-client" },
  ];
  for (const connector of connectors) {
    await t.test(`${connector.name} initializes and lists read-only tools without browser state`, async () => {
      const token = await signToken(connector.claims);
      const request = connectorRequest(token, "initialize", {
        capabilities: {},
        clientInfo: { name: connector.clientId, version: "1.0.0" },
        protocolVersion,
      });
      assert.equal(request.headers.has("cookie"), false);
      assert.equal(request.headers.has("origin"), false);
      assert.deepEqual(await authenticateMcpRequest(request), {
        clientId: connector.clientId,
        scopes: ["read:bank_data"],
        subject: bankSubject,
      });

      const initialized = await POST(request);
      assert.equal(initialized.status, 200);
      const initializeRpc = rpcResponseSchema.parse(await initialized.json());
      assert.equal(initializeRpc.id, 1);
      const initializeResult = InitializeResultSchema.parse(initializeRpc.result);
      assert.equal(initializeResult.protocolVersion, protocolVersion);
      assert.ok(initializeResult.capabilities.tools);

      const listed = await POST(connectorRequest(token, "tools/list"));
      assert.equal(listed.status, 200);
      const listRpc = rpcResponseSchema.parse(await listed.json());
      const { tools } = ListToolsResultSchema.parse(listRpc.result);
      assert.deepEqual(tools.map((tool) => tool.name).sort(), [
        "compare_spending_periods",
        "find_transactions",
        "get_account_summary",
        "get_connection_status",
        "get_transaction_totals",
        "summarize_spending",
      ]);
      for (const tool of tools) {
        assert.equal(tool.annotations?.readOnlyHint, true);
        assert.equal(tool.annotations?.destructiveHint, false);
      }
    });
  }

  await t.test("a correctly signed token for another user cannot reach a bank tool", async () => {
    await assertUnauthorized(await signToken({ client_id: "grok-fixture-client", sub: "auth0|another-user" }));
  });

  await t.test("missing owner configuration fails closed", async () => {
    delete process.env.AUTH0_OWNER_SUBJECT;
    try {
      await assertUnauthorized(await signToken({ azp: "chatgpt-fixture-client" }));
    } finally {
      process.env.AUTH0_OWNER_SUBJECT = ownerSubject;
    }
  });

  const rejectedTokens = [
    { claims: {}, name: "invalid signature", privateKey: untrustedKeyPair.privateKey },
    { claims: { iss: "https://untrusted-issuer.example.test/" }, name: "wrong issuer", privateKey: keyPair.privateKey },
    { claims: { aud: "https://other-resource.example.test" }, name: "wrong audience", privateKey: keyPair.privateKey },
    { claims: { scope: "openid profile" }, name: "missing bank-data scope", privateKey: keyPair.privateKey },
    { claims: { exp: Math.floor(Date.now() / 1000) - 60 }, name: "expired access token", privateKey: keyPair.privateKey },
  ];
  for (const invalid of rejectedTokens) {
    await t.test(`rejects ${invalid.name} with an OAuth challenge`, async () => {
      await assertUnauthorized(await signToken({ client_id: "grok-fixture-client", ...invalid.claims }, invalid.privateKey));
    });
  }

  await t.test("missing bearer token receives the connector OAuth challenge", async () => {
    await assertUnauthorized(undefined);
  });
  assert.ok(jwksPaths.length > 0, "signed tokens must be verified against the HTTP JWKS fixture");
  assert.ok(jwksPaths.every((path) => path === "/.well-known/jwks.json"));
});
