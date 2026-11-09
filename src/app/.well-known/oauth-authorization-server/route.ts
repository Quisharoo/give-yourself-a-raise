import { getAuth0Issuer } from "@/lib/mcp/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  console.log(JSON.stringify({
    event: "oauth.authorization_server_metadata",
    method: request.method,
    route: "/.well-known/oauth-authorization-server",
  }));
  try {
    const metadataUrl = new URL(".well-known/oauth-authorization-server", getAuth0Issuer());
    const response = await fetch(metadataUrl, { cache: "no-store" });
    const body = await response.text();
    return new Response(body, {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: response.status,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "OAuth metadata is not configured." },
      { headers: corsHeaders, status: 503 },
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
