import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export const MCP_ACCESS_SCOPE = "read:bank_data";

export interface AuthenticatedMcpUser {
  clientId: string;
  scopes: string[];
  subject: string;
}

export async function authenticateMcpRequest(request: Request): Promise<AuthenticatedMcpUser> {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    throw new McpAuthenticationError("Missing bearer access token.");
  }

  try {
    const token = authorization.slice("Bearer ".length);
    const issuer = getAuth0Issuer();
    const audience = getAuth0Audiences();
    const jwks = createRemoteJWKSet(new URL(".well-known/jwks.json", issuer));
    const { payload } = await jwtVerify(token, jwks, {
      algorithms: ["RS256"],
      audience,
      issuer,
    });

    return requireBankDataAccess(payload);
  } catch (error) {
    if (error instanceof McpAuthenticationError) {
      throw error;
    }

    throw new McpAuthenticationError("Access token is invalid or expired.");
  }
}

export function requireBankDataAccess(payload: JWTPayload | undefined): AuthenticatedMcpUser {
  const tokenSubject = payload?.sub;
  const clientId = typeof payload?.client_id === "string"
    ? payload.client_id
    : typeof payload?.azp === "string"
      ? payload.azp
      : undefined;
  const scopes = typeof payload?.scope === "string"
    ? payload.scope.split(" ").filter(Boolean)
    : [];

  if (!payload || !tokenSubject || !clientId) {
    throw new McpAuthenticationError("Access token is invalid or expired.");
  }

  if (!scopes.includes(MCP_ACCESS_SCOPE)) {
    throw new McpAuthenticationError(`Access token is missing ${MCP_ACCESS_SCOPE}.`);
  }

  const subject = process.env.PRIVATE_PLUGIN_SUBJECT?.trim() || tokenSubject;
  return { clientId, scopes, subject };
}

export function getAuth0Issuer() {
  const configured = process.env.AUTH0_ISSUER_BASE_URL?.trim();

  if (!configured) {
    throw new Error("AUTH0_ISSUER_BASE_URL is required for MCP authentication.");
  }

  return `${configured.replace(/\/+$/, "")}/`;
}

export function getAuth0Audience() {
  const audience = process.env.AUTH0_AUDIENCE?.trim() || process.env.APP_BASE_URL?.trim();

  if (!audience) {
    throw new Error("AUTH0_AUDIENCE or APP_BASE_URL is required for MCP authentication.");
  }

  return audience;
}

export function getAuth0Audiences() {
  const audience = getAuth0Audience();
  const url = new URL(audience);
  if (url.pathname === "/" && !url.search && !url.hash) {
    return [url.origin, `${url.origin}/`];
  }
  return [audience];
}

export function getMcpResourceUrl(request: Request) {
  const baseUrl = getMcpBaseUrl(request);
  return new URL(baseUrl).origin;
}

export function getProtectedResourceMetadataUrl(request: Request) {
  const baseUrl = getMcpBaseUrl(request);
  return new URL("/.well-known/oauth-protected-resource", baseUrl).toString();
}

function getMcpBaseUrl(request: Request) {
  if (process.env.VERCEL_ENV === "preview") {
    return new URL(request.url).origin;
  }

  return process.env.APP_BASE_URL?.trim() || new URL(request.url).origin;
}

export class McpAuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpAuthenticationError";
  }
}
