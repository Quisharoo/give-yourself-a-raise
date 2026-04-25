# Give Yourself a Raise

Diagnosis-first spending analysis on top of Enable Banking.

## What It Does

- links a Revolut account through Enable Banking
- keeps the raw session endpoint for verification and debugging
- builds an action brief from the linked data
- separates `behavioural spend` from `wealth flow`
- keeps `fixed costs` as context instead of fake cut opportunities
- ranks a small set of high-confidence spending levers

## Current Product Shape

- `web app`: one private product page that turns from conviction layer into live brief
- `analysis API`: backend-owned contract a future mobile client can consume
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

The app expects Enable Banking configuration in local environment variables.

- keep secrets in `.env.local`
- do not commit `.env*` files
- do not commit private keys or local certs
- set `APP_BASE_URL` to the deployed app origin used for the Enable Banking callback
- set `APP_LOGIN_PASSWORD` to a strong private password for the deployment gate
- set `APP_LOGIN_SECRET` to a long random secret used to sign the auth cookie

## Private Deploy Flow

For a single-user Vercel deployment:

- configure the normal Enable Banking env vars
- configure `APP_BASE_URL` to the live Vercel URL or custom domain
- configure `APP_LOGIN_PASSWORD` and `APP_LOGIN_SECRET`
- keep `/api/enable-banking/callback` registered as the Enable Banking callback URL

The app-level gate protects the rest of the deployment, while the callback route stays reachable so
the real-device consent flow can complete.
