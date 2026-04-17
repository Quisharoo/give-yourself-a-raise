"use client";

import { useEffect, useState } from "react";

import type { EnableBankingSessionOverview, EnableBankingTransaction } from "@/lib/enable-banking/types";

type SessionState =
  | { status: "loading" }
  | { status: "missing"; message: string }
  | { status: "error"; message: string }
  | { status: "ready"; overview: EnableBankingSessionOverview };

export function SessionPanel() {
  const [state, setState] = useState<SessionState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function loadRecentSession() {
      try {
        const dateFrom = new Date();
        dateFrom.setDate(dateFrom.getDate() - 14);

        const params = new URLSearchParams({
          dateFrom: dateFrom.toISOString().slice(0, 10),
          summary: "1",
        });

        const response = await fetch(`/api/enable-banking/session?${params.toString()}`, {
          cache: "no-store",
          credentials: "include",
        });

        const data = (await response.json()) as
          | EnableBankingSessionOverview
          | { error?: string };

        if (cancelled) {
          return;
        }

        if (!response.ok) {
          const errorMessage = getErrorMessage(data);

          if (response.status === 404) {
            setState({
              status: "missing",
              message: errorMessage ?? "No session cookie found.",
            });
            return;
          }

          setState({
            status: "error",
            message: errorMessage ?? "Unable to load session data.",
          });
          return;
        }

        setState({ status: "ready", overview: data as EnableBankingSessionOverview });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Unable to load session data.",
        });
      }
    }

    void loadRecentSession();

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") {
    return (
      <>
        <StatusItem label="Session cookie" value="checking" />
        <StatusItem label="Accounts" value="..." />
        <div className="card text-sm text-slate-600 sm:col-span-2 lg:col-span-4">
          Checking recent session data…
        </div>
      </>
    );
  }

  if (state.status === "missing") {
    return (
      <>
        <StatusItem label="Session cookie" value="missing" />
        <StatusItem label="Accounts" value="0" />
        <div className="card text-sm text-slate-600 sm:col-span-2 lg:col-span-4">
          {state.message}
        </div>
      </>
    );
  }

  if (state.status === "error") {
    return (
      <>
        <StatusItem label="Session cookie" value="error" />
        <StatusItem label="Accounts" value="0" />
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 sm:col-span-2 lg:col-span-4">
          {state.message}
        </div>
      </>
    );
  }

  return (
      <>
        <StatusItem label="Session cookie" value="present" />
        <StatusItem label="Accounts" value={String(state.overview.accounts.length)} />
        <div className="grid gap-4 sm:col-span-2 lg:col-span-4">
          {state.overview.accounts.map((account) => (
            <article key={account.accountId} className="card space-y-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="label">Account</p>
                  <h3 className="text-lg font-semibold text-slate-950">
                    {account.name || account.accountId}
                  </h3>
                  <p className="text-sm text-slate-600">{account.iban || account.accountId}</p>
                </div>

                <div className="grid gap-2 sm:text-right">
                  <div>
                    <p className="label">Balances</p>
                    <p className="text-sm text-slate-700">
                      {account.balances.length > 0
                        ? account.balances
                            .map(
                              (balance) =>
                                `${balance.balance_amount.amount} ${balance.balance_amount.currency}`,
                            )
                            .join(" · ")
                        : "No balances returned"}
                    </p>
                  </div>
                  <div>
                    <p className="label">Transactions</p>
                    <p className="text-sm text-slate-700">{account.transactions.length}</p>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[44rem] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th className="px-0 py-2 font-medium">Date</th>
                      <th className="px-3 py-2 font-medium">Type</th>
                      <th className="px-3 py-2 font-medium">Counterparty</th>
                      <th className="px-3 py-2 font-medium">Reference</th>
                      <th className="px-0 py-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {account.transactions.slice(0, 12).map((transaction) => (
                      <tr
                        key={
                          transaction.transaction_id ||
                          transaction.entry_reference ||
                          `${transaction.booking_date}-${transaction.transaction_amount.amount}`
                        }
                        className="border-b border-slate-100 align-top"
                      >
                        <td className="px-0 py-3 text-slate-600">
                          {transaction.booking_date || transaction.value_date || "—"}
                        </td>
                        <td className="px-3 py-3 text-slate-600">
                          {transaction.bank_transaction_code?.code || "—"}
                        </td>
                        <td className="px-3 py-3 text-slate-900">
                          {transaction.creditor?.name || transaction.debtor?.name || "Unknown"}
                        </td>
                        <td className="px-3 py-3 text-slate-600">
                          {transaction.remittance_information?.[0] || transaction.note || "—"}
                        </td>
                        <td className="px-0 py-3 text-right font-medium text-slate-950">
                          {formatSignedAmount(transaction)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          ))}
        </div>
      </>
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

function formatSignedAmount(transaction: EnableBankingTransaction) {
  const amount = Number(transaction.transaction_amount.amount);

  if (!Number.isFinite(amount)) {
    return `— ${transaction.transaction_amount.currency}`;
  }

  const signedAmount =
    transaction.credit_debit_indicator === "CRDT" ? amount : Math.abs(amount) * -1;

  return `${signedAmount < 0 ? "-" : "+"}${Math.abs(signedAmount).toFixed(2)} ${transaction.transaction_amount.currency}`;
}

function getErrorMessage(data: EnableBankingSessionOverview | { error?: string }) {
  if ("error" in data && typeof data.error === "string") {
    return data.error;
  }

  return null;
}
