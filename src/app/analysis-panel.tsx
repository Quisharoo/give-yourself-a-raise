"use client";

import { useEffect, useMemo, useState } from "react";

import { sampleSpendingAnalysisFixture } from "@/lib/analysis/fixtures";
import {
  getActionCountToHitTarget,
  getDominantCurrency,
  getFilteredTransactionShare,
} from "@/lib/analysis/presentation";
import type { HabitMerchant, SpendingAnalysis, SubscriptionAuditItem } from "@/lib/analysis/types";
import type { EnableBankingAspsp, EnableBankingPsuType } from "@/lib/enable-banking/types";

type AnalysisState =
  | { status: "loading" }
  | { status: "missing"; message: string }
  | { status: "error"; message: string }
  | { status: "ready"; analysis: SpendingAnalysis; source: "fixture" | "live" };

type RecurringRow = {
  detail: string;
  key: string;
  label: string;
  monthlySpend: number;
  pattern: "habit" | "subscription";
};

type BankCountry = {
  code: string;
  label: string;
};

export function AnalysisPanel({
  bankCountries,
  callbackUrl,
  expectedOrigin,
  initialAnalysis,
  initialSource,
}: {
  bankCountries: BankCountry[];
  callbackUrl: string | null;
  expectedOrigin: string | null;
  initialAnalysis: SpendingAnalysis | null;
  initialSource: "fixture" | "live" | null;
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
    Boolean(expectedOrigin) &&
    Boolean(browserOrigin) &&
    expectedOrigin !== browserOrigin;

  if (state.status === "loading") {
    return <LoadingExperience />;
  }

  if (state.status === "missing") {
    return (
      <LandingExperience
        bankCountries={bankCountries}
        callbackUrl={callbackUrl}
        browserOrigin={browserOrigin}
        expectedOrigin={expectedOrigin}
        message={state.message}
        originMismatch={originMismatch}
      />
    );
  }

  if (state.status === "error") {
    return (
      <ErrorExperience
        bankCountries={bankCountries}
        expectedOrigin={expectedOrigin}
        message={state.message}
      />
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
    />
  );
}

function LandingExperience({
  bankCountries,
  browserOrigin,
  callbackUrl,
  expectedOrigin,
  message,
  originMismatch,
}: {
  bankCountries: BankCountry[];
  browserOrigin: string | null;
  callbackUrl: string | null;
  expectedOrigin: string | null;
  message: string;
  originMismatch: boolean;
}) {
  return (
    <section className="app-stack">
      {originMismatch ? (
        <NoticeBlock
          callbackUrl={callbackUrl}
          browserOrigin={browserOrigin}
          expectedOrigin={expectedOrigin}
        />
      ) : null}

      <section className="hero-grid">
        <article className="shell-panel thesis-hero">
          <div className="hero-copy">
            <p className="eyebrow">Private financial brief</p>
            <h1 className="hero-title">
              Find a real 10% raise in spending power without pretending the whole budget is negotiable.
            </h1>
            <p className="hero-body">
              This is not a budgeting dashboard. It strips out wealth flow, fixed costs, and low-confidence
              merchant noise so the output stays narrow, inspectable, and worth acting on.
            </p>
          </div>

          <BankPicker
            countries={bankCountries}
            expectedOrigin={expectedOrigin}
          />

          <div className="hero-footnote">
            <span className="hero-footnote-line" />
            <p>{message}</p>
          </div>
        </article>

        <aside className="shell-panel belief-rail">
          <div className="rail-section">
            <p className="eyebrow">How the model keeps its nerve</p>
            <div className="rule-list">
              <RuleRow
                title="Wealth flow stays out"
                body="Savings transfers, FX, and internal money movement are excluded before ranking."
              />
              <RuleRow
                title="Fixed costs stay visible"
                body="Housing, utilities, and fees remain context, not fake cut opportunities."
              />
              <RuleRow
                title="Ambiguity stays explicit"
                body="Unclear merchant groups remain broad instead of being over-classified."
              />
            </div>
          </div>

          <div className="rail-section rail-section-tinted">
            <p className="eyebrow">What you get after connect</p>
            <ul className="check-list">
              <li>One ranked starting action</li>
              <li>Follow-up levers sized by realistic recovery</li>
              <li>Proof of what was excluded and why</li>
            </ul>
          </div>
        </aside>
      </section>

      <section className="editorial-band">
        <div className="band-copy">
          <p className="eyebrow">Product thesis</p>
          <p className="band-text">
            The right outcome is not a perfect category tree. The right outcome is a short list of
            discretionary moves that could realistically free up monthly spending power.
          </p>
        </div>
      </section>
    </section>
  );
}

function LoadingExperience() {
  return (
    <section className="app-stack">
      <section className="hero-grid">
        <article className="shell-panel thesis-hero">
          <div className="hero-copy">
            <div className="skeleton skeleton-chip" />
            <div className="skeleton skeleton-title" />
            <div className="skeleton skeleton-title skeleton-title-short" />
            <div className="skeleton skeleton-body" />
            <div className="skeleton skeleton-body skeleton-body-short" />
          </div>
          <div className="hero-cta-row">
            <div className="skeleton skeleton-button" />
            <div className="skeleton skeleton-button skeleton-button-ghost" />
          </div>
        </article>

        <aside className="shell-panel belief-rail">
          <div className="skeleton skeleton-chip" />
          <div className="skeleton skeleton-rule" />
          <div className="skeleton skeleton-rule" />
          <div className="skeleton skeleton-rule" />
          <div className="skeleton skeleton-panel" />
        </aside>
      </section>

      <section className="recommendation-grid">
        <article className="shell-panel recommendation-hero">
          <div className="skeleton skeleton-chip" />
          <div className="skeleton skeleton-metric" />
          <div className="skeleton skeleton-body" />
          <div className="skeleton skeleton-controls" />
          <div className="skeleton skeleton-primary" />
        </article>

        <section className="action-stack">
          <div className="skeleton skeleton-action" />
          <div className="skeleton skeleton-action" />
          <div className="skeleton skeleton-action" />
        </section>
      </section>

      <section className="proof-grid">
        <div className="shell-panel proof-panel">
          <div className="skeleton skeleton-proof-header" />
          <div className="skeleton skeleton-proof-grid" />
        </div>
        <div className="shell-panel proof-panel">
          <div className="skeleton skeleton-proof-header" />
          <div className="skeleton skeleton-list" />
        </div>
      </section>
    </section>
  );
}

function ErrorExperience({
  bankCountries,
  expectedOrigin,
  message,
}: {
  bankCountries: BankCountry[];
  expectedOrigin: string | null;
  message: string;
}) {
  return (
    <section className="app-stack">
      <article className="shell-panel error-stage">
        <div className="hero-copy">
          <p className="eyebrow">Analysis unavailable</p>
          <h2 className="hero-title hero-title-compact">The spending brief could not be built.</h2>
          <p className="hero-body">{message}</p>
        </div>

        <BankPicker
          countries={bankCountries}
          expectedOrigin={expectedOrigin}
        />
      </article>
    </section>
  );
}

function ReadyAnalysis({
  analysis,
  browserOrigin,
  callbackUrl,
  expectedOrigin,
  originMismatch,
  source,
}: {
  analysis: SpendingAnalysis;
  browserOrigin: string | null;
  callbackUrl: string | null;
  expectedOrigin: string | null;
  originMismatch: boolean;
  source: "fixture" | "live";
}) {
  const baseline = analysis.baseline;
  const dominantCurrency = getDominantCurrency(analysis);
  const filteredShare = getFilteredTransactionShare(analysis.debugCounts);
  const recurringRows = useMemo(
    () => buildRecurringRows(analysis.habitMerchants, analysis.subscriptions, dominantCurrency),
    [analysis.habitMerchants, analysis.subscriptions, dominantCurrency],
  );
  const defaultTargetPercentage = baseline ? Math.round(baseline.targetPercentage * 100) : 10;
  const defaultTargetAmount = baseline ? Math.round(baseline.raiseTarget) : 250;
  const [targetMode, setTargetMode] = useState<"amount" | "percentage">("percentage");
  const [targetPercentage, setTargetPercentage] = useState(defaultTargetPercentage);
  const [targetAmount, setTargetAmount] = useState(defaultTargetAmount);

  const activeTargetAmount = baseline
    ? targetMode === "percentage"
      ? Math.max(25, roundCurrency((baseline.discretionaryMonthlySpend * targetPercentage) / 100))
      : Math.max(25, roundCurrency(targetAmount))
    : 0;
  const activeTargetPercentage = baseline
    ? targetMode === "amount"
      ? Math.max(1, Math.round((activeTargetAmount / baseline.discretionaryMonthlySpend) * 100))
      : Math.max(1, targetPercentage)
    : 0;
  const retargetedLevers = baseline
    ? analysis.topLevers.map((lever) => ({
        ...lever,
        targetCoverage: lever.estimatedHalfCutImpact / Math.max(activeTargetAmount, 1),
      }))
    : analysis.topLevers;
  const primaryLever = retargetedLevers[0];
  const secondaryLevers = retargetedLevers.slice(1, 5);
  const totalRecoverable = retargetedLevers.reduce(
    (total, lever) => total + lever.estimatedHalfCutImpact,
    0,
  );
  const totalCoverage = activeTargetAmount
    ? Math.min(1, totalRecoverable / activeTargetAmount)
    : 0;
  const actionCountToHitTarget = getActionCountToHitTarget(retargetedLevers, activeTargetAmount);
  const targetPresets =
    targetMode === "percentage"
      ? [5, 10, 15]
      : [0.5, 1, 1.5].map((multiplier) => roundCurrency(defaultTargetAmount * multiplier));

  return (
    <section className="app-stack">
      {originMismatch ? (
        <NoticeBlock
          callbackUrl={callbackUrl}
          browserOrigin={browserOrigin}
          expectedOrigin={expectedOrigin}
        />
      ) : null}

      {source === "fixture" ? (
        <section className="callout callout-neutral">
          Sample mode is active because there is no live bank session in this environment yet.
        </section>
      ) : null}

      <section className="hero-grid">
        <article className="shell-panel thesis-hero thesis-hero-live">
          <div className="hero-copy">
            <div className="brief-meta-row">
              <span className={`chip ${source === "fixture" ? "chip-accent" : "chip-success"}`}>
                {source === "fixture" ? "Sample analysis" : "Live analysis"}
              </span>
              <span className="dashboard-inline-note">
                Generated {formatGeneratedAt(analysis.generatedAt)}
              </span>
            </div>

            <p className="eyebrow">Monthly raise target</p>
            <h1 className="hero-title hero-title-live">
              {formatCurrency(activeTargetAmount, baseline?.currency ?? dominantCurrency)}
            </h1>
            <p className="hero-body">
              {primaryLever && baseline
                ? `${primaryLever.label} is the clearest place to start. The current top levers cover ${formatPercent(
                    totalCoverage,
                  )} of the target without leaning on housing, utilities, or money movement.`
                : "The current session is present, but it does not yet contain a strong enough discretionary signal to rank a confident starting move."}
            </p>
          </div>

          {baseline ? (
            <div className="brief-control-row">
              <div className="target-mode-strip">
                <button
                  className="target-mode-button"
                  data-active={targetMode === "percentage"}
                  onClick={() => setTargetMode("percentage")}
                  type="button"
                >
                  Percent
                </button>
                <button
                  className="target-mode-button"
                  data-active={targetMode === "amount"}
                  onClick={() => setTargetMode("amount")}
                  type="button"
                >
                  Cash
                </button>
              </div>

              <label className="target-field">
                <span className="sr-only">
                  {targetMode === "percentage" ? "Percent target" : "Cash target"}
                </span>
                <div className="target-input-wrap">
                  <span className="target-prefix">
                    {targetMode === "percentage" ? "%" : baseline.currency}
                  </span>
                  <input
                    aria-label={targetMode === "percentage" ? "Percent target" : "Cash target"}
                    className="target-input"
                    inputMode="decimal"
                    onChange={(event) => {
                      const parsed = Number(event.target.value.replace(/[^\d.]/g, ""));

                      if (!Number.isFinite(parsed)) {
                        return;
                      }

                      if (targetMode === "percentage") {
                        setTargetPercentage(clamp(Math.round(parsed), 1, 50));
                        return;
                      }

                      setTargetAmount(clamp(roundCurrency(parsed), 25, 5000));
                    }}
                    type="text"
                    value={
                      targetMode === "percentage"
                        ? String(activeTargetPercentage)
                        : String(activeTargetAmount)
                    }
                  />
                </div>
              </label>

              <div className="target-preset-row">
                {targetPresets.map((preset) => (
                  <button
                    key={preset}
                    className="target-preset"
                    data-active={
                      targetMode === "percentage"
                        ? preset === activeTargetPercentage
                        : preset === activeTargetAmount
                    }
                    onClick={() => {
                      if (targetMode === "percentage") {
                        setTargetPercentage(preset);
                        return;
                      }

                      setTargetAmount(preset);
                    }}
                    type="button"
                  >
                    {targetMode === "percentage"
                      ? `${preset}%`
                      : formatCurrency(preset, baseline.currency)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </article>

        <aside className="shell-panel belief-rail belief-rail-live">
          <div className="rail-stat">
            <p className="eyebrow">Discretionary baseline</p>
            <p className="rail-value">
              {baseline ? formatCurrency(baseline.discretionaryMonthlySpend, baseline.currency) : "—"}
            </p>
          </div>
          <div className="rail-stat">
            <p className="eyebrow">Actions to hit target</p>
            <p className="rail-value">{actionCountToHitTarget || "—"}</p>
          </div>
          <div className="rail-stat">
            <p className="eyebrow">Filtered before ranking</p>
            <p className="rail-value">{formatPercent(filteredShare)}</p>
          </div>
          <div className="rail-section rail-section-tinted">
            <p className="eyebrow">Current stack</p>
            <p className="rail-copy">
              {retargetedLevers.length > 0
                ? `${retargetedLevers.length} ranked levers survived the model boundaries in ${dominantCurrency}.`
                : `No ranked levers surfaced in ${dominantCurrency} yet.`}
            </p>
          </div>
        </aside>
      </section>

      <section className="recommendation-grid">
        <article className="shell-panel recommendation-hero">
          <div className="space-y-3">
            <p className="eyebrow">Start here</p>
            {primaryLever && baseline ? (
              <>
                <div className="feature-header">
                  <h2 className="feature-title">{primaryLever.label}</h2>
                  <p className="action-amount action-amount-small">
                    {formatCurrency(primaryLever.estimatedHalfCutImpact, baseline.currency)}
                  </p>
                </div>
                <p className="hero-body">
                  {formatCurrency(primaryLever.monthlySpend, baseline.currency)} each month. Covers{" "}
                  {formatPercent(primaryLever.targetCoverage)} of the current target. Merchant examples:{" "}
                  {primaryLever.merchantExamples.join(", ")}.
                </p>
              </>
            ) : (
              <EmptyCopy>
                No confident top lever surfaced. The feed is still dominated by excluded flows or unresolved
                merchant noise.
              </EmptyCopy>
            )}
          </div>
        </article>

        <section className="action-stack">
          <div className="section-heading">
            <p className="eyebrow">Follow-up actions</p>
            <p className="section-copy">
              Ranked by realistic monthly recovery, not by forcing every transaction into a budgeting ritual.
            </p>
          </div>

          {secondaryLevers.length === 0 || !baseline ? (
            <article className="shell-panel">
              <EmptyCopy>No confident follow-up actions are ready yet.</EmptyCopy>
            </article>
          ) : (
            secondaryLevers.map((lever, index) => (
              <article key={lever.categoryKey} className="shell-panel action-row">
                <div className="action-row-index">0{index + 2}</div>
                <div className="action-row-copy">
                  <h3 className="action-row-title">{lever.label}</h3>
                  <p className="action-row-body">
                    {formatCurrency(lever.monthlySpend, baseline.currency)} each month. Examples:{" "}
                    {lever.merchantExamples.join(", ")}.
                  </p>
                </div>
                <div className="action-row-value">
                  <p className="action-row-amount">
                    {formatCurrency(lever.estimatedHalfCutImpact, baseline.currency)}
                  </p>
                  <p className="action-row-coverage">{formatPercent(lever.targetCoverage)}</p>
                </div>
              </article>
            ))
          )}
        </section>
      </section>

      <section className="proof-grid">
        <article className="shell-panel proof-panel proof-panel-wide">
          <div className="section-heading">
            <p className="eyebrow">Model boundaries</p>
            <h3 className="proof-title">What the brief refuses to count as advice.</h3>
          </div>

          <div className="boundary-grid">
            <BoundaryStat
              label="Wealth flow"
              value={String(analysis.debugCounts.wealthFlowTransactions)}
            />
            <BoundaryStat
              label="Fixed cost"
              value={String(analysis.debugCounts.fixedCostTransactions)}
            />
            <BoundaryStat
              label="One-off spend"
              value={String(analysis.debugCounts.excludedOneOffTransactions)}
            />
            <BoundaryStat
              label="Ambiguous groups"
              value={String(analysis.uncertainSpend.length)}
            />
          </div>

          <div className="proof-columns">
            <CompactList
              emptyMessage="No fixed-cost context detected in the primary currency."
              items={analysis.fixedCostContext.slice(0, 4).map((item) => ({
                key: item.categoryKey,
                label: item.label,
                value: formatCurrency(item.monthlySpend, dominantCurrency),
                detail: item.merchantExamples.join(", "),
              }))}
              title="Fixed costs remain visible as context."
            />

            <article className="proof-note">
              <p className="proof-note-text">
                The app is opinionated on purpose: balances can move for reasons that have nothing to do with
                lifestyle pressure. That is why transfers and fixed obligations are visible but unranked.
              </p>
            </article>
          </div>
        </article>

        <article className="shell-panel proof-panel">
          <div className="section-heading">
            <p className="eyebrow">Recurring pressure</p>
            <h3 className="proof-title">Patterns that shaped the recommendation.</h3>
          </div>

          {recurringRows.length === 0 ? (
            <EmptyCopy>No recurring merchant groups were strong enough to surface.</EmptyCopy>
          ) : (
            <div className="recurring-stack">
              {recurringRows.slice(0, 8).map((row) => (
                <article key={row.key} className="recurring-row">
                  <div>
                    <div className="recurring-label-row">
                      <h4 className="recurring-title">{row.label}</h4>
                      <span
                        className={`chip ${row.pattern === "subscription" ? "chip-accent" : "chip-quiet"}`}
                      >
                        {row.pattern === "subscription" ? "subscription" : "habit"}
                      </span>
                    </div>
                    <p className="recurring-body">{row.detail}</p>
                  </div>
                  <p className="recurring-value">{formatCurrency(row.monthlySpend, dominantCurrency)}</p>
                </article>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className="proof-grid">
        <ExpandablePanel
          meta={`${analysis.uncertainSpend.length} groups`}
          title="Open questions and uncertainty"
        >
          {analysis.uncertainSpend.length === 0 ? (
            <EmptyCopy>No unresolved merchant groups are currently muddying the result.</EmptyCopy>
          ) : (
            <div className="disclosure-stack">
              {analysis.uncertainSpend.map((item) => (
                <DisclosureRow
                  key={item.label}
                  detail={item.reason}
                  label={item.label}
                  meta={`${item.transactionCount} hits`}
                  value={formatCurrency(item.monthlySpend, dominantCurrency)}
                />
              ))}
            </div>
          )}
        </ExpandablePanel>

        <ExpandablePanel
          meta={`${analysis.accountCount} accounts`}
          title="Connection and evidence"
        >
          <div className="disclosure-stack">
            <DisclosureRow
              detail="The current analysis payload was generated from the linked bank session."
              label="Session source"
              meta={source === "fixture" ? "sample" : "live"}
              value={analysis.currencySummary.primaryCurrency ?? "—"}
            />
            <DisclosureRow
              detail="Reconnect if you want to refresh the output after new transactions post."
              label="Refresh path"
              meta="manual reconnect"
              value="Bank picker"
            />
          </div>
        </ExpandablePanel>
      </section>
    </section>
  );
}

function BankPicker({
  countries,
  expectedOrigin,
}: {
  countries: BankCountry[];
  expectedOrigin: string | null;
}) {
  const [country, setCountry] = useState(countries[0]?.code ?? "IE");
  const [query, setQuery] = useState("");
  const [banks, setBanks] = useState<EnableBankingAspsp[]>([]);
  const [selectedBank, setSelectedBank] = useState<EnableBankingAspsp | null>(null);
  const [psuType, setPsuType] = useState<EnableBankingPsuType>("personal");
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [message, setMessage] = useState("Loading supported banks.");

  useEffect(() => {
    const controller = new AbortController();
    const searchParams = new URLSearchParams({ country });
    const trimmedQuery = query.trim();

    if (trimmedQuery) {
      searchParams.set("query", trimmedQuery);
    }

    async function loadBanks() {
      try {
        const response = await fetch(`/api/enable-banking/aspsps?${searchParams.toString()}`, {
          cache: "no-store",
          credentials: "include",
          signal: controller.signal,
        });
        const data = (await response.json()) as {
          aspsps?: EnableBankingAspsp[];
          error?: string;
        };

        if (!response.ok) {
          setBanks([]);
          setSelectedBank(null);
          setStatus("error");
          setMessage(data.error ?? "Unable to load supported banks.");
          return;
        }

        const nextBanks = data.aspsps ?? [];
        setBanks(nextBanks);
        setSelectedBank((current) =>
          current && nextBanks.some((bank) => isSameBank(bank, current)) ? current : null,
        );

        if (nextBanks.length === 0) {
          setStatus("empty");
          setMessage(trimmedQuery ? "No matching banks found." : "No supported banks found for this country.");
          return;
        }

        setStatus("ready");
        setMessage(`${nextBanks.length} supported banks found.`);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setBanks([]);
        setSelectedBank(null);
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "Unable to load supported banks.");
      }
    }

    void loadBanks();

    return () => {
      controller.abort();
    };
  }, [country, query]);

  const visibleBanks = banks.slice(0, 8);
  const selectedPsuTypes = selectedBank ? getPsuTypes(selectedBank) : [];
  const connectHref = selectedBank
    ? buildConnectHref(expectedOrigin, selectedBank, psuType)
    : null;

  return (
    <div className="bank-picker" aria-label="Bank connection picker">
      <div className="bank-picker-controls">
        <label className="bank-field">
          <span>Country</span>
          <select
            className="bank-select"
            onChange={(event) => {
              setCountry(event.target.value);
              setSelectedBank(null);
              setPsuType("personal");
              setQuery("");
              setStatus("loading");
              setMessage("Loading supported banks.");
            }}
            value={country}
          >
            {countries.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="bank-field bank-field-search">
          <span>Bank</span>
          <input
            className="bank-search"
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedBank(null);
              setStatus("loading");
              setMessage("Loading supported banks.");
            }}
            placeholder="Search by bank name"
            type="search"
            value={query}
          />
        </label>
      </div>

      <div className="bank-result-list" aria-busy={status === "loading"}>
        {status === "loading" ? (
          <BankPickerMessage message={message} />
        ) : null}

        {status === "error" || status === "empty" ? (
          <BankPickerMessage message={message} />
        ) : null}

        {status === "ready"
          ? visibleBanks.map((bank) => (
              <button
                key={`${bank.country}-${bank.name}`}
                className="bank-result"
                data-selected={selectedBank ? isSameBank(bank, selectedBank) : false}
                onClick={() => {
                  setSelectedBank(bank);
                  setPsuType(getPsuTypes(bank)[0] ?? "personal");
                  setQuery(bank.name);
                }}
                type="button"
              >
                <span className="bank-result-logo" aria-hidden="true">
                  {bank.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="bank-result-copy">
                  <span className="bank-result-name">{bank.name}</span>
                  <span className="bank-result-meta">
                    {bank.country}
                    {bank.maximum_consent_validity
                      ? ` · consent up to ${bank.maximum_consent_validity} days`
                      : ""}
                    {bank.beta ? " · beta" : ""}
                  </span>
                </span>
              </button>
            ))
          : null}
      </div>

      {selectedPsuTypes.length > 1 ? (
        <div className="bank-psu-strip" aria-label="Account type">
          {selectedPsuTypes.map((option) => (
            <button
              key={option}
              className="target-mode-button"
              data-active={option === psuType}
              onClick={() => setPsuType(option)}
              type="button"
            >
              {option === "personal" ? "Personal" : "Business"}
            </button>
          ))}
        </div>
      ) : null}

      <div className="bank-picker-footer">
        {connectHref ? (
          <a className="button button-primary bank-connect-button" href={connectHref}>
            Connect {selectedBank?.name}
          </a>
        ) : (
          <button className="button button-primary bank-connect-button" disabled type="button">
            Select a bank
          </button>
        )}
        <p className="bank-picker-note">{message}</p>
      </div>
    </div>
  );
}

function BankPickerMessage({ message }: { message: string }) {
  return <p className="bank-picker-empty">{message}</p>;
}

function isSameBank(left: EnableBankingAspsp, right: EnableBankingAspsp) {
  return left.country === right.country && left.name === right.name;
}

function getPsuTypes(bank: EnableBankingAspsp): EnableBankingPsuType[] {
  const psuTypes = bank.psu_types?.filter(isEnableBankingPsuType) ?? [];

  return psuTypes.length > 0 ? psuTypes : ["personal"];
}

function isEnableBankingPsuType(value: string): value is EnableBankingPsuType {
  return value === "personal" || value === "business";
}

function buildConnectHref(
  expectedOrigin: string | null,
  bank: EnableBankingAspsp,
  psuType: EnableBankingPsuType,
) {
  const searchParams = new URLSearchParams({
    country: bank.country,
    name: bank.name,
    psuType,
  });
  const path = `/api/enable-banking/connect?${searchParams.toString()}`;

  if (!expectedOrigin) {
    return path;
  }

  return new URL(path, expectedOrigin).toString();
}

function ExpandablePanel({
  children,
  meta,
  title,
}: {
  children: React.ReactNode;
  meta: string;
  title: string;
}) {
  return (
    <article className="shell-panel proof-panel">
      <details className="brief-details" open>
        <summary className="brief-details-summary">
          <span>{title}</span>
          <span className="brief-details-meta">{meta}</span>
        </summary>
        <div className="brief-details-body">{children}</div>
      </details>
    </article>
  );
}

function BoundaryStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <article className="boundary-stat">
      <p className="eyebrow">{label}</p>
      <p className="boundary-value">{value}</p>
    </article>
  );
}

function DisclosureRow({
  detail,
  label,
  meta,
  value,
}: {
  detail: string;
  label: string;
  meta: string;
  value: string;
}) {
  return (
    <article className="disclosure-row">
      <div>
        <div className="recurring-label-row">
          <h4 className="recurring-title">{label}</h4>
          <span className="chip chip-quiet">{meta}</span>
        </div>
        <p className="recurring-body">{detail}</p>
      </div>
      <p className="recurring-value">{value}</p>
    </article>
  );
}

function RuleRow({
  body,
  title,
}: {
  body: string;
  title: string;
}) {
  return (
    <article className="rule-row">
      <p className="rule-title">{title}</p>
      <p className="rule-body">{body}</p>
    </article>
  );
}

function NoticeBlock({
  callbackUrl,
  browserOrigin,
  expectedOrigin,
}: {
  callbackUrl: string | null;
  browserOrigin: string | null;
  expectedOrigin: string | null;
}) {
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
    <section className="proof-list">
      <p className="text-sm font-semibold text-[var(--foreground)]">{title}</p>
      {items.length === 0 ? (
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{emptyMessage}</p>
      ) : (
        <div className="proof-list-rows">
          {items.map((item) => (
            <div key={item.key} className="proof-list-row">
              <div>
                <p className="proof-list-label">{item.label}</p>
                <p className="proof-list-detail">{item.detail || "—"}</p>
              </div>
              <p className="proof-list-value">{item.value}</p>
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
    .sort((left, right) => right.monthlySpend - left.monthlySpend);
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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function roundCurrency(value: number) {
  return Math.round(value);
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
