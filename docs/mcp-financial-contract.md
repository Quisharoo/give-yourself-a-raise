# Banking MCP financial contract

The MCP gives agents the same stored classifications, exact per-currency totals, connection health, and recurring-charge evidence. Bank transactions are fetched on demand. The application stores encrypted connections, fetch metadata, classification rules, one-off labels, and opaque identity evidence. It does not store a transaction history.

## Classification reads and writes

`list_classification_rules` returns the authenticated owner's rules and supported transaction overrides. Listing and editing classifications does not require active bank consent.

Bank reads require `read:bank_data`. These label tools require both `read:bank_data` and the separate `write:classifications` OAuth permission:

- `upsert_classification_rule` saves a rule by `id`.
- `delete_classification_rule` deletes a rule by `id`.
- `set_transaction_override` saves one-off labels for a supported observed `transaction_ref`. Pass only `transaction_ref` and `labels: null` to clear a one-off and resume current merchant rules or heuristic classification. A clear returns `override: null`, including when no override exists.

The server checks the write permission before calling any classification storage function. Existing read tokens cannot change labels. Bank tools cannot move money.

A rule matches either an exact canonical `merchant_key` or case-insensitive literal `merchant_text` in the merchant descriptor. Text is not a regular expression. Optional constraints are `exact_amount`, `except_amount`, `direction`, `account_ref`, and `zero_amount`. Amount constraints include currency and use decimal strings. Higher `priority` wins. Equal priorities use ascending rule ID. Inputs have bounded strings and reject unknown fields.

Rules assign `purpose`, nullable `project`, and nullable `flow_kind`. Purpose is `business`, `personal`, or `unassigned`. Economic flows are `expense`, `income`, `revenue`, `refund`, `transfer`, and `unknown`. A one-off override wins purpose, project, and explicit flow labels over merchant rules and generic funding defaults. Its flow cannot replace bank-backed internal movement, a refund, or a reversal.

Each MCP read loads one classification snapshot and uses it for transaction rows, exact totals, spending estimates, both comparison periods, and recurrence. Production snapshot reads select rules and supported overrides in one database statement. Changed classifications invalidate existing paging fingerprints.

## Owner defaults and seed migration

The owner defaults include these INCREMNT expenses:

- ChatGPT, OpenRouter, Render, Register365, Hetzner, Upstash, Vercel, Cursor, and Lovable.
- Intellectual Property Office and Companies Registration Office, including truncated bank descriptors.
- Join Brands and nonzero Apple bills other than exactly EUR 9.99.

Exactly EUR 9.99 Apple bills are personal. Google Play, Exchanged to USD, Kevin Byrne, Paul Michael McCarthy, Amazon, and Amazon Prime are personal. Currency exchange remains a transfer. Amazon Prime and Upstash have distinct merchant aliases before the broader Amazon and Vercel aliases. Apple Distribution credit receipts are INCREMNT revenue, not gross App Store sales or profit.

A versioned atomic seed migration adds the defaults once. It repairs the unchanged legacy Apple rule's missing project and zero-amount exclusion. Existing user edits survive. Missing legacy rules are preserved when upgrading an existing rule set. Deleting a seed after migration does not recreate it on later reads or restarts. Merchant aliases contain names, while database records contain owner preferences.

## Stable references and safe overrides

For accounts with validated Enable Banking `identification_hash`, references use the bank's cross-session identification, provider, country, currency, and account type. A transaction adds its bank `entry_reference`, or `transaction_id` when no entry reference exists. A subject-scoped HMAC uses the server encryption key, independently of the bank session and rotating account UID. Rotating that server key changes these references.

The provider documents `identification_hash` for matching accounts across sessions in its [API reference](https://enablebanking.com/docs/api/reference/). Local verification simulates a reconnect with rotated session and account IDs. It does not establish a real future provider reconnect outcome.

The application retains only opaque references and hashes of observed identity evidence. It does not use merchant, date, or amount similarity to reconcile transactions. Dashboard and MCP reads observe current bank identity evidence through the same policy before classification. Duplicate bank identities and contradictory evidence disable overrides conservatively, including previously saved labels. No duplicate ordinal becomes an override identity.

Optional account details may be unavailable. Those accounts remain readable with session-bound references. Transactions with missing, duplicate, or conflicting identity evidence return `override_supported: false` and an explicit `override_reason`. Supported identities return a null reason. Saving labels refuses unsupported, unknown, or other-owner references. Clearing deletes only the caller's stored override and can remove disabled labels without making an ambiguous identity eligible again. Account-filter rules using fallback session-bound references do not survive a reconnect.

Cursors remain signed for the bank session, user, fixed query, result fingerprint, and 15-minute expiry. A reconnect requires restarting paging even when transaction references remain stable. No cursor database is used.

## Exact totals, pending charges, and response limits

`get_transaction_totals` and `find_transactions` default to `BOOK`. Decimal-string debit, credit, and net totals cover all matching bank-returned rows before pagination. Classified totals separately report each economic flow. Currencies remain separate. Bank-history completeness and card-balance reconciliation are not guaranteed.

For a `BOOK` request, `pending` reports separate `PDNG` totals with the same dates, accounts, merchant, amount, and financial filters. Pending charges never enter booked totals. A different explicit status retains its existing meaning.

`find_transactions` returns at most 50 complete rows. A row budget and a 16,000-byte serialized MCP tool-result budget can shorten the page. The result retains JSON text and structured data for client compatibility. `page_limited_by_size` reports shortening, and `next_cursor` continues after the last emitted row. Metadata that cannot fit with one row produces an explicit request error suggesting narrower filters. Full detail adds the raw merchant descriptor and classification evidence.

## Freshness and recurrence

Fetch metadata records the last attempt and `last_success`. A failed attempt preserves successful coverage. Only the latest attempt updates that state. A broad read can finish after a newer narrow attempt and independently advance `broad_success` within the same connection generation. A replacement window must finish no earlier, end no earlier, cover at least as many days, and include the previous status coverage. Daily rolling history windows qualify. The watermark describes one actual read and never combines separate windows. A replacement connection starts a new generation. Request dates, status, pagination completion, observed dates, and unknown history completeness remain explicit.

Recurring analysis consumes booked expenses and request-local successful fetch evidence. It groups streams by account, merchant, currency, purpose, and project. Weekly, fortnightly, monthly, and quarterly inference require at least three observations. Annual inference permits two. Supported concurrent amount streams can separate bills from one merchant. Month-end calendar addition clamps to the last valid day.

Business merchants with a single observation remain visible as insufficient-evidence candidates. They do not acquire a predicted billing date. `merchant_amount_changes` separately reports observed merchant amount changes across accounts, with account provenance and an explicit warning that the same subscription has not been proved. Those observations do not establish recurring identity or overdue status.

Overdue-not-observed requires supported cadence and a fresh, completed request covering the expected date through the evaluation date. It is not proof of cancellation or nonbilling. Failed reads, pending charges, insufficient history, stale coverage, and ambiguous charges cannot establish an overdue charge. `history_complete` remains `unknown` because provider pagination does not prove complete historical bank activity.

## Local verification

`npm test` covers the shared classifier and actual MCP transport, scope enforcement, reconnect identity, duplicate and conflicting identity, protected events, whole-result totals, response size, and paging. `npm run smoke:mcp` uses the real SDK and validates published output schemas with synthetic bank data.

`npm run verify:storage` executes the application SQL against a private temporary PostgreSQL instance. It checks seed migration, preserved edits and deletions, one-off override isolation, conflicting evidence, durable broad coverage, encrypted connections, attempt guards, and reconnect races. It uses no production credentials.

Merge, deployment, production data acceptance, and a real reconnect remain separate from these local checks. The optional rules-management page is deferred.
