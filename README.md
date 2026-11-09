# Give Yourself a Raise

Diagnosis-first spending analysis on top of Enable Banking, available as a private web app and a read-only ChatGPT app.

## What It Does

- links a Revolut account through Enable Banking
- keeps the raw session endpoint for verification and debugging
- builds an action brief from the linked data
- separates `behavioural spend` from `wealth flow`
- keeps `fixed costs` as context instead of fake cut opportunities
- ranks a small set of high-confidence spending levers
- exposes five OAuth-protected MCP tools for private ChatGPT conversations
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
- `compare_spending_periods`

Tool results deliberately exclude IBANs, bank account IDs, raw provider payloads, and Enable Banking session IDs.

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
