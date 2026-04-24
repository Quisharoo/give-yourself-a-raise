# Mobile Raise Brief Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the brief route into a production mobile-first raise brief with swipeable action cards.

**Architecture:** Keep the existing Next App Router structure and analysis data contract. Replace only the brief presentation layer inside the current client component, backed by native scroll-snap interaction and global CSS tokens.

**Tech Stack:** Next 16 App Router, React 19 client component state, Tailwind v4 global CSS, native CSS scroll snap.

---

### Task 1: Reduce Brief Route Chrome

**Files:**
- Modify: `src/app/variant-page.tsx`

**Steps:**
- Keep diagnosis and explorer titles unchanged.
- For `variant === "brief"`, render a compact top bar instead of the long explanatory heading.
- Keep callback and configuration callouts visible when present.

**Verification:**
- Run `npm run typecheck`.
- Load `/` at 390px and confirm the long heading is gone.

### Task 2: Convert Brief Body To Mobile App Surface

**Files:**
- Modify: `src/app/analysis-panel.tsx`

**Steps:**
- Add local `activeLeverIndex` state.
- Build `actionLevers` from the primary and secondary levers.
- Replace the vertical "start here" plus "next best actions" report with a target panel and swipeable action carousel.
- Keep the target mode and amount controls.
- Keep details in the existing disclosure.

**Verification:**
- Run `npm run typecheck`.
- Load `/` at 390px and confirm the action cards swipe.

### Task 3: Add Mobile-First Styling

**Files:**
- Modify: `src/app/globals.css`

**Steps:**
- Add compact app shell, target panel, swipe carousel, dot indicators, and touch-safe button styles.
- Use `100dvh`-safe layout constraints.
- Respect `prefers-reduced-motion`.
- Avoid animating layout properties.

**Verification:**
- Run `npm run lint`.
- Run `npm run build`.
- Capture mobile and desktop screenshots.

### Task 4: Final Verification

**Files:**
- No new production files.

**Steps:**
- Run `npm run lint`.
- Run `npm run typecheck`.
- Run `npm run build`.
- Inspect `/` locally at 390px and 1280px.

**Acceptance:**
- Build exits 0.
- No TypeScript errors.
- Mobile first viewport is high signal.
- Swipe behavior uses production browser primitives.
