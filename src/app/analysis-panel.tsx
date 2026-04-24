"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
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
  connectActions,
  debugHref,
  expectedOrigin,
  initialAnalysis,
  initialSource,
  showDiagnostics,
  variant,
}: {
  callbackUrl: string | null;
  connectActions: Array<{
    href: string;
    label: string;
    tone: "primary" | "secondary";
  }>;
  debugHref: string;
  expectedOrigin: string | null;
  initialAnalysis: SpendingAnalysis | null;
  initialSource: "fixture" | "live" | null;
  showDiagnostics: boolean;
  variant: VariantKey;
}) {
  const [state, setState] = useState<AnalysisState>(() =>
    initialAnalysis && initialSource
      ? { status: "ready", analysis: initialAnalysis, source: initialSource }
      : { status: "loading" },
  );
  const [browserOrigin] = useState<string | null>(() =>
    typeof window === "undefined" ? null : window.location.origin,
  );
  const [browserHostname] = useState<string | null>(() =>
    typeof window === "undefined" ? null : window.location.hostname,
  );

  useEffect(() => {
    if (initialAnalysis && initialSource) {
      return;
    }

    let cancelled = false;
    const shouldUseFixtureFallback =
      process.env.NODE_ENV !== "production" || isLocalDevelopmentHost(browserHostname);

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
  }, [browserHostname, initialAnalysis, initialSource]);

  const originMismatch =
    showDiagnostics &&
    Boolean(expectedOrigin) &&
    Boolean(browserOrigin) &&
    expectedOrigin !== browserOrigin;

  if (state.status === "loading") {
    if (!showDiagnostics) {
      return (
        <section className="shell-panel space-y-4">
          <div className="space-y-2">
            <p className="eyebrow">Preparing analysis</p>
            <h2 className="text-3xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
              Pulling the latest spending picture
            </h2>
            <p className="text-sm leading-6 text-[var(--muted)]">
              Separating discretionary behaviour from wealth flow and fixed cost so the recommendation
              can stay narrow.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <span className="chip chip-quiet">Checking session</span>
            <span className="chip chip-quiet">Building categories</span>
            <span className="chip chip-quiet">Ranking levers</span>
          </div>
        </section>
      );
    }

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
    if (!showDiagnostics) {
      return (
        <section className="shell-panel space-y-5">
          <div className="space-y-2">
            <p className="eyebrow">Connect account</p>
            <h2 className="text-3xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
              Start with a live bank feed
            </h2>
            <p className="text-sm leading-6 text-[var(--muted)]">{state.message}</p>
          </div>

          <div className="flex flex-wrap gap-3">
            {connectActions.map((action) => (
              <a
                key={action.label}
                className={action.tone === "primary" ? "button button-primary" : "button button-secondary"}
                href={action.href}
              >
                {action.label}
              </a>
            ))}
            <Link className="button button-secondary" href={debugHref}>
              Open debug tools
            </Link>
          </div>
        </section>
      );
    }

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
    if (!showDiagnostics) {
      return (
        <section className="shell-panel space-y-5">
          <div className="space-y-2">
            <p className="eyebrow">Analysis unavailable</p>
            <h2 className="text-3xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
              The spending model could not load
            </h2>
            <p className="text-sm leading-6 text-[var(--muted)]">{state.message}</p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link className="button button-primary" href={debugHref}>
              Open debug tools
            </Link>
            {connectActions.map((action) => (
              <a
                key={action.label}
                className="button button-secondary"
                href={action.href}
              >
                {action.label}
              </a>
            ))}
          </div>
        </section>
      );
    }

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
      showDiagnostics={showDiagnostics}
      source={state.source}
      variant={variant}
    />
  );
}

function isLocalDevelopmentHost(hostname: string | null) {
  if (!hostname) {
    return false;
  }

  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".local")
  );
}

function ReadyAnalysis({
  analysis,
  callbackUrl,
  browserOrigin,
  expectedOrigin,
  originMismatch,
  showDiagnostics,
  source,
  variant,
}: {
  analysis: SpendingAnalysis;
  callbackUrl: string | null;
  browserOrigin: string | null;
  expectedOrigin: string | null;
  originMismatch: boolean;
  showDiagnostics: boolean;
  source: "fixture" | "live";
  variant: VariantKey;
}) {
  const baseline = analysis.baseline;
  const dominantCurrency = baseline?.currency ?? analysis.currencySummary.primaryCurrency ?? "EUR";
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
      {showDiagnostics ? <MetricGrid metrics={metrics} /> : null}
      {showDiagnostics ? (
        <NoticeBlock
          callbackUrl={callbackUrl}
          browserOrigin={browserOrigin}
          expectedOrigin={expectedOrigin}
          originMismatch={originMismatch}
        />
      ) : null}
      {showDiagnostics && source === "fixture" ? (
        <section className="callout callout-neutral">
          <span className="font-semibold text-[var(--foreground)]">Sample analysis fixture:</span>{" "}
          using a synthetic, sanitized payload in local development because no live session was available.
        </section>
      ) : null}
      {showDiagnostics && analysis.currencySummary.otherCurrencies.length > 0 ? (
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
          source={source}
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
  source,
}: {
  analysis: SpendingAnalysis;
  baseline: SpendingAnalysis["baseline"];
  dominantCurrency: string;
  filteredShare: number;
  source: "fixture" | "live";
}) {
  const defaultTargetPercentage = baseline ? Math.round(baseline.targetPercentage * 100) : 10;
  const [targetPercentage, setTargetPercentage] = useState(defaultTargetPercentage);
  const [activeLeverIndex, setActiveLeverIndex] = useState(0);

  const activeTargetAmount = baseline
    ? Math.max(25, roundCurrency((baseline.discretionaryMonthlySpend * targetPercentage) / 100))
    : 0;
  const activeTargetPercentage = baseline ? Math.max(1, targetPercentage) : 0;
  const retargetedLevers = baseline
    ? analysis.topLevers.map((lever) => ({
        ...lever,
        targetCoverage: lever.estimatedHalfCutImpact / Math.max(activeTargetAmount, 1),
      }))
    : analysis.topLevers;
  const primaryLever = retargetedLevers[0];
  const actionLevers = retargetedLevers.slice(0, 4);
  const activeLever = actionLevers[activeLeverIndex] ?? actionLevers[0];
  const strongestImpact = Math.max(
    ...actionLevers.map((lever) => lever.estimatedHalfCutImpact),
    1,
  );
  const totalRecoverable = retargetedLevers.reduce(
    (total, lever) => total + lever.estimatedHalfCutImpact,
    0,
  );
  const totalCoverage = activeTargetAmount
    ? Math.min(1, totalRecoverable / activeTargetAmount)
    : 0;
  const targetPresets = [5, 10, 15];

  return (
    <>
      <section className="brief-mobile-stack">
        <article className="shell-panel brief-hero-panel brief-focus-panel">
          {primaryLever && baseline && activeLever ? (
            <>
              <div className="brief-focus-meta">
                <span className={`chip ${source === "fixture" ? "chip-accent" : "chip-success"}`}>
                  {source === "fixture" ? "Sample" : "Live"}
                </span>
                <span className="dashboard-inline-note">
                  {formatCurrency(baseline.discretionaryMonthlySpend, baseline.currency)} monthly spend
                </span>
              </div>

              <div className="brief-target-core">
                <p className="eyebrow">Target</p>
                <div className="brief-target-row">
                  <h2 className="brief-target-amount">{formatCurrency(activeTargetAmount, baseline.currency)}</h2>
                  <span className="brief-target-percent">{activeTargetPercentage}%</span>
                </div>
                <p className="brief-signal-copy">
                  {formatPercent(totalCoverage)} covered by current signals.
                </p>
              </div>

              <div className="brief-target-presets" aria-label="Target percentage">
                {targetPresets.map((preset) => (
                  <button
                    key={preset}
                    className="target-preset"
                    data-active={preset === activeTargetPercentage}
                    onClick={() => setTargetPercentage(preset)}
                    type="button"
                  >
                    {preset}%
                  </button>
                ))}
              </div>
            </>
          ) : (
            <EmptyCopy>
              No confident top levers yet. This usually means the latest bank feed is dominated by money
              movement, fixed cost, or unresolved merchant noise.
            </EmptyCopy>
          )}
        </article>
      </section>

      <section className="brief-bubble-zone">
        <div className="brief-section-heading brief-bubble-heading">
          <div>
            <p className="eyebrow">Signals</p>
            <h3 className="brief-section-title">{activeLever?.label ?? "Spending"}</h3>
          </div>
          {activeLever && baseline ? (
            <p className="brief-section-value">
              {formatCurrency(activeLever.estimatedHalfCutImpact, baseline.currency)}
            </p>
          ) : null}
        </div>

        {actionLevers.length === 0 || !baseline ? (
          <section className="shell-panel">
            <EmptyCopy>No confident follow-up levers yet. The current session is still too noisy.</EmptyCopy>
          </section>
        ) : (
          <>
            <div aria-label="Spending signals" className="brief-bubble-field">
              {actionLevers.map((lever, index) => (
                <button
                  key={lever.categoryKey}
                  className="brief-impact-bubble"
                  data-active={index === activeLeverIndex}
                  onClick={() => setActiveLeverIndex(index)}
                  style={
                    {
                      "--bubble-fill": `${Math.min(100, Math.round(lever.targetCoverage * 100))}%`,
                      "--bubble-size": `${7.8 + (lever.estimatedHalfCutImpact / strongestImpact) * 3.4}rem`,
                    } as CSSProperties
                  }
                  type="button"
                >
                  <span className="brief-bubble-label">{lever.label}</span>
                  <span className="brief-bubble-value">
                    {formatCurrency(lever.estimatedHalfCutImpact, baseline.currency)}
                  </span>
                  <span className="brief-bubble-percent">{formatPercent(lever.targetCoverage)}</span>
                </button>
              ))}
            </div>

            {activeLever ? (
              <p className="brief-active-hint">
                {activeLever.merchantExamples.slice(0, 3).join(" / ")}
              </p>
            ) : null}
          </>
        )}
      </section>

      <section className="shell-panel brief-details-panel">
        <details className="brief-details">
          <summary className="brief-details-summary">
            <span>How this brief works</span>
            <span className="brief-details-meta">
              {formatCurrency(baseline?.discretionaryMonthlySpend ?? 0, baseline?.currency ?? dominantCurrency)} baseline
            </span>
          </summary>

          <div className="brief-details-body">
            <p className="text-sm leading-6 text-[var(--muted)]">
              The dashboard only ranks discretionary behaviour in the dominant currency, excludes wealth flow
              before advice, and keeps ambiguity visible instead of pretending uncertain merchants are precise.
            </p>

            <div className="brief-details-grid">
              <div>
                <p className="eyebrow">Filtered before ranking</p>
                <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
                  {formatPercent(filteredShare)}
                </p>
              </div>
              <div>
                <p className="eyebrow">Wealth flow excluded</p>
                <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
                  {analysis.debugCounts.wealthFlowTransactions}
                </p>
              </div>
              <div>
                <p className="eyebrow">Fixed cost excluded</p>
                <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
                  {analysis.debugCounts.fixedCostTransactions}
                </p>
              </div>
              <div>
                <p className="eyebrow">Ambiguous groups</p>
                <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
                  {analysis.uncertainSpend.length}
                </p>
              </div>
            </div>

            <CompactList
              emptyMessage="No strong recurring patterns surfaced."
              items={[...analysis.subscriptions.slice(0, 2), ...analysis.habitMerchants.slice(0, 2)].map((item) => ({
                key: item.label,
                label: item.label,
                value: formatCurrency(item.monthlySpend, dominantCurrency),
                detail: `${item.count} recurring hits`,
              }))}
              title="Recurring patterns that influenced the ranking."
            />

            <CompactList
              emptyMessage="No fixed-cost context detected in the primary currency."
              items={analysis.fixedCostContext.slice(0, 4).map((item) => ({
                key: item.categoryKey,
                label: item.label,
                value: formatCurrency(item.monthlySpend, dominantCurrency),
                detail: item.merchantExamples.join(", "),
              }))}
              title="Fixed costs stay visible as context but do not get ranked."
            />
          </div>
        </details>
      </section>
    </>
  );
}

function roundCurrency(value: number) {
  return Math.round(value);
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
