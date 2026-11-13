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
- `AUTH0_OWNER_SUBJECT` set to the exact Auth0 user ID of the intended owner
- `PRIVATE_PLUGIN_SUBJECT` set to the Clerk user ID owning the existing bank connection

Obtain the Auth0 subject from the authoritative user record. Do not substitute an email, OAuth client ID, or Clerk ID. Set both subjects before deploying the owner check. Missing values deny MCP requests. The API verifies the Auth0 owner before mapping to the Clerk-owned record, independently of the post-login Action.

Keep the connector and Auth0 login allowlist private. Hosted Grokbot and other compatible clients use the same bearer-only endpoint, with no browser cookie or Origin requirement. The app does not restrict access by client brand. A public multi-user release needs a separate account-linking design.

## 2. Configure Enable Banking

Set `ENABLE_BANKING_APPLICATION_ID` and `ENABLE_BANKING_PRIVATE_KEY_PEM`. Register exactly:

`https://YOUR_HOST/api/enable-banking/callback`

Set `APP_BASE_URL=https://YOUR_HOST`. Sign in to the deployed web app and connect Revolut. The callback encrypts the resulting Enable Banking session ID with `BANK_CONNECTION_ENCRYPTION_KEY` and stores it under the Clerk user ID.

Only the configured Clerk owner can start or complete consent and read the stored connection. The browser receives a consent-state cookie, not a raw banking session credential. A partial Clerk configuration disables web access. With both Clerk keys absent, the configured fallback password gate issues owner-bound tokens that expire after twelve hours.

Use separate database, encryption, and banking credentials for preview deployments, or leave those settings unavailable there. Production credentials must not be assigned to the preview environment.

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

Expected tool discovery order is `get_connection_status`, then the narrowest data tool needed. Bank tools advertise read-only, non-destructive annotations and require `read:bank_data`. Classification writes advertise write annotations and require both `read:bank_data` and `write:classifications`.

## 4. Verify before inviting anyone

- An unauthenticated `POST /mcp` returns `401` with a `WWW-Authenticate` header pointing to protected-resource metadata.
- The metadata resource, Auth0 issuer, audience, and ChatGPT MCP URL agree exactly.
- A different Auth0 user cannot reach the owner's tools, even with a correctly signed token and `read:bank_data`.
- A different Clerk user cannot start consent, replace the connection, or read the owner's data.
- Tool results never include an IBAN, provider account ID, Enable Banking session ID, or raw provider payload.
- Disconnect requires a same-origin POST, revokes the selected Enable Banking session, and conditionally deletes its row. Failed revocation retains the row for retry. A concurrent replacement survives.
- Removing the connector's Auth0 grant prevents renewal. Already-issued access tokens can remain valid until their expiry. Disconnecting the bank removes the connection available to those tokens.
- `/privacy` and `/terms` are public and accurate.

Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run smoke:mcp`, and `npm run build`. The connector tests use synthetic signed JWTs and a local JWKS server to exercise the actual HTTP handler without calling banking tools. A deployed hosted-connector acceptance check is separate from these local checks.

## 5. Promote to public

Keep the same MCP boundary. Before ChatGPT directory submission:

- move from a free sleeping service to an always-on plan with monitoring
- add a proper account/deletion page and support process
- pin database migrations instead of relying on first-use schema creation
- add rate limiting and audit events that contain no bank payloads
- complete the current ChatGPT app submission requirements and live reviewer OAuth test
- commission legal/privacy review for the countries you support

Bank access remains read-only. Classification label writes require separate OAuth authorization and explicit user direction.

## Authorize classification labels

Add `write:classifications` as a separate Auth0 API permission. Keep the default third-party grant restricted to `read:bank_data`. Grant the write permission only to a client that the owner authorizes to save classification labels, then obtain a new token with both scopes. Existing read tokens retain read-only access.

Protected-resource metadata and write-tool metadata advertise the separate permission. The server rejects a write before storage when either scope is absent. Listing rules, upserting rules, deleting rules, and supported one-off overrides do not need active bank consent. These tools change labels and cannot move money. See [the classification and identity contract](mcp-financial-contract.md) for matching fields and override limits.
