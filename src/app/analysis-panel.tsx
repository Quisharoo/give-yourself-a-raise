"use client";

import { useEffect, useMemo, useState } from "react";

import type {
  AnalysisLever,
  FixedCostItem,
  HabitMerchant,
  SpendingAnalysis,
  SubscriptionAuditItem,
  UncertainSpendItem,
} from "@/lib/analysis/types";
import { sampleSpendingAnalysisFixture } from "@/lib/analysis/fixtures";
import type { VariantKey } from "@/app/variant-page";

type AnalysisState =
  | { status: "loading" }
  | { status: "missing"; message: string }
  | { status: "error"; message: string }
  | { status: "ready"; analysis: SpendingAnalysis; source: "fixture" | "live" };

type ExplorerRow = {
  detail: string;
  key: string;
  kind: "fixed" | "lever" | "uncertain";
  label: string;
  monthlySpend: number;
};

type RecurringRow = {
  detail: string;
  key: string;
  label: string;
  monthlySpend: number;
  pattern: "habit" | "subscription";
};

export function AnalysisPanel({
  callbackUrl,
  expectedOrigin,
  variant,
}: {
  callbackUrl: string | null;
  expectedOrigin: string | null;
  variant: VariantKey;
}) {
  const [state, setState] = useState<AnalysisState>({ status: "loading" });
  const [browserOrigin, setBrowserOrigin] = useState<string | null>(null);
  const shouldUseFixtureFallback = process.env.NODE_ENV !== "production";

  useEffect(() => {
    setBrowserOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadAnalysis() {
      try {
        const response = await fetch("/api/enable-banking/analysis", {
          cache: "no-store",
          credentials: "include",
        });
        const data = (await response.json()) as SpendingAnalysis | { error?: string };

        if (cancelled) {
          return;
        }

        if (!response.ok) {
          const message =
            "error" in data && typeof data.error === "string"
              ? data.error
              : "Unable to load the action brief.";

          if (shouldUseFixtureFallback && (response.status === 404 || response.status === 503)) {
            setState({
              status: "ready",
              analysis: sampleSpendingAnalysisFixture,
              source: "fixture",
            });
            return;
          }

          if (response.status === 404) {
            setState({ status: "missing", message });
            return;
          }

          setState({ status: "error", message });
          return;
        }

        setState({ status: "ready", analysis: data as SpendingAnalysis, source: "live" });
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (shouldUseFixtureFallback) {
          setState({
            status: "ready",
            analysis: sampleSpendingAnalysisFixture,
            source: "fixture",
          });
          return;
        }

        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Unable to load the action brief.",
        });
      }
    }

    void loadAnalysis();

    return () => {
      cancelled = true;
    };
  }, []);

  const originMismatch =
    Boolean(expectedOrigin) && Boolean(browserOrigin) && expectedOrigin !== browserOrigin;

  if (state.status === "loading") {
    return (
      <section className="grid gap-4">
        <MetricGrid
          metrics={[
            { label: "Session", value: "checking" },
            { label: "Accounts", value: "..." },
            { label: "Primary currency", value: "..." },
            { label: "Analysis", value: "loading" },
          ]}
        />
        <NoticeBlock callbackUrl={callbackUrl} browserOrigin={browserOrigin} expectedOrigin={expectedOrigin} originMismatch={originMismatch} />
        <section className="shell-panel">
          <p className="eyebrow">Loading</p>
          <h2 className="mt-3 font-display text-3xl tracking-[-0.04em] text-[var(--foreground)]">
            Building the live analysis…
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            Pulling the latest session from Enable Banking, separating behavioural spend from wealth flow,
            and shaping the result for the current route.
          </p>
        </section>
      </section>
    );
  }

  if (state.status === "missing") {
    return (
      <section className="grid gap-4">
        <MetricGrid
          metrics={[
            { label: "Session", value: "missing" },
            { label: "Accounts", value: "0" },
            { label: "Primary currency", value: "—" },
            { label: "Analysis", value: "not ready" },
          ]}
        />
        <NoticeBlock callbackUrl={callbackUrl} browserOrigin={browserOrigin} expectedOrigin={expectedOrigin} originMismatch={originMismatch} />
        <section className="shell-panel">
          <p className="eyebrow">No linked session</p>
          <h2 className="mt-3 font-display text-3xl tracking-[-0.04em] text-[var(--foreground)]">
            Connect a bank to generate the comparison views.
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)]">{state.message}</p>
        </section>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="grid gap-4">
        <MetricGrid
          metrics={[
            { label: "Session", value: "error" },
            { label: "Accounts", value: "0" },
            { label: "Primary currency", value: "—" },
            { label: "Analysis", value: "failed" },
          ]}
        />
        <NoticeBlock callbackUrl={callbackUrl} browserOrigin={browserOrigin} expectedOrigin={expectedOrigin} originMismatch={originMismatch} />
        <section className="callout callout-danger">
          <p className="font-semibold text-[var(--foreground)]">Analysis failed</p>
          <p className="mt-2 text-sm leading-6">{state.message}</p>
        </section>
      </section>
    );
  }

  return (
    <ReadyAnalysis
      analysis={state.analysis}
      callbackUrl={callbackUrl}
      browserOrigin={browserOrigin}
      expectedOrigin={expectedOrigin}
      originMismatch={originMismatch}
      source={state.source}
      variant={variant}
    />
  );
}

function ReadyAnalysis({
  analysis,
  callbackUrl,
  browserOrigin,
  expectedOrigin,
  originMismatch,
  source,
  variant,
}: {
  analysis: SpendingAnalysis;
  callbackUrl: string | null;
  browserOrigin: string | null;
  expectedOrigin: string | null;
  originMismatch: boolean;
  source: "fixture" | "live";
  variant: VariantKey;
}) {
  const baseline = analysis.baseline;
  const dominantCurrency = baseline?.currency ?? analysis.currencySummary.primaryCurrency ?? "EUR";
  const leverCoverage = baseline
    ? Math.min(
        1,
        analysis.topLevers.reduce((total, lever) => total + lever.estimatedHalfCutImpact, 0) /
          Math.max(baseline.raiseTarget, 1),
      )
    : 0;
  const filteredTransactions =
    analysis.debugCounts.wealthFlowTransactions +
    analysis.debugCounts.fixedCostTransactions +
    analysis.debugCounts.excludedOneOffTransactions;
  const filteredShare = analysis.debugCounts.totalTransactions
    ? filteredTransactions / analysis.debugCounts.totalTransactions
    : 0;

  const explorerRows = useMemo(
    () =>
      buildExplorerRows(
        analysis.fixedCostContext,
        analysis.topLevers,
        analysis.uncertainSpend,
        dominantCurrency,
      ),
    [analysis.fixedCostContext, analysis.topLevers, analysis.uncertainSpend, dominantCurrency],
  );
  const recurringRows = useMemo(
    () => buildRecurringRows(analysis.habitMerchants, analysis.subscriptions, dominantCurrency),
    [analysis.habitMerchants, analysis.subscriptions, dominantCurrency],
  );

  const metrics = [
    { label: "Session", value: source === "fixture" ? "sample" : "present" },
    { label: "Accounts", value: String(analysis.accountCount) },
    { label: "Primary currency", value: analysis.currencySummary.primaryCurrency ?? "—" },
    { label: "Generated", value: formatGeneratedAt(analysis.generatedAt) },
  ];

  return (
    <section className="grid gap-4">
      <MetricGrid metrics={metrics} />
      <NoticeBlock callbackUrl={callbackUrl} browserOrigin={browserOrigin} expectedOrigin={expectedOrigin} originMismatch={originMismatch} />

      {source === "fixture" ? (
        <section className="callout callout-neutral">
          <span className="font-semibold text-[var(--foreground)]">Sample analysis fixture:</span>{" "}
          using a synthetic, sanitized payload in local development because no live session was available.
        </section>
      ) : null}

      {analysis.currencySummary.otherCurrencies.length > 0 ? (
        <section className="callout callout-neutral">
          <span className="font-semibold text-[var(--foreground)]">Other currencies detected:</span>{" "}
          {analysis.currencySummary.otherCurrencies.join(", ")}
        </section>
      ) : null}

      {variant === "brief" ? (
        <BriefVariant
          analysis={analysis}
          baseline={baseline}
          dominantCurrency={dominantCurrency}
          filteredShare={filteredShare}
          leverCoverage={leverCoverage}
        />
      ) : null}

      {variant === "diagnosis" ? (
        <DiagnosisVariant
          analysis={analysis}
          baseline={baseline}
          dominantCurrency={dominantCurrency}
          filteredShare={filteredShare}
        />
      ) : null}

      {variant === "explorer" ? (
        <ExplorerVariant
          analysis={analysis}
          baseline={baseline}
          dominantCurrency={dominantCurrency}
          explorerRows={explorerRows}
          recurringRows={recurringRows}
        />
      ) : null}
    </section>
  );
}

function BriefVariant({
  analysis,
  baseline,
  dominantCurrency,
  filteredShare,
  leverCoverage,
}: {
  analysis: SpendingAnalysis;
  baseline: SpendingAnalysis["baseline"];
  dominantCurrency: string;
  filteredShare: number;
  leverCoverage: number;
}) {
  const primaryLever = analysis.topLevers[0];
  const secondaryLevers = analysis.topLevers.slice(1, 4);

  return (
    <>
      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <article className="shell-panel space-y-5">
          <div className="space-y-2">
            <p className="eyebrow">Monthly baseline</p>
            <h2 className="font-display text-4xl tracking-[-0.05em] text-[var(--foreground)] sm:text-5xl">
              {baseline
                ? formatCurrency(baseline.discretionaryMonthlySpend, baseline.currency)
                : "No discretionary baseline yet"}
            </h2>
            <p className="max-w-2xl text-sm leading-6 text-[var(--muted)]">
              {baseline
                ? `The model sees ${formatCurrency(baseline.raiseTarget, baseline.currency)} as the 10% raise target. This view compresses the analysis into the shortest path to that number.`
                : "Link a session with behavioural spend in one primary currency to generate the brief."}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard label="Raise target" value={baseline ? formatCurrency(baseline.raiseTarget, baseline.currency) : "—"} />
            <MetricCard label="Top-3 coverage" value={baseline ? formatPercent(leverCoverage) : "0%"} />
            <MetricCard label="Filtered before ranking" value={formatPercent(filteredShare)} />
          </div>

          {primaryLever && baseline ? (
            <article className="spotlight-card">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="eyebrow">Best first lever</p>
                  <h3 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-[var(--foreground)]">
                    {primaryLever.label}
                  </h3>
                  <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--muted)]">
                    {formatCurrency(primaryLever.monthlySpend, baseline.currency)} per month in this category.
                    A clean 50% cut gets back{" "}
                    <span className="font-semibold text-[var(--foreground)]">
                      {formatCurrency(primaryLever.estimatedHalfCutImpact, baseline.currency)}
                    </span>
                    .
                  </p>
                </div>

                <div className="rounded-[1.25rem] bg-white/75 px-4 py-4 text-right ring-1 ring-black/5">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                    Target coverage
                  </p>
                  <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
                    {formatPercent(primaryLever.targetCoverage)}
                  </p>
                </div>
              </div>

              {primaryLever.merchantExamples.length > 0 ? (
                <p className="mt-4 text-sm text-[var(--muted)]">
                  Examples: {primaryLever.merchantExamples.join(", ")}
                </p>
              ) : null}
            </article>
          ) : null}
        </article>

        <aside className="shell-panel">
          <div className="space-y-2">
            <p className="eyebrow">What to audit first</p>
            <h3 className="text-2xl font-semibold tracking-[-0.03em] text-[var(--foreground)]">
              Three high-signal levers
            </h3>
          </div>

          <div className="mt-5 grid gap-3">
            {analysis.topLevers.length === 0 || !baseline ? (
              <EmptyCopy>
                No confident top levers yet. This usually means the latest bank feed is dominated by money
                movement, fixed cost, or unresolved merchant noise.
              </EmptyCopy>
            ) : (
              analysis.topLevers.slice(0, 3).map((lever, index) => (
                <article key={lever.categoryKey} className="list-card">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                        {index === 0 ? "Start here" : `Lever ${index + 1}`}
                      </p>
                      <h4 className="mt-2 text-lg font-semibold text-[var(--foreground)]">{lever.label}</h4>
                    </div>
                    <span className="chip chip-quiet">{formatPercent(lever.targetCoverage)}</span>
                  </div>

                  <div className="progress-track mt-4">
                    <div className="progress-fill" style={{ width: `${Math.min(lever.targetCoverage * 100, 100)}%` }} />
                  </div>

                  <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                    {formatCurrency(lever.monthlySpend, baseline.currency)} per month. Half-cut impact{" "}
                    <span className="font-semibold text-[var(--foreground)]">
                      {formatCurrency(lever.estimatedHalfCutImpact, baseline.currency)}
                    </span>
                    .
                  </p>
                </article>
              ))
            )}
          </div>
        </aside>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <article className="shell-panel">
          <div className="space-y-2">
            <p className="eyebrow">Guardrails</p>
            <h3 className="text-2xl font-semibold tracking-[-0.03em] text-[var(--foreground)]">
              What stays in the background
            </h3>
          </div>

          <div className="mt-5 grid gap-3">
            <CompactList
              emptyMessage="No fixed-cost context detected in the primary currency."
              items={analysis.fixedCostContext.slice(0, 4).map((item) => ({
                key: item.categoryKey,
                label: item.label,
                value: formatCurrency(item.monthlySpend, dominantCurrency),
                detail: item.merchantExamples.join(", "),
              }))}
              title="Fixed costs stay visible but do not get ranked."
            />
            <CompactList
              emptyMessage="No strong subscription candidates yet."
              items={analysis.subscriptions.slice(0, 4).map((item) => ({
                key: item.label,
                label: item.label,
                value: formatCurrency(item.monthlySpend, dominantCurrency),
                detail: `${item.count} recurring hits`,
              }))}
              title="Subscriptions are audit candidates, not automatic cuts."
            />
          </div>
        </article>

        <article className="shell-panel">
          <div className="space-y-2">
            <p className="eyebrow">Why this stays short</p>
            <h3 className="text-2xl font-semibold tracking-[-0.03em] text-[var(--foreground)]">
              The brief is intentionally selective
            </h3>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <MetricCard
              label="Behavioural transactions"
              value={String(analysis.debugCounts.behaviouralTransactions)}
            />
            <MetricCard
              label="Wealth flow excluded"
              value={String(analysis.debugCounts.wealthFlowTransactions)}
            />
            <MetricCard label="Fixed cost excluded" value={String(analysis.debugCounts.fixedCostTransactions)} />
            <MetricCard
              label="One-offs excluded"
              value={String(analysis.debugCounts.excludedOneOffTransactions)}
            />
          </div>

          <div className="mt-5 rounded-[1.25rem] bg-[var(--panel-soft)] px-4 py-4 ring-1 ring-[var(--line)]">
            <p className="text-sm leading-6 text-[var(--muted)]">
              {analysis.uncertainSpend.length > 0
                ? `Uncertain merchants are still shown separately (${analysis.uncertainSpend.length} groups) instead of being quietly folded into confident advice.`
                : "No unresolved merchant groups are currently muddying the brief."}
            </p>
          </div>

          {secondaryLevers.length > 0 ? (
            <div className="mt-5 flex flex-wrap gap-2">
              {secondaryLevers.map((lever) => (
                <span key={lever.categoryKey} className="chip">
                  {lever.label}
                </span>
              ))}
            </div>
          ) : null}
        </article>
      </section>
    </>
  );
}

function DiagnosisVariant({
  analysis,
  baseline,
  dominantCurrency,
  filteredShare,
}: {
  analysis: SpendingAnalysis;
  baseline: SpendingAnalysis["baseline"];
  dominantCurrency: string;
  filteredShare: number;
}) {
  return (
    <>
      <section className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <article className="shell-panel">
          <div className="space-y-2">
            <p className="eyebrow">Model frame</p>
            <h2 className="text-3xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
              Why these levers show up at all
            </h2>
            <p className="text-sm leading-6 text-[var(--muted)]">
              The engine only ranks discretionary behaviour in the dominant currency, keeps fixed cost as
              context, and excludes wealth flow before advice is generated.
            </p>
          </div>

          <div className="mt-5 grid gap-3">
            <LogicCard
              title="Behavioural spend"
              body={`${analysis.debugCounts.behaviouralTransactions} transactions survived the initial filter and fed the baseline.`}
              value={String(analysis.debugCounts.behaviouralTransactions)}
            />
            <LogicCard
              title="Filtered before ranking"
              body={`${formatPercent(filteredShare)} of total transactions were stripped out as wealth flow, fixed cost, or one-offs.`}
              value={String(
                analysis.debugCounts.wealthFlowTransactions +
                  analysis.debugCounts.fixedCostTransactions +
                  analysis.debugCounts.excludedOneOffTransactions,
              )}
            />
            <LogicCard
              title="Uncertainty preserved"
              body={`${analysis.debugCounts.uncertainTransactions} transactions remain visible as ambiguous rather than being forced into precise categories.`}
              value={String(analysis.debugCounts.uncertainTransactions)}
            />
          </div>
        </article>

        <article className="shell-panel">
          <div className="space-y-2">
            <p className="eyebrow">Evidence ledger</p>
            <h3 className="text-3xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
              The ranked output
            </h3>
          </div>

          <div className="mt-5 grid gap-3">
            {analysis.topLevers.length === 0 || !baseline ? (
              <EmptyCopy>
                No confident top levers yet. The current session does not produce enough trusted behavioural
                signal in one primary currency.
              </EmptyCopy>
            ) : (
              analysis.topLevers.map((lever) => (
                <article key={lever.categoryKey} className="evidence-card">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-lg font-semibold text-[var(--foreground)]">{lever.label}</h4>
                        <span className={`chip ${confidenceChipClass(lever.confidence)}`}>
                          {formatConfidence(lever.confidence)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                        {formatCurrency(lever.monthlySpend, baseline.currency)} per month, half-cut impact{" "}
                        {formatCurrency(lever.estimatedHalfCutImpact, baseline.currency)}, controllability{" "}
                        {Math.round(lever.controllabilityScore * 100)}%.
                      </p>
                    </div>
                    <div className="rounded-[1rem] bg-white px-3 py-2 text-right ring-1 ring-black/5">
                      <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Coverage</p>
                      <p className="mt-1 text-xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
                        {formatPercent(lever.targetCoverage)}
                      </p>
                    </div>
                  </div>

                  {lever.merchantExamples.length > 0 ? (
                    <p className="mt-4 text-sm text-[var(--muted)]">
                      Merchant examples: {lever.merchantExamples.join(", ")}
                    </p>
                  ) : null}
                </article>
              ))
            )}
          </div>
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <article className="shell-panel">
          <div className="space-y-2">
            <p className="eyebrow">Excluded on purpose</p>
            <h3 className="text-2xl font-semibold tracking-[-0.03em] text-[var(--foreground)]">
              Context without false advice
            </h3>
          </div>

          <div className="mt-5 grid gap-3">
            <CompactList
              emptyMessage="No fixed-cost context detected in the primary currency."
              items={analysis.fixedCostContext.map((item) => ({
                key: item.categoryKey,
                label: item.label,
                value: formatCurrency(item.monthlySpend, dominantCurrency),
                detail: item.merchantExamples.join(", "),
              }))}
              title="Fixed cost stays visible so the user can understand the whole feed."
            />
            <div className="rounded-[1.25rem] bg-[var(--panel-soft)] px-4 py-4 ring-1 ring-[var(--line)]">
              <p className="text-sm leading-6 text-[var(--muted)]">
                Wealth flow and internal money movement are removed before ranking because they change balances,
                not lifestyle spending pressure.
              </p>
            </div>
          </div>
        </article>

        <article className="shell-panel">
          <div className="space-y-2">
            <p className="eyebrow">Known ambiguity</p>
            <h3 className="text-2xl font-semibold tracking-[-0.03em] text-[var(--foreground)]">
              Where confidence is intentionally low
            </h3>
          </div>

          <div className="mt-5 grid gap-3">
            {analysis.uncertainSpend.length === 0 ? (
              <EmptyCopy>No unresolved merchant groups are currently muddying the result.</EmptyCopy>
            ) : (
              analysis.uncertainSpend.map((item) => (
                <article key={item.label} className="list-card">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h4 className="text-base font-semibold text-[var(--foreground)]">{item.label}</h4>
                      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{item.reason}</p>
                    </div>
                    <span className="chip chip-quiet">{item.transactionCount} hits</span>
                  </div>
                  <p className="mt-3 text-sm text-[var(--muted)]">
                    Monthly value {formatCurrency(item.monthlySpend, dominantCurrency)}
                  </p>
                </article>
              ))
            )}
          </div>
        </article>
      </section>
    </>
  );
}

function ExplorerVariant({
  analysis,
  baseline,
  dominantCurrency,
  explorerRows,
  recurringRows,
}: {
  analysis: SpendingAnalysis;
  baseline: SpendingAnalysis["baseline"];
  dominantCurrency: string;
  explorerRows: ExplorerRow[];
  recurringRows: RecurringRow[];
}) {
  return (
    <>
      <section className="shell-panel">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <p className="eyebrow">Explorer summary</p>
            <h2 className="text-3xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
              Inspect the stack without losing the plot
            </h2>
            <p className="max-w-2xl text-sm leading-6 text-[var(--muted)]">
              This surface keeps the same analysis payload but opens up the category stack, recurring merchant
              patterns, and unresolved ambiguity for inspection.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard
              label="Discretionary baseline"
              value={baseline ? formatCurrency(baseline.discretionaryMonthlySpend, baseline.currency) : "—"}
            />
            <MetricCard label="Recurring groups" value={String(recurringRows.length)} />
            <MetricCard label="Visible stack rows" value={String(explorerRows.length)} />
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr_0.9fr]">
        <article className="shell-panel">
          <div className="space-y-2">
            <p className="eyebrow">Category stack</p>
            <h3 className="text-2xl font-semibold tracking-[-0.03em] text-[var(--foreground)]">
              Ranked signal plus context
            </h3>
          </div>

          <div className="mt-5 grid gap-3">
            {explorerRows.length === 0 ? (
              <EmptyCopy>No category stack available yet for the dominant currency.</EmptyCopy>
            ) : (
              explorerRows.map((row) => (
                <article key={row.key} className="list-card">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-base font-semibold text-[var(--foreground)]">{row.label}</h4>
                        <span className={`chip ${stackKindClass(row.kind)}`}>{formatExplorerKind(row.kind)}</span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{row.detail}</p>
                    </div>
                    <p className="text-sm font-semibold text-[var(--foreground)]">
                      {formatCurrency(row.monthlySpend, dominantCurrency)}
                    </p>
                  </div>
                </article>
              ))
            )}
          </div>
        </article>

        <article className="shell-panel">
          <div className="space-y-2">
            <p className="eyebrow">Recurring merchants</p>
            <h3 className="text-2xl font-semibold tracking-[-0.03em] text-[var(--foreground)]">
              Habits and subscriptions
            </h3>
          </div>

          <div className="mt-5 grid gap-3">
            {recurringRows.length === 0 ? (
              <EmptyCopy>No recurring merchant groups were strong enough to surface.</EmptyCopy>
            ) : (
              recurringRows.map((row) => (
                <article key={row.key} className="list-card">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-base font-semibold text-[var(--foreground)]">{row.label}</h4>
                        <span className={`chip ${row.pattern === "subscription" ? "chip-accent" : "chip-quiet"}`}>
                          {row.pattern === "subscription" ? "subscription" : "habit"}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{row.detail}</p>
                    </div>
                    <p className="text-sm font-semibold text-[var(--foreground)]">
                      {formatCurrency(row.monthlySpend, dominantCurrency)}
                    </p>
                  </div>
                </article>
              ))
            )}
          </div>
        </article>

        <article className="shell-panel">
          <div className="space-y-2">
            <p className="eyebrow">Open questions</p>
            <h3 className="text-2xl font-semibold tracking-[-0.03em] text-[var(--foreground)]">
              Ambiguity still worth reviewing
            </h3>
          </div>

          <div className="mt-5 grid gap-3">
            {analysis.uncertainSpend.length === 0 ? (
              <EmptyCopy>No unresolved merchant groups are currently visible.</EmptyCopy>
            ) : (
              analysis.uncertainSpend.map((item) => (
                <article key={item.label} className="list-card">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h4 className="text-base font-semibold text-[var(--foreground)]">{item.label}</h4>
                      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{item.reason}</p>
                    </div>
                    <span className="chip chip-quiet">{item.transactionCount} hits</span>
                  </div>
                  <p className="mt-3 text-sm text-[var(--muted)]">
                    Monthly value {formatCurrency(item.monthlySpend, dominantCurrency)}
                  </p>
                </article>
              ))
            )}
          </div>
        </article>
      </section>
    </>
  );
}

function NoticeBlock({
  callbackUrl,
  browserOrigin,
  expectedOrigin,
  originMismatch,
}: {
  callbackUrl: string | null;
  browserOrigin: string | null;
  expectedOrigin: string | null;
  originMismatch: boolean;
}) {
  if (!originMismatch) {
    return null;
  }

  return (
    <section className="callout callout-danger">
      <p className="font-semibold text-[var(--foreground)]">Origin mismatch</p>
      <p className="mt-2 text-sm leading-6">
        Open the app on <span className="font-mono text-xs break-all">{expectedOrigin}</span>. The current
        browser origin is <span className="font-mono text-xs break-all">{browserOrigin}</span>.
      </p>
      {callbackUrl ? (
        <p className="mt-2 text-sm leading-6">
          Current callback URL: <span className="font-mono text-xs break-all">{callbackUrl}</span>
        </p>
      ) : null}
    </section>
  );
}

function CompactList({
  emptyMessage,
  items,
  title,
}: {
  emptyMessage: string;
  items: Array<{ detail: string; key: string; label: string; value: string }>;
  title: string;
}) {
  return (
    <section className="rounded-[1.35rem] bg-[var(--panel-soft)] px-4 py-4 ring-1 ring-[var(--line)]">
      <p className="text-sm font-semibold text-[var(--foreground)]">{title}</p>
      {items.length === 0 ? (
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{emptyMessage}</p>
      ) : (
        <div className="mt-4 grid gap-3">
          {items.map((item) => (
            <div key={item.key} className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-[var(--foreground)]">{item.label}</p>
                <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{item.detail || "—"}</p>
              </div>
              <p className="text-sm font-semibold text-[var(--foreground)]">{item.value}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function EmptyCopy({ children }: { children: string }) {
  return <p className="text-sm leading-6 text-[var(--muted)]">{children}</p>;
}

function LogicCard({
  body,
  title,
  value,
}: {
  body: string;
  title: string;
  value: string;
}) {
  return (
    <article className="rounded-[1.25rem] bg-[var(--panel-soft)] px-4 py-4 ring-1 ring-[var(--line)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-[var(--foreground)]">{title}</p>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{body}</p>
        </div>
        <p className="text-2xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">{value}</p>
      </div>
    </article>
  );
}

function MetricGrid({
  metrics,
}: {
  metrics: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {metrics.map((metric) => (
        <MetricCard key={metric.label} label={metric.label} value={metric.value} />
      ))}
    </div>
  );
}

function MetricCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <article className="metric-card">
      <p className="eyebrow">{label}</p>
      <p className="mt-3 text-xl font-semibold tracking-[-0.03em] text-[var(--foreground)]">{value}</p>
    </article>
  );
}

function buildExplorerRows(
  fixedCostContext: FixedCostItem[],
  topLevers: AnalysisLever[],
  uncertainSpend: UncertainSpendItem[],
  currency: string,
): ExplorerRow[] {
  return [
    ...topLevers.map((lever) => ({
      detail: `${formatPercent(lever.targetCoverage)} of target. Examples: ${
        lever.merchantExamples.join(", ") || "none listed"
      }.`,
      key: `lever-${lever.categoryKey}`,
      kind: "lever" as const,
      label: lever.label,
      monthlySpend: lever.monthlySpend,
    })),
    ...fixedCostContext.map((item) => ({
      detail: `Context only. ${item.merchantExamples.join(", ") || "No merchant examples"}.`,
      key: `fixed-${item.categoryKey}`,
      kind: "fixed" as const,
      label: item.label,
      monthlySpend: item.monthlySpend,
    })),
    ...uncertainSpend.map((item) => ({
      detail: `${item.transactionCount} hits. ${item.reason}`,
      key: `uncertain-${item.label}`,
      kind: "uncertain" as const,
      label: item.label,
      monthlySpend: item.monthlySpend,
    })),
  ]
    .filter((row) => row.monthlySpend > 0)
    .sort((left, right) => right.monthlySpend - left.monthlySpend)
    .slice(0, 12)
    .map((row) => ({
      ...row,
      detail:
        row.kind === "fixed"
          ? row.detail
          : row.kind === "uncertain"
            ? row.detail
            : `${row.detail} Monthly value ${formatCurrency(row.monthlySpend, currency)}.`,
    }));
}

function buildRecurringRows(
  habitMerchants: HabitMerchant[],
  subscriptions: SubscriptionAuditItem[],
  currency: string,
): RecurringRow[] {
  return [
    ...habitMerchants.map((habit) => ({
      detail: `${habit.count} recurring hits. Average ${formatCurrency(habit.averageSpend, currency)}.`,
      key: `habit-${habit.label}`,
      label: habit.label,
      monthlySpend: habit.monthlySpend,
      pattern: "habit" as const,
    })),
    ...subscriptions.map((subscription) => ({
      detail: `${subscription.count} recurring hits. Sample amount ${formatCurrency(
        subscription.sampleAmount,
        currency,
      )}.`,
      key: `subscription-${subscription.label}`,
      label: subscription.label,
      monthlySpend: subscription.monthlySpend,
      pattern: "subscription" as const,
    })),
  ]
    .filter((row) => row.monthlySpend > 0)
    .sort((left, right) => right.monthlySpend - left.monthlySpend)
    .slice(0, 12);
}

function confidenceChipClass(confidence: AnalysisLever["confidence"]) {
  if (confidence === "high") {
    return "chip-success";
  }

  if (confidence === "medium") {
    return "chip-accent";
  }

  return "chip-quiet";
}

function stackKindClass(kind: ExplorerRow["kind"]) {
  if (kind === "lever") {
    return "chip-success";
  }

  if (kind === "fixed") {
    return "chip-quiet";
  }

  return "chip-accent";
}

function formatConfidence(confidence: AnalysisLever["confidence"]) {
  if (confidence === "high") {
    return "high confidence";
  }

  if (confidence === "medium") {
    return "medium confidence";
  }

  return "low confidence";
}

function formatExplorerKind(kind: ExplorerRow["kind"]) {
  if (kind === "lever") {
    return "ranked lever";
  }

  if (kind === "fixed") {
    return "fixed context";
  }

  return "ambiguous";
}

function formatCurrency(value: number, currency: string) {
  return new Intl.NumberFormat("en-IE", {
    currency,
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

function formatGeneratedAt(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  return new Intl.DateTimeFormat("en-IE", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(date);
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}
