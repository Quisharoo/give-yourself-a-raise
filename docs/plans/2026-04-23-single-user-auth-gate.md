# Single-User Auth Gate Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a single-user password gate that protects the deployed app without blocking the Enable Banking callback.

**Architecture:** The app gets a minimal server-owned auth cookie and a root-level `proxy.ts` gate. Login and logout live in route handlers, reusable auth helpers live in `src/lib/auth`, and the Enable Banking callback path stays explicitly exempt from the gate.

**Tech Stack:** Next.js 16 App Router, root `proxy.ts`, route handlers, Node `crypto`, React 19, TypeScript, Node test runner

---

### Task 1: Auth Helpers

**Files:**
- Create: `src/lib/auth/session.ts`
- Create: `src/lib/auth/session.test.ts`

**Step 1: Write the failing test**

- Add tests for:
  - signing and verifying a valid auth token
  - rejecting a tampered token
  - rejecting when env vars are missing

**Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types src/lib/auth/session.test.ts`

Expected: FAIL because the helper does not exist yet.

**Step 3: Write minimal implementation**

- Add helpers for:
  - reading required auth env vars
  - creating a signed cookie token
  - validating a signed cookie token
  - cookie option constants

**Step 4: Run test to verify it passes**

Run: `node --test --experimental-strip-types src/lib/auth/session.test.ts`

Expected: PASS

### Task 2: Route Gate Logic

**Files:**
- Create: `src/lib/auth/paths.ts`
- Create: `src/lib/auth/paths.test.ts`
- Create: `src/proxy.ts`

**Step 1: Write the failing test**

- Add tests for:
  - allowing `/login`
  - allowing `/api/auth/login`
  - allowing `/api/auth/logout`
  - allowing `/api/enable-banking/callback`
  - protecting `/`, `/debug`, and `/api/enable-banking/connect`

**Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types src/lib/auth/paths.test.ts`

Expected: FAIL because the helper does not exist yet.

**Step 3: Write minimal implementation**

- Add path helper functions for protected and public routes.
- Add `src/proxy.ts` that:
  - skips static assets
  - checks the auth cookie
  - redirects unauthenticated protected requests to `/login?next=...`

**Step 4: Run test to verify it passes**

Run: `node --test --experimental-strip-types src/lib/auth/paths.test.ts`

Expected: PASS

### Task 3: Login and Logout Routes

**Files:**
- Create: `src/app/login/page.tsx`
- Create: `src/app/api/auth/login/route.ts`
- Create: `src/app/api/auth/logout/route.ts`

**Step 1: Write the failing test**

- Reuse the helper tests and add route-level behavior only where it is cheap to isolate.
- Prefer testing pure auth helpers instead of framework internals.

**Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types src/lib/auth/session.test.ts src/lib/auth/paths.test.ts`

Expected: FAIL until routes depend on implemented helpers and expected responses exist.

**Step 3: Write minimal implementation**

- Add a plain password form at `/login`
- Validate the submitted password in `POST /api/auth/login`
- Set the auth cookie and redirect to the requested path or `/`
- Clear the auth cookie in logout and redirect to `/login`

**Step 4: Run test to verify it passes**

Run: `node --test --experimental-strip-types src/lib/auth/session.test.ts src/lib/auth/paths.test.ts`

Expected: PASS

### Task 4: App Integration

**Files:**
- Modify: `src/app/debug/page.tsx`
- Modify: `README.md`

**Step 1: Write the failing test**

- No extra isolated test if this is only link wiring and env documentation.

**Step 2: Make minimal implementation**

- Add a logout link on the debug page.
- Document the new auth env vars and deploy flow in `README.md`.

**Step 3: Run verification**

Run:
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `node --test --experimental-strip-types src/lib/auth/session.test.ts src/lib/auth/paths.test.ts`

Expected: all pass
