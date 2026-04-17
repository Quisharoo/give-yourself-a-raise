import { cookies } from "next/headers";

import {
  ENABLE_BANKING_SESSION_COOKIE,
  getApplication,
  getSessionOverview,
  hasEnableBankingConfig,
  listAspsps,
} from "@/lib/enable-banking/client";
import type {
  EnableBankingAccountSnapshot,
  EnableBankingApplication,
  EnableBankingAspsp,
  EnableBankingTransaction,
} from "@/lib/enable-banking/types";

const MONTHLY_RAISE_TARGET = 520;
const TAKE_HOME_PAY = 5200;
const LOOKBACK_DAYS = 90;
const KNOWN_SPENDING = [
  {
    amount: 500,
    category: "Eating out + delivery",
    note: "Biggest flexible bucket after clothing.",
  },
  {
    amount: 370,
    category: "Clothing",
    note: "Largest single cut target from the CSV pass.",
  },
  {
    amount: 1650,
    category: "Bankinter mortgage",
    note: "Known fixed cost. Track, but do not frame as near-term cut.",
  },
  {
    amount: 113,
    category: "YUNO utilities",
    note: "Fixed baseline.",
  },
];

type PageSearchParams = Promise<{
  connected?: string | string[];
  error?: string | string[];
}>;

export default async function Home({
  searchParams,
}: {
  searchParams: PageSearchParams;
}) {
  const resolvedSearchParams = await searchParams;
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(ENABLE_BANKING_SESSION_COOKIE)?.value;
  const isConfigured = hasEnableBankingConfig();
  const lookbackWindow = getLookbackWindow(LOOKBACK_DAYS);

  let application: EnableBankingApplication | null = null;
  let liveRevolutIeMatches: EnableBankingAspsp[] = [];
  let liveBankinterIeMatches: EnableBankingAspsp[] = [];
  let liveBankinterEsMatches: EnableBankingAspsp[] = [];
  let sessionOverviewError: string | null = null;
  let sessionOverview:
    | Awaited<ReturnType<typeof getSessionOverview>>
    | null = null;

  if (isConfigured) {
    try {
      [application, liveRevolutIeMatches, liveBankinterIeMatches, liveBankinterEsMatches] =
        await Promise.all([
          getApplication(),
          listAspsps("IE").then((aspsps) => filterAspsps(aspsps, "revolut")),
          listAspsps("IE").then((aspsps) => filterAspsps(aspsps, "bankinter")),
          listAspsps("ES").then((aspsps) => filterAspsps(aspsps, "bankinter")),
        ]);
    } catch (error) {
      sessionOverviewError =
        error instanceof Error ? error.message : "Unable to load Enable Banking metadata.";
    }
  }

  if (isConfigured && sessionId) {
    try {
      sessionOverview = await getSessionOverview(sessionId, {
        dateFrom: lookbackWindow.dateFrom,
        dateTo: lookbackWindow.dateTo,
        strategy: "default",
      });
    } catch (error) {
      sessionOverviewError =
        error instanceof Error ? error.message : "Unable to load connected account data.";
    }
  }

  const totalFlexibleCuts = 500 + 370;
  const remainingGap = Math.max(0, MONTHLY_RAISE_TARGET - totalFlexibleCuts);
  const monthlyConnectedSpend = sessionOverview
    ? sessionOverview.accounts.reduce((total, account) => {
        return total + summarizeAccount(account).monthlySpend;
      }, 0)
    : null;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-5 py-6 sm:px-8 lg:px-10">
      <section className="panel panel-strong relative overflow-hidden rounded-[2rem] px-6 py-7 sm:px-8 sm:py-9 lg:px-10">
        <div className="absolute inset-y-0 right-0 hidden w-2/5 bg-[radial-gradient(circle_at_top,rgba(35,75,56,0.22),transparent_62%)] lg:block" />
        <div className="relative grid gap-8 lg:grid-cols-[1.35fr_0.9fr] lg:items-end">
          <div className="space-y-5">
            <p className="eyebrow">Give Yourself A Raise</p>
            <div className="space-y-3">
              <h1 className="display max-w-3xl text-4xl leading-none text-[var(--foreground)] sm:text-5xl lg:text-6xl">
                Find an extra <span className="text-[var(--accent)]">€520 a month</span> without
                pretending fixed costs are optional.
              </h1>
              <p className="max-w-2xl text-base leading-7 text-muted sm:text-lg">
                This first milestone focuses on bank connectivity: signed JWT auth, live ASPSP
                lookup, consent redirect, session creation, and transaction retrieval for Revolut
                and Bankinter.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <a
                className="focus-ring hover-lift inline-flex items-center rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white"
                href="#connections"
              >
                Wire the first bank
              </a>
              <a
                className="focus-ring hover-lift inline-flex items-center rounded-full border border-[var(--stroke)] bg-white/55 px-5 py-3 text-sm font-semibold text-[var(--foreground)]"
                href="/api/enable-banking/session"
              >
                Inspect current session JSON
              </a>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            <MetricPanel
              label="Take-home baseline"
              value={formatEuro(TAKE_HOME_PAY)}
              detail="Used to define the 10% raise target."
            />
            <MetricPanel
              label="Raise target"
              value={formatEuro(MONTHLY_RAISE_TARGET)}
              detail="Equivalent to a 10% boost on €5.2K take-home."
            />
            <MetricPanel
              label="Known flexible cuts"
              value={formatEuro(totalFlexibleCuts)}
              detail={
                remainingGap === 0
                  ? "Clothing + eating out already span the target."
                  : `${formatEuro(remainingGap)} still missing after the two obvious cuts.`
              }
            />
          </div>
        </div>
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="panel rounded-[1.75rem] p-6 sm:p-7">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="eyebrow">Pressure Points</p>
              <h2 className="display mt-2 text-3xl">Known spending pattern anchors</h2>
            </div>
            <div className="rounded-full border border-[var(--stroke)] bg-white/70 px-4 py-2 text-sm text-muted">
              CSV analysis snapshot
            </div>
          </div>
          <div className="mt-6 grid gap-3">
            {KNOWN_SPENDING.map((item) => (
              <div
                key={item.category}
                className="hover-lift rounded-[1.4rem] border border-[var(--stroke)] bg-white/65 px-5 py-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold text-[var(--foreground)]">
                      {item.category}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-muted">{item.note}</p>
                  </div>
                  <div className="display text-3xl text-[var(--accent)]">
                    {formatEuro(item.amount)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel rounded-[1.75rem] p-6 sm:p-7" id="connections">
          <p className="eyebrow">Milestone 1</p>
          <h2 className="display mt-2 text-3xl">Enable Banking connection status</h2>
          <div className="mt-5 space-y-3">
            <StatusBanner
              tone={firstValue(resolvedSearchParams.error) ? "danger" : "neutral"}
              title={
                firstValue(resolvedSearchParams.error)
                  ? "Last callback returned an error"
                  : firstValue(resolvedSearchParams.connected)
                    ? "Consent flow completed"
                    : isConfigured
                      ? "Credentials loaded"
                      : "Waiting for credentials"
              }
              detail={
                firstValue(resolvedSearchParams.error) ??
                (firstValue(resolvedSearchParams.connected)
                  ? "Session cookie stored. The page will now attempt to fetch balances and transactions."
                  : isConfigured
                    ? "You can start a live consent journey from the presets below."
                    : "Paste the application ID and .pem into .env.local, then reload.")
              }
            />
            {sessionOverviewError ? (
              <StatusBanner tone="warning" title="API note" detail={sessionOverviewError} />
            ) : null}
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <QuickAction
              href="/api/enable-banking/connect?name=Revolut&country=IE&psuType=personal"
              label="Connect Revolut IE"
              note="Use the mobile-app consent flow if you want the credit card account to appear."
            />
            <QuickAction
              href="/api/enable-banking/connect?name=Bankinter&country=ES&psuType=personal"
              label="Connect Bankinter ES"
              note="Official Enable Banking docs currently expose Bankinter specifics under Spain."
            />
          </div>

          <form
            action="/api/enable-banking/connect"
            method="get"
            className="mt-5 grid gap-3 rounded-[1.4rem] border border-[var(--stroke)] bg-white/62 p-4 md:grid-cols-[1.5fr_7rem_8rem_auto]"
          >
            <input
              className="focus-ring rounded-full border border-[var(--stroke)] bg-white px-4 py-3 text-sm"
              defaultValue="Revolut"
              name="name"
              placeholder="ASPSP name"
            />
            <input
              className="focus-ring rounded-full border border-[var(--stroke)] bg-white px-4 py-3 text-sm uppercase"
              defaultValue="IE"
              maxLength={2}
              name="country"
              placeholder="IE"
            />
            <select
              className="focus-ring rounded-full border border-[var(--stroke)] bg-white px-4 py-3 text-sm"
              defaultValue="personal"
              name="psuType"
            >
              <option value="personal">personal</option>
              <option value="business">business</option>
            </select>
            <button
              className="focus-ring hover-lift rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white"
              type="submit"
            >
              Start consent
            </button>
          </form>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <LookupPanel
              country="IE"
              title="Irish lookup"
              matches={[...liveRevolutIeMatches, ...liveBankinterIeMatches]}
              fallback="Revolut should appear here once credentials are live. I could not verify a Bankinter IE listing from the official docs."
            />
            <LookupPanel
              country="ES"
              title="Spanish lookup"
              matches={liveBankinterEsMatches}
              fallback="Bankinter ES is the documented fallback target."
            />
          </div>

          <div className="mt-5 grid gap-3 text-sm text-muted sm:grid-cols-2">
            <div className="rounded-[1.2rem] bg-[var(--background-strong)] px-4 py-3">
              Restricted production only returns data for accounts linked to the application.
            </div>
            <div className="rounded-[1.2rem] bg-[var(--background-strong)] px-4 py-3">
              Revolut credit cards are only selectable in the mobile-app consent flow, not the web flow.
            </div>
          </div>
        </div>
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-[0.92fr_1.08fr]">
        <div className="panel rounded-[1.75rem] p-6 sm:p-7">
          <p className="eyebrow">Build Status</p>
          <h2 className="display mt-2 text-3xl">Milestones</h2>
          <ol className="mt-6 space-y-4">
            <MilestoneItem
              body="JWT signing with the application ID as `kid`, API audience `api.enablebanking.com`, and server-side fetch helpers for auth, sessions, balances, and transactions."
              title="1. Enable Banking server client"
              tone="done"
            />
            <MilestoneItem
              body="Consent start route, callback route, session-cookie handling, ASPSP lookup route, disconnect route, and JSON session inspection."
              title="2. App Router auth slice"
              tone="done"
            />
            <MilestoneItem
              body="Categorisation engine and raise-progress dashboard with merchant/transfer heuristics, monthly deltas, and category drill-down."
              title="3. Behaviour layer"
              tone="next"
            />
          </ol>
        </div>

        <div className="panel rounded-[1.75rem] p-6 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="eyebrow">Connected Accounts</p>
              <h2 className="display mt-2 text-3xl">Live transaction preview</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                className="focus-ring hover-lift rounded-full border border-[var(--stroke)] bg-white/70 px-4 py-2 text-sm font-medium"
                href="/api/enable-banking/session"
              >
                Open JSON
              </a>
              <a
                className="focus-ring hover-lift rounded-full border border-[var(--stroke)] bg-white/70 px-4 py-2 text-sm font-medium"
                href="/api/enable-banking/disconnect"
              >
                Disconnect
              </a>
            </div>
          </div>

          {!sessionOverview ? (
            <div className="mt-6 rounded-[1.4rem] border border-dashed border-[var(--stroke)] bg-white/55 px-5 py-8 text-sm leading-7 text-muted">
              No active session cookie yet. Once you complete a consent flow, this panel will show
              balances and the last {LOOKBACK_DAYS} days of transactions per authorised account.
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              {sessionOverview.accounts.map((account) => {
                const summary = summarizeAccount(account);

                return (
                  <article
                    key={account.accountId}
                    className="hover-lift rounded-[1.4rem] border border-[var(--stroke)] bg-white/68 p-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <p className="text-xs uppercase tracking-[0.18em] text-muted">
                          {account.name || "Connected account"}
                        </p>
                        <h3 className="mt-2 text-lg font-semibold text-[var(--foreground)]">
                          {account.iban || account.accountId}
                        </h3>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-muted">Avg monthly outflow</p>
                        <p className="display text-3xl text-[var(--accent)]">
                          {formatEuro(summary.monthlySpend)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-3 sm:grid-cols-3">
                      <SmallStat
                        label="Transactions"
                        value={String(summary.transactionCount)}
                      />
                      <SmallStat
                        label="Booked balances"
                        value={summary.balanceSummary}
                      />
                      <SmallStat
                        label="Net flow"
                        value={formatEuro(summary.netFlow)}
                      />
                    </div>

                    <div className="mt-5 overflow-hidden rounded-[1.2rem] border border-[var(--stroke)]">
                      <table className="w-full border-collapse text-left text-sm">
                        <thead className="bg-[var(--background-strong)]">
                          <tr>
                            <th className="px-4 py-3 font-medium text-muted">Date</th>
                            <th className="px-4 py-3 font-medium text-muted">Counterparty</th>
                            <th className="px-4 py-3 font-medium text-muted">Reference</th>
                            <th className="px-4 py-3 text-right font-medium text-muted">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {account.transactions.slice(0, 8).map((transaction) => (
                            <tr
                              key={
                                transaction.transaction_id ||
                                transaction.entry_reference ||
                                `${transaction.transaction_date}-${transaction.transaction_amount.amount}`
                              }
                              className="border-t border-[var(--stroke)] bg-white/70"
                            >
                              <td className="px-4 py-3 text-muted">
                                {transaction.booking_date || transaction.transaction_date || "—"}
                              </td>
                              <td className="px-4 py-3">
                                {transaction.creditor?.name ||
                                  transaction.debtor?.name ||
                                  "Unknown"}
                              </td>
                              <td className="px-4 py-3 text-muted">
                                {transaction.remittance_information?.[0] ||
                                  transaction.note ||
                                  transaction.entry_reference ||
                                  "—"}
                              </td>
                              <td className="px-4 py-3 text-right font-medium">
                                <span
                                  className={
                                    getSignedAmount(transaction) < 0
                                      ? "text-[var(--foreground)]"
                                      : "text-[var(--accent)]"
                                  }
                                >
                                  {formatEuro(getSignedAmount(transaction))}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {monthlyConnectedSpend !== null ? (
            <div className="mt-5 rounded-[1.4rem] bg-[var(--accent-soft)] px-5 py-4">
              <p className="text-sm text-muted">
                Current connected monthly spend signal:{" "}
                <span className="font-semibold text-[var(--foreground)]">
                  {formatEuro(monthlyConnectedSpend)}
                </span>
              </p>
            </div>
          ) : null}
        </div>
      </section>

      <section className="mt-6 pb-6">
        <div className="panel rounded-[1.75rem] p-6 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="eyebrow">Config Checklist</p>
              <h2 className="display mt-2 text-3xl">What to paste next</h2>
            </div>
            {application ? (
              <div className="rounded-full border border-[var(--stroke)] bg-white/70 px-4 py-2 text-sm text-muted">
                {application.environment} · {application.active ? "active" : "pending"}
              </div>
            ) : null}
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_1fr_1fr]">
            <ChecklistPanel
              title="1. Credentials"
              items={[
                "Create .env.local from .env.example",
                "Paste ENABLE_BANKING_APPLICATION_ID",
                "Paste the PEM directly or point ENABLE_BANKING_PRIVATE_KEY_PATH at the file",
              ]}
            />
            <ChecklistPanel
              title="2. Redirect URL"
              items={[
                "Whitelist APP_BASE_URL/callback in the Enable Banking control panel",
                "Use localhost or your tunnel URL consistently",
                "Reload the app after env changes",
              ]}
            />
            <ChecklistPanel
              title="3. Validation"
              items={[
                "Run a Revolut IE consent first",
                "Use the mobile flow to expose the Revolut credit card account",
                "Confirm Bankinter through the ASPSP lookup before assuming IE coverage",
              ]}
            />
          </div>

          <div className="mt-5 rounded-[1.4rem] border border-[var(--stroke)] bg-white/65 p-5">
            <p className="font-semibold text-[var(--foreground)]">Quick GitHub URLs after push</p>
            <p className="mt-2 text-sm leading-6 text-muted">
              Public website versions for registration:
            </p>
            <div className="mt-3 space-y-2 text-sm">
              <p className="break-all text-[var(--accent)]">
                https://quisharoo.github.io/give-yourself-a-raise/privacy/
              </p>
              <p className="break-all text-[var(--accent)]">
                https://quisharoo.github.io/give-yourself-a-raise/terms/
              </p>
            </div>
            <p className="mt-4 text-sm leading-6 text-muted">
              Source pages stay in{" "}
              <span className="font-medium text-[var(--foreground)]">
                github.com/Quisharoo/give-yourself-a-raise
              </span>
              :
            </p>
            <div className="mt-3 space-y-2 text-sm">
              <p className="break-all text-[var(--accent)]">
                https://github.com/Quisharoo/give-yourself-a-raise/blob/main/docs/privacy-policy.md
              </p>
              <p className="break-all text-[var(--accent)]">
                https://github.com/Quisharoo/give-yourself-a-raise/blob/main/docs/terms-of-service.md
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function MetricPanel({
  detail,
  label,
  value,
}: {
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[1.4rem] border border-[var(--stroke)] bg-white/68 px-5 py-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="display mt-2 text-3xl text-[var(--foreground)]">{value}</p>
      <p className="mt-2 text-sm leading-6 text-muted">{detail}</p>
    </div>
  );
}

function QuickAction({
  href,
  label,
  note,
}: {
  href: string;
  label: string;
  note: string;
}) {
  return (
    <a
      className="focus-ring hover-lift rounded-[1.4rem] border border-[var(--stroke)] bg-white/68 px-5 py-4"
      href={href}
    >
      <p className="font-semibold text-[var(--foreground)]">{label}</p>
      <p className="mt-2 text-sm leading-6 text-muted">{note}</p>
    </a>
  );
}

function LookupPanel({
  country,
  fallback,
  matches,
  title,
}: {
  country: string;
  fallback: string;
  matches: EnableBankingAspsp[];
  title: string;
}) {
  return (
    <div className="rounded-[1.4rem] bg-[var(--background-strong)] px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold text-[var(--foreground)]">{title}</p>
        <a
          className="focus-ring text-sm text-[var(--accent)] underline decoration-[0.08em] underline-offset-4"
          href={`/api/enable-banking/aspsps?country=${country}`}
        >
          Raw API
        </a>
      </div>
      {matches.length > 0 ? (
        <ul className="mt-3 space-y-2 text-sm text-muted">
          {matches.map((match) => (
            <li key={`${match.country}-${match.name}`}>
              <span className="font-medium text-[var(--foreground)]">{match.name}</span>{" "}
              <span className="uppercase">({match.country})</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm leading-6 text-muted">{fallback}</p>
      )}
    </div>
  );
}

function StatusBanner({
  detail,
  title,
  tone,
}: {
  detail: string;
  title: string;
  tone: "danger" | "neutral" | "warning";
}) {
  const className =
    tone === "danger"
      ? "bg-[var(--danger-soft)]"
      : tone === "warning"
        ? "bg-[var(--warning-soft)]"
        : "bg-[var(--accent-soft)]";

  return (
    <div className={`rounded-[1.3rem] px-4 py-4 ${className}`}>
      <p className="font-semibold text-[var(--foreground)]">{title}</p>
      <p className="mt-1 text-sm leading-6 text-muted">{detail}</p>
    </div>
  );
}

function MilestoneItem({
  body,
  title,
  tone,
}: {
  body: string;
  title: string;
  tone: "done" | "next";
}) {
  return (
    <li className="flex gap-4">
      <div
        className={`mt-1 h-3 w-3 rounded-full ${
          tone === "done" ? "bg-[var(--accent)]" : "bg-[var(--warning-soft)]"
        }`}
      />
      <div>
        <p className="font-semibold text-[var(--foreground)]">{title}</p>
        <p className="mt-1 text-sm leading-6 text-muted">{body}</p>
      </div>
    </li>
  );
}

function SmallStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[1.15rem] bg-[var(--background-strong)] px-4 py-3">
      <p className="text-xs uppercase tracking-[0.16em] text-muted">{label}</p>
      <p className="mt-2 text-base font-semibold text-[var(--foreground)]">{value}</p>
    </div>
  );
}

function ChecklistPanel({
  items,
  title,
}: {
  items: string[];
  title: string;
}) {
  return (
    <div className="rounded-[1.4rem] border border-[var(--stroke)] bg-white/65 p-5">
      <p className="font-semibold text-[var(--foreground)]">{title}</p>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-muted">
        {items.map((item) => (
          <li key={item}>• {item}</li>
        ))}
      </ul>
    </div>
  );
}

function filterAspsps(aspsps: EnableBankingAspsp[], query: string) {
  const normalizedQuery = query.toLowerCase();
  return aspsps.filter((aspsp) => aspsp.name.toLowerCase().includes(normalizedQuery));
}

function summarizeAccount(account: EnableBankingAccountSnapshot) {
  const transactionCount = account.transactions.length;
  const netFlow = account.transactions.reduce((total, transaction) => {
    return total + getSignedAmount(transaction);
  }, 0);
  const spend = account.transactions.reduce((total, transaction) => {
    const amount = getSignedAmount(transaction);
    return amount < 0 ? total + Math.abs(amount) : total;
  }, 0);
  const monthlySpend = spend / (LOOKBACK_DAYS / 30);
  const balanceSummary = account.balances.length
    ? account.balances
        .map((balance) => formatEuro(Number(balance.balance_amount.amount)))
        .join(" · ")
    : "No balances returned";

  return {
    balanceSummary,
    monthlySpend,
    netFlow,
    transactionCount,
  };
}

function getSignedAmount(transaction: EnableBankingTransaction): number {
  const amount = Number(transaction.transaction_amount.amount);
  return Number.isFinite(amount) ? amount : 0;
}

function formatEuro(amount: number) {
  return new Intl.NumberFormat("en-IE", {
    currency: "EUR",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(amount);
}

function firstValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function getLookbackWindow(days: number) {
  const dateTo = new Date();
  const dateFrom = new Date(dateTo);

  dateFrom.setDate(dateFrom.getDate() - days);

  return {
    dateFrom: dateFrom.toISOString().slice(0, 10),
    dateTo: dateTo.toISOString().slice(0, 10),
  };
}
