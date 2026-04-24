# Mobile Raise Brief Design

## Goal

Make the brief feel like the first screen of a mobile app: one clear target, one best action, swipeable alternatives, and details hidden until requested.

## Product Shape

- The primary route stays `/`.
- The existing analysis payload stays unchanged.
- The brief remains production code in the Next app, not a throwaway prototype.
- Diagnosis and explorer routes keep their deeper inspection role.

## Mobile UX

- Top of screen: compact brand and analysis state.
- Main surface: target amount, target controls, and progress summary.
- Action surface: horizontally swipeable action cards using native scroll snap.
- Bottom affordance: concise "why" disclosure and source metadata.
- Explanatory copy is reduced to what helps the user choose an action.

## Implementation

- Modify `src/app/variant-page.tsx` to reduce brief-route chrome.
- Modify `src/app/analysis-panel.tsx` to render the brief as a mobile-first swipe experience.
- Modify `src/app/globals.css` for the mobile app shell, swipe cards, reduced copy, and touch-friendly controls.
- Use native scrolling, buttons, and CSS transforms/opacity only.
- Do not add dependencies.

## Acceptance

- At 390px width, the first viewport shows the brand, target, controls, and the start of the swipeable action area.
- Action cards swipe horizontally with scroll snap.
- Controls are at least 44px tall.
- No horizontal page overflow.
- Existing analysis, diagnosis, explorer, and API contracts are unchanged.
