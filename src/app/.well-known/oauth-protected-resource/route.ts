import { getAuth0Issuer, getMcpResourceUrl, MCP_ACCESS_SCOPE, MCP_CLASSIFICATION_SCOPE } from "@/lib/mcp/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  console.log(JSON.stringify({
    event: "oauth.protected_resource_metadata",
    method: request.method,
    route: "/.well-known/oauth-protected-resource",
  }));

  try {
    const resourceUrl = getMcpResourceUrl(request);
    const baseUrl = new URL(resourceUrl).origin;
    const metadata = {
      authorization_servers: [getAuth0Issuer()],
      bearer_methods_supported: ["header"],
      resource: resourceUrl,
      resource_documentation: new URL("/privacy", baseUrl).toString(),
      scopes_supported: [MCP_ACCESS_SCOPE, MCP_CLASSIFICATION_SCOPE],
    };

    return Response.json(metadata, { headers: corsHeaders });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "OAuth metadata is not configured." },
      { status: 503 },
    );
  }
}

export function OPTIONS() {
  return new Response(null, { headers: corsHeaders, status: 204 });
}

const corsHeaders = {
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};
