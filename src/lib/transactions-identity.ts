import { enableBankingAccountDetailsSchema } from "./enable-banking/types";
import { createHmac } from "node:crypto";

export interface TransactionIdentity {
  ref: string | null;
  supported: boolean;
  reason: string | null;
  evidence: string | null;
}

export function stableRef(
  subject: string,
  kind: "acc" | "txn",
  identity: string,
) {
  const encoded = process.env.BANK_CONNECTION_ENCRYPTION_KEY?.trim();
  if (!encoded || Buffer.from(encoded, "base64").length !== 32)
    throw new Error(
      "A valid bank encryption key is required for stable classification references.",
    );
  return `${kind}_${createHmac("sha256", Buffer.from(encoded, "base64"))
    .update(JSON.stringify(["classification-v1", subject, kind, identity]))
    .digest("base64url")}`;
}

export function bankAccountIdentity(
  provider: string,
  country: string,
  rawDetails: unknown,
) {
  const details = enableBankingAccountDetailsSchema.parse(rawDetails);
  return {
    details,
    stableIdentity: details.identification_hash
      ? JSON.stringify([
          provider,
          country,
          details.identification_hash,
          details.currency ?? null,
          details.cash_account_type ?? null,
        ])
      : undefined,
  };
}
