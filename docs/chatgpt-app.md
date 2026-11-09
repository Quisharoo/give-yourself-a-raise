# Private ChatGPT App Setup

This is a private-first deployment checklist. It keeps the banking tools read-only and leaves directory submission until the live authentication and deletion flows have been tested end to end.

## 1. Create the backing services

### Neon

Create a Postgres database and copy its pooled connection string into `DATABASE_URL`. The app creates the small `bank_connections` table on first use. Only the encrypted Enable Banking session ID and connection metadata are stored; transaction payloads are fetched on demand.

### Clerk and Auth0

Clerk handles the normal website login. Auth0 handles ChatGPT OAuth because its hosted issuer supports OAuth 2.1 Dynamic Client Registration and PKCE without requiring a custom domain.

Create an Auth0 API with the audience `https://YOUR_HOST`, the `read:bank_data` permission, RS256 signing, RFC 9068 access tokens, and offline access enabled. Add a default user-delegated client grant for third-party applications with only `read:bank_data`, enable Dynamic Client Registration, and promote the chosen login connection to domain level. For a private deployment, bind a post-login Action that denies every account except the verified owner email.

Some clients send the root resource URL with a trailing slash. To support both forms, configure a second Auth0 API with the identifier `https://YOUR_HOST/` and the same settings and grant. The MCP server validates tokens for either root identifier. Retain the same private-owner restriction for both.

Set these deployment variables:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `AUTH0_ISSUER_BASE_URL`
- `AUTH0_AUDIENCE=https://YOUR_HOST`
- `PRIVATE_PLUGIN_SUBJECT` set to the subject owning the existing bank connection

For a single-owner test, keep both the ChatGPT app and Auth0 login allowlist private. Before a public release, replace the single-owner subject mapping with an explicit Clerk-to-Auth0 account-linking table.

## 2. Configure Enable Banking

Set `ENABLE_BANKING_APPLICATION_ID` and `ENABLE_BANKING_PRIVATE_KEY_PEM`. Register exactly:

`https://YOUR_HOST/api/enable-banking/callback`

Set `APP_BASE_URL=https://YOUR_HOST`. Sign in to the deployed web app and connect Revolut. The callback encrypts the resulting Enable Banking session ID with `BANK_CONNECTION_ENCRYPTION_KEY` and stores it under the Clerk user ID.

## 3. Connect ChatGPT privately

The current private deployment is:

`https://give-yourself-a-raise.vercel.app/mcp`

In ChatGPT, open **Settings → Security and login** and enable Developer mode. Then open **Plugins**, select the plus button, and create a private connection using the URL above.

If the connection was created before `/mcp` was excluded from the web-login redirect, open the connection and select **Refresh** before retrying. If ChatGPT continues to use the stale response, remove only that private ChatGPT connection and recreate it with the same MCP URL.

Complete Auth0 sign-in with the allowed Google account and approve the `read:bank_data` consent. Then test these prompts:

- "Is my Revolut account connected?"
- "Summarize my spending over the last 30 days."
- "Find coffee transactions over EUR 4 this month."
- "Compare this month with last month."

Expected tool discovery order is `get_connection_status`, then the narrowest data tool needed. Every tool advertises read-only, non-destructive annotations and requires the narrow `read:bank_data` OAuth scope.

## 4. Verify before inviting anyone

- An unauthenticated `POST /mcp` returns `401` with a `WWW-Authenticate` header pointing to protected-resource metadata.
- The metadata resource, Auth0 issuer, audience, and ChatGPT MCP URL agree exactly.
- One Clerk user cannot read another user's stored connection.
- Tool results never include an IBAN, provider account ID, Enable Banking session ID, or raw provider payload.
- Disconnect revokes the Enable Banking session and deletes the encrypted database row.
- Removing the ChatGPT/Auth0 grant prevents later MCP calls.
- `/privacy` and `/terms` are public and accurate.

## 5. Promote to public

Keep the same MCP boundary. Before ChatGPT directory submission:

- move from a free sleeping service to an always-on plan with monitoring
- add a proper account/deletion page and support process
- pin database migrations instead of relying on first-use schema creation
- add rate limiting and audit events that contain no bank payloads
- complete the current ChatGPT app submission requirements and live reviewer OAuth test
- commission legal/privacy review for the countries you support

The public product should remain read-only until a separate, strongly confirmed write-action design exists.
