# Banking MCP financial contract

The MCP gives every agent the same financial classifications, exact per-currency totals, connection health, and recurring-charge evidence. It fetches bank transactions on demand. It persists connection metadata and user rules, not transaction histories.

## Usage

`get_connection_status` reports provider-confirmed consent validity, a warning within seven days, and the last recorded account fetch outcomes. Bank reads fail explicitly when consent expires or requested account data cannot be fetched.

`get_transaction_totals` accepts explicit dates and optional `purpose`, `project`, and `flow_kind` filters. Raw debit, credit, and net describe cash movements. Separately named expense, income, revenue, refund, and transfer totals describe financial meaning. Transfers never enter expense or income totals. Currencies remain separate.

`find_transactions` returns compact snake_case rows with exact signed decimal amounts and at most 50 rows. A 12,000-byte row budget can shorten a page and sets `page_limited_by_size`; the cursor continues after the last complete row. Full detail includes the raw merchant descriptor and classification evidence. Paging preserves existing signed cursor and whole-result guarantees.

`get_recurring_transactions` reports observed cadence, the last charge, an estimated next date, observed amount changes, and guarded overdue candidates. Estimates are not bank-scheduled payments or proof of cancellation.

## Ownership and data shape

- The provider client parses authoritative `access.valid_until` and structured provider errors. Missing expiry is unknown. `EXPIRED_SESSION` is distinct from other authentication failures.
- Connection storage owns encrypted sessions and account/resource fetch observations. Each observation includes the attempt, last successful fetch, requested range/status, page completion, observed transaction dates, and safe error code. A failed attempt preserves the previous success. An old session cannot overwrite a replacement connection's observations.
- A shared classification module owns canonical merchant identity, raw descriptor, economic flow, category, purpose, project, and matched rule evidence. Search, totals, spending summaries, comparisons, and recurring detection consume that same classification.
- Rule storage owns subject-scoped persistent rules. Initial rules are seeded idempotently from the user's instructions. Existing OAuth access remains read-only. No rule-writing MCP tools are added under a read-only scope.
- Recurring detection consumes booked expenses and current fetch evidence. It groups distinct charge streams by account, merchant, currency, purpose, and project. Calendar cadence and exact amount differences remain separate from estimated projections.

Purpose is `business`, `personal`, or `unassigned`. Project is a separate optional label. Economic flow distinguishes expenses, income/revenue, refunds, internal transfers, and unknown movements. Purpose rules cannot turn confirmed internal transfers into spending or revenue.

## Initial owner rules

- Apple bills are business expenses except exactly EUR 9.99. The exception does not by itself establish personal purpose. An equal amount in another currency is not that exception.
- Join Brands variants resolve to one merchant and business spending for INCREMNT.
- Amazon is personal. Amazon Prime remains a distinct merchant from general Amazon shopping.
- Apple Distribution credit payouts are business revenue for INCREMNT. They represent bank receipts, not gross App Store sales or profit.

Confirmed top-ups, savings movements, and currency exchanges are transfers in either direction. A generic bank `TRANSFER` code alone does not prove an internal movement. Unknown movements stay explicit.

## Integrated verification coverage

1. Connection health and presentation. Verify authoritative expiry and seven-day boundaries, early expiry errors, unrelated provider errors, durable success/failure metadata, empty versus failed fetches, replacement-connection races, exact balances, consistent output names, compact/full responses, and paging through MCP transport. Validate through the real MCP transport and provider fixtures.
2. Shared financial meaning. Verify both transfer directions, canonical aliases with raw detail, owner-rule persistence and isolation, exact Apple amount/currency exceptions, Join Brands project totals, Apple Distribution revenue, matching filters across every tool, and cursor invalidation after rule changes. Validate the same rows across consumers and retain the connection/output checks.
3. Recurring charges. Verify calendar month ends, leap years, weekly/monthly/quarterly/annual candidates, multiple bills from one merchant, observed price changes, skipped periods, and exclusion of pending/refunded/reversed rows. A failed fetch, insufficient history, old coverage, or incomplete pagination cannot become a missed-charge assertion.

Each increment is reviewed against observable MCP behavior and stored values. Synthetic financial fixtures are used for verification. No production bank data enters test output.

## Synthesis decision

The architecture compares three sketches from gpt-6-astra, gpt-6.1-sol, and gpt-6-luna. All preserve live bank reads and avoid a transaction warehouse. The selected shape centralizes financial classification and fetch evidence while retaining existing exact query arithmetic and analysis projections. Generation and attempt guards come from the observation-reader sketch. The extension sketch contributes fail-closed whole-result totals and explicit evidence for overdue candidates. All reviewers are GPT models, so provider diversity is limited.

We accept live provider availability and uncertain history completeness in exchange for avoiding retained transaction histories, ingestion jobs, and reconciliation migrations. Completing all provider pages describes a completed request, not a guarantee that the bank returned all historical activity.

## Implementation reconciliation

The user replaced the sequential increment gates with one integrated implementation and verification pass. The three coverage groups above remain the acceptance cases. No deployment is part of this implementation.

The shared classifier retains the existing category rules and adds economic flow, merchant identity, purpose, project, and matched-rule evidence. Merchant aliases are bounded table entries. Owner preferences are persisted declarative records seeded only for the configured owner, with conflict-safe insertion. `list_classification_rules` inspects those records under the existing read-only scope. No preference mutation tool or predicate language is added.

The MCP and browser analysis route consume that classifier. Search, totals, summaries, and both comparison periods use the same exact aggregation. Monthly projections remain separately labelled estimates. MCP fields are projected explicitly to snake_case; the web analysis DTO retains camelCase. Transaction references use source identity and remain stable when a rule changes; cursor fingerprints include the rule snapshot.

Balances expose canonical `amount_decimal`, currency, balance type, and provider reference/change timestamps. Search requests up to 50 compact rows and applies the byte budget before constructing its continuation cursor. `detail: full` adds the bounded raw merchant descriptor and classification evidence. Provider IDs, session IDs, and IBANs are excluded from MCP output. Structured failures expose only a safe code, message, reconnect URL, and persisted fetch observations.

Connection generations and per-resource attempt IDs guard persisted observations. Last success survives a later failed attempt. Empty success records zero rows and null observed dates. Balances do not refresh transactions. Request coverage, pagination completion, unknown history completeness, and latest booked dates remain distinct. A connection replaced during a fetch causes the tool to discard the obsolete result.

Recurring analysis uses weekly, fortnightly, monthly, quarterly, and annual cadence candidates. Annual cadence permits two observations at low confidence within the bank request's 366-day limit. Month-end addition clamps calendar days. Supported concurrent amount streams can separate bills from one merchant; sequential prices remain one stream with exact changes. Ambiguous or insufficient evidence stays explicit. Overdue-not-observed candidates require a successful current fetch covering the expected date plus grace through the evaluation date. Unknown bank-history completeness remains visible. Recurring output is capped at 50 entries, with count, next offset, and an instruction to restart if live data changes. The ten most recent amount changes are returned with the full observed change count.

Synthetic provider, classification, cadence, and actual MCP transport tests cover these contracts. Final local verification logs live under `.audit/integrated-*.log`. Independent review, real PostgreSQL storage acceptance, merge, deployment, and production bank validation remain separate outcomes.

The implementation-owner gate passed 142 tests before independent review. Review reproduced and corrected four gaps. Request-local successful coverage now travels with returned rows. Generation checks reject obsolete consent responses. Anchored internal-movement descriptors replace broad note substrings. Coherent whole-group cadence takes precedence over amount-based stream splitting. Regression tests demonstrate the original incorrect outcomes and their corrections.

`npm run verify:storage` initializes a private local PostgreSQL fixture and executes the actual storage SQL. It checks migration from the old schema, encrypted session roundtrips, success/failure observations, attempt and reconnect guards, concurrent disconnects, owner isolation, and persistent rule seeding that preserves overrides. No production bank data or credentials are required. Final integrated checks and independent review are recorded in the local audit trail; merge, deployment, and production validation remain separate.

The final local gate passed 152 tests with zero failures or skips, typecheck, lint, MCP smoke, and production build. PostgreSQL acceptance passed 79 actual queries across 12 check groups. These are synthetic local verification results. The decision trail is retained in `.audit/mcp-reliability.tsv`.

Independent final review also covered the response boundary after account details and observation lookups. Every successful connected response now checks its connection generation after its final asynchronous work. The independent review passed 73 focused tests and three direct reconnect reproductions, with no remaining material findings. All reviewers used GPT models, so provider diversity was limited.
