# Give Yourself a Raise

Diagnosis-first spending analysis on top of Enable Banking, available as a private web app and a read-only ChatGPT app.

## What It Does

- links a Revolut account through Enable Banking
- keeps the raw session endpoint for verification and debugging
- builds an action brief from the linked data
- separates `behavioural spend` from `wealth flow`
- keeps `fixed costs` as context instead of fake cut opportunities
- ranks a small set of high-confidence spending levers
- exposes six OAuth-protected MCP tools for private ChatGPT conversations
- encrypts the stored Enable Banking session ID and binds it to the signed-in user

## Current Product Shape

- `web app`: one private product page that turns from conviction layer into live brief
- `analysis API`: backend-owned contract a future mobile client can consume
- `ChatGPT app`: stateless Streamable HTTP MCP at `/mcp`
- `raw session API`: live account JSON for verification
- `roadmap`: see [`docs/roadmap.md`](docs/roadmap.md)

This repo is not a budgeting dashboard. The core promise is:

- find the few discretionary categories that could realistically give the user a `10%` raise in monthly spending power

## Main Routes

- `/`
  - single product experience with landing, loading, and live analysis states
- `/api/enable-banking/connect`
  - starts bank consent
- `/api/enable-banking/callback`
  - completes consent and stores the session cookie
- `/api/enable-banking/session`
  - raw linked-account JSON
- `/api/enable-banking/analysis`
  - spending analysis payload for the diagnosis surface
- `/.well-known/oauth-protected-resource`
  - OAuth 2.1 protected-resource discovery for ChatGPT
- `/mcp`
  - authenticated MCP endpoint; all tools are read-only
- `/privacy` and `/terms`
  - public policies for private testing and eventual directory submission

## ChatGPT Tools

- `get_connection_status`
- `get_account_summary`
- `summarize_spending`
- `find_transactions`
- `get_transaction_totals`
- `compare_spending_periods`

Tool results exclude IBANs, bank account IDs, raw provider payloads, and Enable Banking session IDs.

`get_account_summary` returns an opaque `account_ref` for each account. `find_transactions`, `get_transaction_totals`, `summarize_spending`, and `compare_spending_periods` accept an optional nonempty `account_refs` array. Omit it to include all linked accounts. References belong to the authenticated user and current bank consent. Unknown references fail before account data is fetched.

For example, `find_transactions` accepts the following arguments. Replace the reference with one from `get_account_summary`.

```json
{
  "account_refs": ["acc_reference_from_get_account_summary"],
  "date_from": "2026-10-01",
  "date_to": "2026-10-31",
  "merchant": "coffee",
  "min_amount": "0.10",
  "status": "BOOK",
  "limit": 50
}
```

Search and totals share date, merchant, category, absolute `min_amount`, absolute `max_amount`, account, and status filters. Amount bounds accept numbers or exact decimal strings. Dates must be real calendar dates, ordered, and at most 366 days apart. Dates default to the last 30 days.

`find_transactions` returns at most 50 rows per page, with a default of 20. Pass `next_cursor` as `cursor` for the next page. Other filters may be omitted or repeated unchanged. Cursors freeze default dates, expire 15 minutes after the first page, and bind the query to the user and bank session. Every continuation refetches the bank data. A changed result requires restarting the search. Duplicate-looking rows remain separate and receive opaque `transaction_ref` values. Provider `transaction_id` is not treated as a stable identity.

`get_transaction_totals` accepts the same filters without `limit` or `cursor` and returns no transaction rows. Both tools calculate totals across every matching bank-returned row before pagination. Each currency has decimal-string `debit`, `credit`, and signed `net` totals. Debit and credit are magnitudes. No currencies are combined. A row's signed `amount_decimal` is authoritative; `provider_amount_decimal` preserves the bank's original decimal text. Numeric `amount` remains for compatibility and can lose precision. Direction comes from `CRDT` or `DBIT`, independently of the provider amount's sign. Malformed amounts or directions fail with a safe error.

These are exact sums of available bank-returned rows. They do not guarantee complete bank history or reconcile a card balance. The provider client follows continuation pages, including empty pages, and rejects repeated continuation keys.

Search and totals default to `BOOK`. Supported bank statuses are `BOOK`, `CNCL`, `HOLD`, `OTHR`, `PDNG`, `RJCT`, and `SCHD`. Missing or unrecognized status becomes local `UNKNOWN`, never booked. Explicit bank codes are forwarded to the provider and enforced locally. `all` and `UNKNOWN` omit the provider status filter. `all` includes available returned statuses, with `status_counts` and `totals_by_status` so pending amounts remain distinguishable from settled amounts.

Rows include `status`, `zero_amount`, and `event_kind`. Zero amount does not establish an authorization, and a credit does not establish a refund. Only self-describing refund or reversal bank codes produce those event hints. Other codes remain `unknown`; live provider code availability is unverified.

Monthly summaries and comparisons use only `BOOK` rows and expose counts of excluded statuses. Existing monthly fields remain projections and carry an estimate label. They are separate from exact period totals.

Account references, transaction references, and cursors use purpose-separated HMAC-SHA256 signatures. The server-only bank session ID is the signing key and the authenticated subject is part of the signed input. A new bank consent invalidates old references and cursors. No additional environment secret or stored transaction snapshot is needed.

## Analysis Rules

- `wealth flow`
  - savings transfers
  - internal money movement
  - investment transfers
  - FX / exchange
- `fixed cost`
  - housing
  - utilities
  - banking fees
- `behavioural spend`
  - card payments and similar discretionary outflows

Classification is intentionally conservative:

- deterministic rules own the high-confidence merchants
- ambiguous families like `Apple` and `Amazon` stay broad when intent is unclear
- uncertain spend is shown separately instead of polluting the main brief

## Run It

```bash
npm install
npm run build
npm run start -- --port 3001
```

For local development:

```bash
npm run dev
```

## Environment

Copy `.env.example` to `.env.local`. The private ChatGPT setup needs four groups of settings:

- Enable Banking application ID and private key
- Clerk application for website sign-in and an Auth0 API for MCP OAuth
- Neon Postgres `DATABASE_URL`
- a base64-encoded 32-byte `BANK_CONNECTION_ENCRYPTION_KEY`

Generate suitable local secrets with:

```bash
openssl rand -hex 32       # APP_LOGIN_SECRET
openssl rand -base64 32    # BANK_CONNECTION_ENCRYPTION_KEY
```

- keep secrets in `.env.local`
- do not commit `.env*` files
- do not commit private keys or local certs
- set `APP_BASE_URL` to the deployed app origin used for the Enable Banking callback
- use `APP_LOGIN_PASSWORD`, `APP_LOGIN_SECRET`, and `PRIVATE_PLUGIN_SUBJECT` as the temporary single-owner web gate until Clerk is configured

## Private ChatGPT Setup

The full setup and promotion checklist is in [`docs/chatgpt-app.md`](docs/chatgpt-app.md). In short:

1. Deploy this repo and set `APP_BASE_URL` to its stable HTTPS origin.
2. Configure Auth0 dynamic client registration and the `read:bank_data` scope as described in the setup guide.
3. Register `/api/enable-banking/callback` in Enable Banking.
4. Sign in to the web app and connect Revolut once.
5. In ChatGPT developer mode, create or refresh the private app using `https://give-yourself-a-raise.vercel.app/mcp`.

ChatGPT is the MCP client. This service does not call the OpenAI API and does not need an OpenAI API key.

## Free Hosting

This checkout is already linked to a Vercel project, so Vercel Hobby is the shortest private path. A Render Blueprint is also included in [`render.yaml`](render.yaml); select the free web-service plan and add the secret environment variables in Render. Neon and Clerk can be kept on their free tiers for initial private use, subject to each provider's current quotas.
