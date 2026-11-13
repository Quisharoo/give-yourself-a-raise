import type { EnableBankingAccountSnapshot } from "@/lib/enable-banking/types";
import {
  normalizeAccountTransactions,
  type ClassificationSnapshot,
} from "./classification";
import { observeTransactionIdentities } from "./rule-store";

export async function observeAccountTransactionIdentities(
  accounts: EnableBankingAccountSnapshot[],
  snapshot: ClassificationSnapshot,
  observe = observeTransactionIdentities,
) {
  const identities = accounts
    .flatMap((account) => normalizeAccountTransactions(account, snapshot))
    .flatMap((row) =>
      row.transactionRef && row.identityEvidence
        ? [{
            transaction_ref: row.transactionRef,
            evidence: row.identityEvidence,
            supported: row.overrideSupported,
          }]
        : [],
    );
  const observed = await observe(snapshot.subject, identities);
  const unsupported = observed
    .filter((row) => row.ambiguous)
    .map((row) => row.transaction_ref);
  for (const account of accounts)
    account.unsupportedTransactionRefs = unsupported;
}
