import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import {
  authenticateMcpRequest,
  getProtectedResourceMetadataUrl,
  MCP_ACCESS_SCOPE,
  McpAuthenticationError,
} from "@/lib/mcp/auth";
import { createMcpServer } from "@/lib/mcp/tools";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handleMcp(request: Request) {
  logMcpEvent("request", request, {
    has_bearer_token: request.headers.get("authorization")?.startsWith("Bearer ") ?? false,
  });

  try {
    const user = await authenticateMcpRequest(request);
    logMcpEvent("authenticated", request, { scope_count: user.scopes.length });
    const appBaseUrl = process.env.APP_BASE_URL?.trim() || new URL(request.url).origin;
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
      sessionIdGenerator: undefined,
    });
    const server = createMcpServer(user.subject, appBaseUrl);
    await server.connect(transport);
    return transport.handleRequest(request);
  } catch (error) {
    if (error instanceof McpAuthenticationError) {
      logMcpEvent("authentication_required", request, { reason: error.message });
      const metadataUrl = getProtectedResourceMetadataUrl(request);
      return Response.json(
        { error: "unauthorized", error_description: error.message },
        {
          headers: {
            "WWW-Authenticate": `Bearer resource_metadata=\"${metadataUrl}\", scope=\"${MCP_ACCESS_SCOPE}\"`,
          },
          status: 401,
        },
      );
    }

    console.error(JSON.stringify({
      event: "mcp.failed",
      error: error instanceof Error ? error.message : "Unknown MCP error",
      method: request.method,
      route: "/mcp",
    }));
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}

function logMcpEvent(
  stage: string,
  request: Request,
  details: Record<string, boolean | number | string>,
) {
  console.log(JSON.stringify({
    event: `mcp.${stage}`,
    method: request.method,
    route: "/mcp",
    ...details,
  }));
}

export const GET = handleMcp;
export const POST = handleMcp;
export const DELETE = handleMcp;

export function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Origin": "*",
    },
    status: 204,
  });
}
