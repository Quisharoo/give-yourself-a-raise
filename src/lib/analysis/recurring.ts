import {
  normalizeTransaction,
  matchesFinancialFilter,
  type FinancialRule,
  type FinancialFilter,
  type NormalizedTransaction,
} from "./classification";
import type { EnableBankingAccountSnapshot } from "@/lib/enable-banking/types";
import type { TransactionReadEvidence } from "@/lib/banking/reader";
import { accountRef, type QueryScope } from "@/lib/mcp/transaction-query";
import {
  transactionStatus,
  transactionEventKind,
  addDecimal,
  parseDecimal,
  formatDecimal,
  compareDecimal,
} from "@/lib/transactions";

const DAY = 86400000;
const cadences = [
  { name: "weekly", days: 7, months: 0, tolerance: 1, minimum: 3 },
  { name: "fortnightly", days: 14, months: 0, tolerance: 1, minimum: 3 },
  { name: "monthly", days: 0, months: 1, tolerance: 3, minimum: 3 },
  { name: "quarterly", days: 0, months: 3, tolerance: 3, minimum: 3 },
  { name: "annual", days: 0, months: 12, tolerance: 3, minimum: 2 },
] as const;
type Cadence = (typeof cadences)[number];
export function addCalendarMonths(
  date: string,
  months: number,
  anchorDay = Number(date.slice(8, 10)),
) {
  const initial = new Date(`${date}T00:00:00Z`);
  const target = new Date(
    Date.UTC(initial.getUTCFullYear(), initial.getUTCMonth() + months, 1),
  );
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(anchorDay, lastDay));
  return target.toISOString().slice(0, 10);
}
function nextDate(date: string, cadence: Cadence, anchorDay: number) {
  return cadence.months
    ? addCalendarMonths(date, cadence.months, anchorDay)
    : new Date(Date.parse(date) + cadence.days * DAY)
        .toISOString()
        .slice(0, 10);
}
function inferCadence(rows: NormalizedTransaction[]) {
  const anchorDay = Math.max(
    ...rows.map((row) => Number(row.date.slice(8, 10))),
  );
  const cadence = cadences.find(
    (candidate) =>
      rows.length >= candidate.minimum &&
      rows
        .slice(1)
        .every(
          (row, index) =>
            Math.abs(
              Date.parse(row.date) -
                Date.parse(nextDate(rows[index].date, candidate, anchorDay)),
            ) <=
            candidate.tolerance * DAY,
        ),
  );
  return cadence ? { cadence, anchorDay } : null;
}
function splitStreams(rows: NormalizedTransaction[]) {
  if (inferCadence(rows)) return [rows];
  const byAmount = new Map<string, NormalizedTransaction[]>();
  for (const row of rows) {
    const key = formatDecimal(parseDecimal(row.amountDecimal))
      .replace(/\.0+$/, "")
      .replace(/(\.\d*?)0+$/, "$1");
    const group = byAmount.get(key) ?? [];
    group.push(row);
    byAmount.set(key, group);
  }
  const candidates = [...byAmount.values()];
  if (
    candidates.length > 1 &&
    candidates.every((group) => inferCadence(group)) &&
    candidates.every((group) =>
      candidates.some(
        (other) =>
          other !== group &&
          group[0].date <= other.at(-1)!.date &&
          other[0].date <= group.at(-1)!.date,
      ),
    )
  )
    return candidates;
  return [rows];
}
function evidenceReason(
  account: string,
  next: string,
  evidence: readonly TransactionReadEvidence[],
  now: number,
) {
  const success = evidence.find((row) => row.account_ref === account)?.coverage;
  if (!success) return "fetch_unavailable";
  if (!success.pagination_complete) return "incomplete_pagination";
  if (
    now - Date.parse(success.completed_at) > DAY ||
    Date.parse(success.completed_at) > now + 60000
  )
    return "stale_fetch";
  if (success.status !== "BOOK" && success.status !== "all")
    return "incompatible_status_coverage";
  const today = new Date(now).toISOString().slice(0, 10);
  if (
    !success.date_from ||
    !success.date_to ||
    success.date_from > next ||
    success.date_to < today
  )
    return "insufficient_date_coverage";
  return null;
}
export function detectRecurring(
  accounts: EnableBankingAccountSnapshot[],
  rules: readonly FinancialRule[],
  filters: FinancialFilter,
  scope: QueryScope,
  evidence: readonly TransactionReadEvidence[],
  now = Date.now(),
) {
  const groups = new Map<string, NormalizedTransaction[]>();
  for (const account of accounts)
    for (const transaction of account.transactions) {
      if (
        transactionStatus(transaction.status) !== "BOOK" ||
        transactionEventKind(transaction.bank_transaction_code) !== "unknown"
      )
        continue;
      const row = normalizeTransaction(account.accountId, transaction, rules);
      if (
        row.economicFlow !== "expense" ||
        row.signedAmount >= 0 ||
        !matchesFinancialFilter(row, filters)
      )
        continue;
      const key = JSON.stringify([
        row.accountId,
        row.merchantKey,
        row.currency,
        row.purpose,
        row.project,
      ]);
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
  return [...groups.values()]
    .filter((group) => group.length >= 2)
    .flatMap((group) => {
      group.sort((a, b) => a.date.localeCompare(b.date));
      return splitStreams(group).map((rows) => {
        const latest = rows.at(-1)!;
        const previous = rows.at(-2);
        const account = accountRef(scope, latest.accountId);
        const duplicateDate =
          new Set(rows.map((row) => row.date)).size !== rows.length;
        const inferred = duplicateDate ? null : inferCadence(rows);
        const next = inferred
          ? nextDate(latest.date, inferred.cadence, inferred.anchorDay)
          : null;
        const reason = next
          ? evidenceReason(account, next, evidence, now)
          : duplicateDate
            ? "ambiguous_multiple_charges"
            : "insufficient_cadence_evidence";
        const overdue = next !== null && Date.parse(next) + 3 * DAY < now;
        const amountChanges = rows.slice(1).flatMap((row, index) => {
          const before = parseDecimal(rows[index].amountDecimal);
          const after = parseDecimal(row.amountDecimal);
          return compareDecimal(before, after) === 0
            ? []
            : [
                {
                  date: row.date,
                  previous_amount_decimal: formatDecimal({
                    ...before,
                    coefficient: -before.coefficient,
                  }),
                  amount_decimal: formatDecimal({
                    ...after,
                    coefficient: -after.coefficient,
                  }),
                  difference_decimal: formatDecimal(
                    addDecimal(
                      { ...after, coefficient: -after.coefficient },
                      before,
                    ),
                  ),
                },
              ];
        });
        return {
          account_ref: account,
          merchant: latest.merchant,
          currency: latest.currency,
          purpose: latest.purpose,
          project: latest.project,
          observation_count: rows.length,
          cadence: inferred?.cadence.name ?? null,
          confidence: inferred ? (rows.length >= 3 ? "medium" : "low") : "low",
          last_charge_date: latest.date,
          last_amount_decimal: formatDecimal({
            ...parseDecimal(latest.amountDecimal),
            coefficient: -parseDecimal(latest.amountDecimal).coefficient,
          }),
          previous_amount_decimal: previous
            ? formatDecimal({
                ...parseDecimal(previous.amountDecimal),
                coefficient: -parseDecimal(previous.amountDecimal).coefficient,
              })
            : null,
          next_expected_date: next,
          amount_changes: inferred ? amountChanges.slice(-10) : [],
          amount_change_count: inferred ? amountChanges.length : 0,
          charge_state: reason
            ? reason === "stale_fetch"
              ? "stale_data"
              : "insufficient_evidence"
            : overdue
              ? "overdue_not_observed"
              : "expected",
          overdue_not_observed: reason ? null : overdue,
          evidence_reason: reason,
          provider_history_complete: "unknown",
          grace_days: 3,
        };
      });
    })
    .sort(
      (a, b) =>
        a.merchant.localeCompare(b.merchant) ||
        a.account_ref.localeCompare(b.account_ref),
    );
}
