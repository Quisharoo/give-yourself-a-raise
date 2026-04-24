# Core App Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Collapse the prototype routes into one premium, data-first product page with stronger loading, empty, and connected states.

**Architecture:** The app will stop routing through the variant system and instead render a single product flow at `/`. `AnalysisPanel` becomes the main state machine for disconnected, loading, error, and ready states, while removed routes are deleted and their useful content is folded into in-page disclosure sections.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4, TypeScript, Node test runner

---

### Task 1: Add a small pure test target for the new single-page presentation logic

**Files:**
- Create: `src/lib/analysis/presentation.ts`
- Create: `src/lib/analysis/presentation.test.ts`

**Step 1: Write the failing test**

- Add tests for:
  - choosing a dominant currency fallback
  - computing filtered transaction share
  - counting actions needed to hit a target

**Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types src/lib/analysis/presentation.test.ts`

Expected: FAIL because the helper file does not exist yet.

**Step 3: Write minimal implementation**

- Add small pure helpers extracted from the current UI math.

**Step 4: Run test to verify it passes**

Run: `node --test --experimental-strip-types src/lib/analysis/presentation.test.ts`

Expected: PASS

### Task 2: Remove the variant routing layer

**Files:**
- Modify: `src/app/page.tsx`
- Delete: `src/app/diagnosis/page.tsx`
- Delete: `src/app/explorer/page.tsx`
- Delete: `src/app/debug/page.tsx`
- Delete: `src/app/variant-page.tsx`

**Step 1: Write the failing test**

- No extra framework route test; rely on build and route output verification.

**Step 2: Write minimal implementation**

- Render the single product flow directly from `/`.
- Remove references to the deleted prototype routes.

**Step 3: Run verification**

Run: `npm run build`

Expected: build output no longer lists `/diagnosis`, `/explorer`, or `/debug`.

### Task 3: Redesign the main analysis experience

**Files:**
- Modify: `src/app/analysis-panel.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`

**Step 1: Write the failing test**

- Reuse the presentation helper tests if UI math moves there.

**Step 2: Write minimal implementation**

- Replace prototype variant branching with one coherent product flow.
- Introduce stronger disconnected and loading states.
- Move inspectability into in-page expandable sections.
- Remove “Open debug tools” and all route-based prototype navigation.
- Upgrade typography and surfaces to the agreed design direction.

**Step 3: Run verification**

Run:
- `node --test --experimental-strip-types src/lib/analysis/presentation.test.ts`
- `npm run lint`
- `npm run typecheck`
- `npm run build`

Expected: all pass

### Task 4: Clean up docs and copy

**Files:**
- Modify: `README.md`

**Step 1: Make minimal implementation**

- Update the route description to reflect a single product page.

**Step 2: Run verification**

Run: `npm run lint && npm run typecheck && npm run build`

Expected: PASS
