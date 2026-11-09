import assert from "node:assert/strict";

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { createMcpServer } from "../src/lib/mcp/tools.ts";

const endpoint = "http://localhost:3000/mcp";

interface SmokeResponse {
  result?: {
    serverInfo?: { name?: string };
    tools?: Array<{
      annotations?: { readOnlyHint?: boolean };
      securitySchemes: Array<{ scopes: string[] }>;
    }>;
  };
}

async function main() {
  const initialize = await invoke({
    id: 1,
    jsonrpc: "2.0",
    method: "initialize",
    params: {
      capabilities: {},
      clientInfo: { name: "local-smoke", version: "1.0.0" },
      protocolVersion: "2025-03-26",
    },
  });

  assert.equal(initialize.result?.serverInfo?.name, "give-yourself-a-raise");

  const listed = await invoke({ id: 2, jsonrpc: "2.0", method: "tools/list", params: {} });
  const tools = listed.result?.tools;
  assert.ok(tools);
  assert.equal(tools.length, 5);
  assert.equal(tools[0].annotations?.readOnlyHint, true);
  assert.equal(tools[0].securitySchemes[0].scopes[0], "read:bank_data");

  console.log(`MCP smoke passed: initialize + ${tools.length} read-only tools`);
}

async function invoke(body: Record<string, unknown>) {
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
    sessionIdGenerator: undefined,
  });
  const server = createMcpServer("smoke-user", "http://localhost:3000");
  await server.connect(transport);
  const response = await transport.handleRequest(
    new Request(endpoint, {
      body: JSON.stringify(body),
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );

  assert.equal(response.status, 200);
  return response.json() as Promise<SmokeResponse>;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
