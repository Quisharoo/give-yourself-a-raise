# Roadmap

Give Yourself a Raise is early. The roadmap should prove the core advice loop before adding native apps or broad platform surface area.

## Now

1. Bank picker and broader bank support
   - Replace hardcoded Revolut IE and Bankinter ES entry points with an Enable Banking ASPSP picker.
   - Prioritize Ireland, UK, Spain, EU neobanks, then major domestic banks.
   - Show unsupported-bank and thin-data states clearly.

2. Mobile web reliability
   - Make the iPhone web flow the primary validation path.
   - Tighten `login -> connect -> bank app/SCA -> callback -> brief`.
   - Keep the analysis API mobile-client ready, but do not build native iOS or Android yet.

3. Trust and explainability
   - Show the transactions behind each recommended lever.
   - Surface classification reason, confidence, and why excluded items were not counted.
   - Add an analysis quality section for date range, accounts included, missing data, and currency limits.

4. User correction loop
   - Let the user mark merchants or groups as not discretionary, fixed, savings/investment, ignored, or misclassified.
   - Persist those corrections and apply them to future briefs.

## Next

1. Recurring bills and subscription audit
   - Turn subscription candidates into a clear audit surface.
   - Highlight cancellation candidates, duplicate services, annualized cost, and price creep.

2. Month-over-month tracking
   - Show whether the user actually freed up the target amount.
   - Track category movement, recurring spend changes, and new leaks since the last brief.

3. Saved preferences and lightweight account model
   - Save bank sessions, ignored merchants, corrections, and target history.
   - Keep auth minimal until repeated usage proves a need for full multi-user product auth.

4. Export and sharing
   - Add a printable/PDF brief.
   - Add a copyable action list for personal follow-up.

## Later

1. Native iOS app
   - Build only after the mobile web loop has strong repeated-use evidence.
   - Reuse the existing analysis API.

2. Native Android app
   - Follow iOS only if there is clear demand or bank-consent reliability requires it.

3. Deeper advice modes
   - Keep hard guardrails around no investment, tax, legal, or debt advice.
   - Frame outputs as spending analysis and possible spending-power recovery, not guaranteed savings.
