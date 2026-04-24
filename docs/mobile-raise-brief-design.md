# Mobile Raise Brief Design

## Goal

Make the brief feel like the first screen of a premium mobile app: one clear target, a tiny amount of tuning, and high-signal spending shapes that explain where the target could come from.

## Product Shape

- The primary route stays `/`.
- The existing analysis payload stays unchanged.
- The brief remains production code in the Next app, not a throwaway prototype.
- Diagnosis and explorer routes keep their deeper inspection role.

## Mobile UX

- Top of screen: compact brand and analysis state.
- Main surface: target amount, three simple target presets, and a small coverage line.
- Signal surface: impact bubbles sized by estimated recovery and marked with target coverage.
- Bottom affordance: concise "why" disclosure and source metadata.
- Explanatory copy is reduced to labels, amounts, and the few merchants behind the selected signal.

## Implementation

- Modify `src/app/variant-page.tsx` to reduce brief-route chrome.
- Modify `src/app/analysis-panel.tsx` to render the brief as a target plus impact-bubble surface.
- Modify `src/app/globals.css` for the mobile app shell, target panel, impact bubbles, reduced copy, and touch-friendly controls.
- Use native buttons and CSS transforms/opacity only.
- Do not add dependencies.

## Acceptance

- At 390px width, the first viewport shows the brand, target, presets, and spending bubbles.
- Impact bubbles are tap targets and update the active signal summary.
- Controls are at least 44px tall.
- No horizontal page overflow.
- Existing analysis, diagnosis, explorer, and API contracts are unchanged.
