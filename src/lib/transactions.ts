import type { EnableBankingTransaction } from "@/lib/enable-banking/types";

export interface Decimal {
  coefficient: bigint;
  scale: number;
}

export class TransactionInputError extends Error {}

export function parseDecimal(value: string): Decimal {
  if (
    typeof value !== "string" ||
    value.length > 256 ||
    !/^-?\d+(?:\.\d+)?$/.test(value)
  ) {
    throw new TransactionInputError(
      "The bank returned an invalid transaction amount.",
    );
  }
  const [integer, fraction = ""] = value.split(".");
  return { coefficient: BigInt(integer + fraction), scale: fraction.length };
}

export function formatDecimal(value: Decimal): string {
  const negative = value.coefficient < BigInt(0);
  const digits = (negative ? -value.coefficient : value.coefficient)
    .toString()
    .padStart(value.scale + 1, "0");
  const amount = value.scale
    ? `${digits.slice(0, -value.scale)}.${digits.slice(-value.scale)}`
    : digits;
  return `${negative ? "-" : ""}${amount}`;
}

export function addDecimal(left: Decimal, right: Decimal): Decimal {
  const scale = Math.max(left.scale, right.scale);
  return {
    coefficient:
      left.coefficient * BigInt(10) ** BigInt(scale - left.scale) +
      right.coefficient * BigInt(10) ** BigInt(scale - right.scale),
    scale,
  };
}

export function compareDecimal(left: Decimal, right: Decimal): number {
  const difference = addDecimal(left, {
    ...right,
    coefficient: -right.coefficient,
  }).coefficient;
  return difference < BigInt(0) ? -1 : difference > BigInt(0) ? 1 : 0;
}

export function transactionMoney(transaction: EnableBankingTransaction) {
  const amount = parseDecimal(transaction.transaction_amount?.amount);
  if (
    !/^[A-Z]{3}$/.test(transaction.transaction_amount?.currency ?? "") ||
    !["CRDT", "DBIT"].includes(transaction.credit_debit_indicator ?? "")
  ) {
    throw new TransactionInputError(
      "The bank returned an invalid transaction currency or direction.",
    );
  }
  const magnitude = {
    ...amount,
    coefficient:
      amount.coefficient < BigInt(0) ? -amount.coefficient : amount.coefficient,
  };
  const signed = {
    ...magnitude,
    coefficient:
      transaction.credit_debit_indicator === "DBIT"
        ? -magnitude.coefficient
        : magnitude.coefficient,
  };
  return { magnitude, signed };
}

export function validCalendarDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}

export const BANK_TRANSACTION_STATUSES = [
  "BOOK",
  "CNCL",
  "HOLD",
  "OTHR",
  "PDNG",
  "RJCT",
  "SCHD",
] as const;
export type TransactionStatus =
  (typeof BANK_TRANSACTION_STATUSES)[number] | "UNKNOWN";

export function transactionStatus(value: unknown): TransactionStatus {
  return (
    BANK_TRANSACTION_STATUSES.find((status) => status === value) ?? "UNKNOWN"
  );
}

export function transactionStatusCounts(
  transactions: EnableBankingTransaction[],
) {
  const counts: Record<TransactionStatus, number> = {
    BOOK: 0,
    CNCL: 0,
    HOLD: 0,
    OTHR: 0,
    PDNG: 0,
    RJCT: 0,
    SCHD: 0,
    UNKNOWN: 0,
  };
  for (const transaction of transactions)
    counts[transactionStatus(transaction.status)]++;
  return counts;
}

export function transactionEventKind(
  code: EnableBankingTransaction["bank_transaction_code"],
) {
  const values = [code?.code, code?.sub_code];
  if (
    values.some(
      (value) =>
        value === "REFUND" ||
        value === "CARD_REFUND" ||
        value === "CHARGE_REFUND",
    )
  )
    return "refund";
  if (values.some((value) => value === "REVERSAL" || value === "CARD_REVERSAL"))
    return "reversal";
  return "unknown";
}
