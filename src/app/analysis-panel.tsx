"use client";

import { useEffect, useState } from "react";

import type { SpendingAnalysis } from "@/lib/analysis/types";

type AnalysisState =
  | { status: "loading" }
  | { status: "missing"; message: string }
  | { status: "error"; message: string }
  | { status: "ready"; analysis: SpendingAnalysis };

export function AnalysisPanel({
  callbackUrl,
  expectedOrigin,
}: {
  callbackUrl: string | null;
  expectedOrigin: string | null;
}) {
  const [state, setState] = useState<AnalysisState>({ status: "loading" });
  const [browserOrigin, setBrowserOrigin] = useState<string | null>(null);

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

          if (response.status === 404) {
            setState({ status: "missing", message });
            return;
          }

          setState({ status: "error", message });
          return;
        }

        setState({ status: "ready", analysis: data as SpendingAnalysis });
      } catch (error) {
        if (cancelled) {
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
      <>
        <StatusItem label="Session" value="checking" />
        <StatusItem label="Accounts" value="..." />
        <StatusItem label="Primary currency" value="..." />
        <div className="card text-sm text-slate-600 sm:col-span-2 lg:col-span-4">
          {originMismatch ? (
            <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-800">
              Open the app on <span className="font-mono text-xs break-all">{expectedOrigin}</span>.
              The current browser origin is <span className="font-mono text-xs break-all">{browserOrigin}</span>.
            </div>
          ) : null}
          Building the action brief…
        </div>
      </>
    );
  }

  if (state.status === "missing") {
    return (
      <>
        <StatusItem label="Session" value="missing" />
        <StatusItem label="Accounts" value="0" />
        <StatusItem label="Primary currency" value="—" />
        <div className="card text-sm text-slate-600 sm:col-span-2 lg:col-span-4">
          {originMismatch ? (
            <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-800">
              Open the app on <span className="font-mono text-xs break-all">{expectedOrigin}</span>.
              The current browser origin is <span className="font-mono text-xs break-all">{browserOrigin}</span>.
            </div>
          ) : null}
          {state.message}
        </div>
      </>
    );
  }

  if (state.status === "error") {
    return (
      <>
        <StatusItem label="Session" value="error" />
        <StatusItem label="Accounts" value="0" />
        <StatusItem label="Primary currency" value="—" />
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 sm:col-span-2 lg:col-span-4">
          {originMismatch ? (
            <div className="mb-3 rounded-xl border border-red-200 bg-white px-4 py-3 text-red-800">
              Open the app on <span className="font-mono text-xs break-all">{expectedOrigin}</span>.
              The current browser origin is <span className="font-mono text-xs break-all">{browserOrigin}</span>.
            </div>
          ) : null}
          {state.message}
        </div>
      </>
    );
  }

  const { analysis } = state;
  const baseline = analysis.baseline;

  return (
    <>
      <StatusItem label="Session" value="present" />
      <StatusItem label="Accounts" value={String(analysis.accountCount)} />
      <StatusItem label="Primary currency" value={analysis.currencySummary.primaryCurrency ?? "—"} />

      <div className="grid gap-4 sm:col-span-2 lg:col-span-4">
        {originMismatch ? (
          <section className="rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-800">
            <p className="font-medium text-red-950">Origin mismatch</p>
            <p className="mt-1">
              Open the app on <span className="font-mono text-xs break-all">{expectedOrigin}</span>.
              The current browser origin is <span className="font-mono text-xs break-all">{browserOrigin}</span>.
            </p>
            {callbackUrl ? (
              <p className="mt-2">
                Current callback URL:{" "}
                <span className="font-mono text-xs break-all">{callbackUrl}</span>
              </p>
            ) : null}
          </section>
        ) : null}

        <section className="card space-y-4">
          <div className="space-y-1">
            <p className="label">Action brief</p>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
              {baseline
                ? `${formatCurrency(baseline.discretionaryMonthlySpend, baseline.currency)} in discretionary spend each month`
                : "No discretionary baseline yet"}
            </h2>
            <p className="text-sm text-slate-600">
              {baseline
                ? `A 10% cut is ${formatCurrency(baseline.raiseTarget, baseline.currency)}. The goal is to find the cleanest levers, not to budget every line item.`
                : "Link a session with behavioural spend in one primary currency to generate the raise brief."}
            </p>
          </div>

          {analysis.currencySummary.otherCurrencies.length > 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              Other currencies detected: {analysis.currencySummary.otherCurrencies.join(", ")}
            </div>
          ) : null}
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="card space-y-4">
            <div className="space-y-1">
              <p className="label">Top levers</p>
              <h3 className="text-xl font-semibold text-slate-950">Where the real leverage is</h3>
            </div>

            {analysis.topLevers.length === 0 || !baseline ? (
              <p className="text-sm text-slate-600">
                No confident top levers yet. This usually means most recent activity is money movement, fixed cost, or unresolved merchant noise.
              </p>
            ) : (
              <div className="grid gap-3">
                {analysis.topLevers.map((lever) => (
                  <article key={lever.categoryKey} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-base font-semibold text-slate-950">{lever.label}</p>
                        <p className="mt-1 text-sm text-slate-600">
                          {formatCurrency(lever.monthlySpend, baseline.currency)} per month.
                          Cutting it by half gets you{" "}
                          <span className="font-medium text-slate-950">
                            {formatCurrency(lever.estimatedHalfCutImpact, baseline.currency)}
                          </span>
                          , or {formatPercent(lever.targetCoverage)} of the way to the target.
                        </p>
                        {lever.merchantExamples.length > 0 ? (
                          <p className="mt-2 text-sm text-slate-500">
                            Examples: {lever.merchantExamples.join(", ")}
                          </p>
                        ) : null}
                      </div>
                      <div className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600">
                        controllability {Math.round(lever.controllabilityScore * 100)}%
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-4">
            <section className="card space-y-3">
              <div className="space-y-1">
                <p className="label">Subscriptions</p>
                <h3 className="text-lg font-semibold text-slate-950">Audit these</h3>
              </div>
              {analysis.subscriptions.length === 0 || !baseline ? (
                <p className="text-sm text-slate-600">No strong subscription candidates yet.</p>
              ) : (
                <div className="space-y-3">
                  {analysis.subscriptions.map((item) => (
                    <div key={item.label} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="font-medium text-slate-950">{item.label}</p>
                      <p className="mt-1 text-sm text-slate-600">
                        {formatCurrency(item.monthlySpend, baseline.currency)} per month across {item.count} hits.
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="card space-y-3">
              <div className="space-y-1">
                <p className="label">Fixed costs</p>
                <h3 className="text-lg font-semibold text-slate-950">Context, not targets</h3>
              </div>
              {analysis.fixedCostContext.length === 0 || !baseline ? (
                <p className="text-sm text-slate-600">No fixed-cost context detected in the primary currency.</p>
              ) : (
                <div className="space-y-3">
                  {analysis.fixedCostContext.map((item) => (
                    <div key={item.categoryKey} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="font-medium text-slate-950">{item.label}</p>
                      <p className="mt-1 text-sm text-slate-600">
                        {formatCurrency(item.monthlySpend, baseline.currency)} per month
                      </p>
                      {item.merchantExamples.length > 0 ? (
                        <p className="mt-1 text-sm text-slate-500">{item.merchantExamples.join(", ")}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <div className="card space-y-3">
            <div className="space-y-1">
              <p className="label">Habit merchants</p>
              <h3 className="text-lg font-semibold text-slate-950">Recurring behaviour</h3>
            </div>
            {analysis.habitMerchants.length === 0 || !baseline ? (
              <p className="text-sm text-slate-600">No recurring merchant habits yet.</p>
            ) : (
              <div className="space-y-3">
                {analysis.habitMerchants.map((habit) => (
                  <div key={habit.label} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="font-medium text-slate-950">{habit.label}</p>
                    <p className="mt-1 text-sm text-slate-600">
                      {formatCurrency(habit.monthlySpend, baseline.currency)} per month across {habit.count} hits.
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card space-y-3">
            <div className="space-y-1">
              <p className="label">Uncertain spend</p>
              <h3 className="text-lg font-semibold text-slate-950">Keep broad on purpose</h3>
            </div>
            {analysis.uncertainSpend.length === 0 || !baseline ? (
              <p className="text-sm text-slate-600">No unresolved merchant noise in the brief.</p>
            ) : (
              <div className="space-y-3">
                {analysis.uncertainSpend.map((item) => (
                  <div key={item.label} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="font-medium text-slate-950">{item.label}</p>
                    <p className="mt-1 text-sm text-slate-600">
                      {formatCurrency(item.monthlySpend, baseline.currency)} per month across {item.transactionCount} hits.
                    </p>
                    <p className="mt-1 text-sm text-slate-500">{item.reason}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="card space-y-3">
          <div className="space-y-1">
            <p className="label">Debug counts</p>
            <h3 className="text-lg font-semibold text-slate-950">What was filtered out</h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <MiniStat label="Behavioural spend" value={String(analysis.debugCounts.behaviouralTransactions)} />
            <MiniStat label="Wealth flow" value={String(analysis.debugCounts.wealthFlowTransactions)} />
            <MiniStat label="Fixed cost" value={String(analysis.debugCounts.fixedCostTransactions)} />
            <MiniStat label="Excluded one-offs" value={String(analysis.debugCounts.excludedOneOffTransactions)} />
            <MiniStat label="Uncertain" value={String(analysis.debugCounts.uncertainTransactions)} />
            <MiniStat label="Total transactions" value={String(analysis.debugCounts.totalTransactions)} />
          </div>
        </section>
      </div>
    </>
  );
}

function MiniStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="label">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-950">{value}</p>
    </div>
  );
}

function StatusItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="label">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-950">{value}</p>
    </div>
  );
}

function formatCurrency(value: number, currency: string) {
  return new Intl.NumberFormat("en-IE", {
    currency,
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}
