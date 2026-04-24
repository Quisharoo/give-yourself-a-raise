# Core App Redesign Design

**Date:** 2026-04-23

## Goal

Turn the app into one convincing product surface at `/`: a strong private landing page when disconnected, and a sharp analysis instrument when connected.

## Product Decision

- Keep only `/` as the product route.
- Remove `/diagnosis`, `/explorer`, and `/debug`.
- Keep all inspectability inside the main page as expandable proof sections.
- Let the connected state replace most of the landing shell, because the data and actions matter more than the pitch.

## UX Shape

### Disconnected

- The page opens as an editorial finance product page.
- The hero states the thesis clearly and aggressively.
- The next layer builds trust by explaining what the model excludes before it gives advice.
- Connect actions are prominent and repeated in a lower proof section.

### Loading

- Use structural skeletons, not generic spinners.
- Loading should mirror the final analysis layout:
  - hero skeleton
  - main recommendation skeleton
  - evidence strip skeleton
  - proof rows skeleton

### Connected

- The hero collapses into a live analysis header.
- The primary recommendation dominates the first screen.
- Supporting actions sit in a ranked list below.
- Inspectability is available as in-page disclosure sections for:
  - model exclusions
  - recurring patterns
  - fixed-cost context
  - ambiguity

## Visual Direction

- Light mode only.
- Editorial-finance tone, not dashboard SaaS.
- Neutral mineral background with one restrained green-blue accent.
- Larger typographic contrast and stronger asymmetry on desktop.
- Fewer generic cards, more ruled sections, spotlight panels, and evidence rails.
- Connected state should feel like a financial brief, not a control panel.

## Information Hierarchy

1. Thesis / current state
2. Primary recoverable action
3. Ranked follow-up actions
4. What the model excludes
5. Proof and inspectability

## Technical Plan

- Remove the variant route system.
- Convert `AnalysisPanel` into a single-route renderer with distinct empty, loading, error, and ready states.
- Replace route links to removed prototype pages with in-page sections.
- Delete the unused page files for `/diagnosis`, `/explorer`, and `/debug`.

## Verification

- Run lint, typecheck, build
- Keep auth flow intact
- Confirm `/` works disconnected and connected
- Confirm removed routes no longer exist
