# Single-User Auth Gate Design

**Date:** 2026-04-23

## Goal

Protect the deployed app so only the account owner can trigger the Enable Banking flow, while keeping the bank consent callback reliable on a real iPhone.

## Constraints

- The app is currently single-user.
- The immediate validation target is `consent -> callback -> session`, not multi-user product auth.
- The project is on Next.js 16, so request gating should use `proxy.ts`.
- The Enable Banking callback must not get trapped behind the login gate.

## Chosen Approach

Add a small password-based app session:

- `GET /login` renders a plain login screen
- `POST /api/auth/login` validates a password from env vars and sets an HTTP-only cookie
- `GET /api/auth/logout` clears the auth cookie
- `src/proxy.ts` redirects unauthenticated requests to `/login`
- `src/proxy.ts` explicitly allows `/login`, `/api/auth/login`, `/api/auth/logout`, and `/api/enable-banking/callback`

## Why This Approach

- It is enough to keep the deployment private for one person.
- It avoids depending on Vercel plan-specific protection for production routing.
- It keeps the callback path under app control, which removes one external redirect variable from the bank flow.
- It does not commit the project to iOS-only or to a full user auth system.

## Security Model

- The password is stored in server env as `APP_LOGIN_PASSWORD`.
- The session cookie value is a signed token derived from a second env var, `APP_LOGIN_SECRET`.
- The auth cookie is `HttpOnly`, `Secure` outside development, `SameSite=Lax`, and path-scoped to `/`.
- The gate protects all app pages and API routes except the allowlist above and Next static assets.

## Callback Behavior

- The user must authenticate once in Safari before starting the bank flow.
- The bank callback route remains reachable even if the auth cookie is absent.
- The Enable Banking session remains separate from the auth cookie, so the browser can complete consent and then land back in the app.

## Non-Goals

- No user accounts
- No database sessions
- No OAuth provider login
- No role model
- No Android or native iOS app changes in this pass

## Verification

- Unit tests for cookie signing and route-allowlist logic
- Local lint, typecheck, and build
- Deploy with `APP_LOGIN_PASSWORD`, `APP_LOGIN_SECRET`, `APP_BASE_URL`, and Enable Banking env vars
- Manual iPhone Safari test of `login -> connect -> bank app/SCA -> callback -> analysis`
