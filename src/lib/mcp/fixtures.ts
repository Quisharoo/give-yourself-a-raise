import { TransactionInputError } from "../transactions";
import {
  financialRuleSchema,
  transactionOverrideInputSchema,
  type FinancialRule,
  type TransactionOverride,
} from "../analysis/classification";
import type {
  AccountFetchObservation,
  FetchAttempt,
  FetchSuccess,
} from "@/lib/connections/store";
import type { McpBankDependencies } from "./tools";

export function syntheticPersistence(): Pick<
  McpBankDependencies,
  | "updateConsentExpiry"
  | "beginAccountFetch"
  | "finishAccountFetch"
  | "getAccountFetchObservations"
  | "listFinancialRules"
  | "listTransactionOverrides"
  | "upsertFinancialRule"
  | "deleteFinancialRule"
  | "setTransactionOverride"
  | "observeTransactionIdentities"
> {
  const observations = new Map<
    string,
    { attempt: FetchAttempt; observation: AccountFetchObservation }
  >();
  const rules = new Map<string, Map<string, FinancialRule>>();
  const overrides = new Map<string, Map<string, TransactionOverride>>();
  const identities = new Map<
    string,
    { evidence: string; ambiguous: boolean }
  >();
  const identityKey = (subject: string, ref: string) =>
    JSON.stringify([subject, ref]);
  const key = (attempt: FetchAttempt) =>
    JSON.stringify([
      attempt.connection.subject,
      attempt.connection.connectionId,
      attempt.accountRef,
      attempt.resource,
    ]);
  return {
    updateConsentExpiry: async () => {},
    listFinancialRules: async (subject) => [
      ...(rules.get(subject)?.values() ?? []),
    ],
    listTransactionOverrides: async (subject) =>
      [...(overrides.get(subject)?.values() ?? [])].filter(
        (item) =>
          !identities.get(identityKey(subject, item.transaction_ref))
            ?.ambiguous,
      ),
    upsertFinancialRule: async (subject, raw) => {
      const rule = financialRuleSchema.parse(raw);
      const owned = rules.get(subject) ?? new Map<string, FinancialRule>();
      owned.set(rule.id, rule);
      rules.set(subject, owned);
      return rule;
    },
    deleteFinancialRule: async (subject, id) =>
      rules.get(subject)?.delete(id) ?? false,
    setTransactionOverride: async (subject, raw) => {
      const override = transactionOverrideInputSchema.parse(raw);
      if ("labels" in override) {
        overrides.get(subject)?.delete(override.transaction_ref);
        return null;
      }
      const identity = identities.get(
        identityKey(subject, override.transaction_ref),
      );
      if (!identity || identity.ambiguous)
        throw new TransactionInputError(
          "Override refused for an unsupported identity.",
        );
      const owned =
        overrides.get(subject) ?? new Map<string, TransactionOverride>();
      owned.set(override.transaction_ref, override);
      overrides.set(subject, owned);
      return override;
    },
    observeTransactionIdentities: async (subject, observations) =>
      observations.map((item) => {
        const key = identityKey(subject, item.transaction_ref);
        const previous = identities.get(key);
        const ambiguous =
          !item.supported ||
          (previous?.ambiguous ?? false) ||
          (previous !== undefined && previous.evidence !== item.evidence);
        identities.set(key, { evidence: item.evidence, ambiguous });
        return { transaction_ref: item.transaction_ref, ambiguous };
      }),
    beginAccountFetch: async (attempt, request) => {
      const previous = observations.get(key(attempt));
      observations.set(key(attempt), {
        attempt,
        observation: {
          account_ref: attempt.accountRef,
          resource: attempt.resource,
          request,
          last_attempt_at: new Date().toISOString(),
          last_result: "running",
          error_code: null,
          last_success: previous?.observation.last_success ?? null,
        },
      });
      return true;
    },
    finishAccountFetch: async (
      attempt,
      result: { success: FetchSuccess } | { errorCode: string },
    ) => {
      const current = observations.get(key(attempt));
      if (current?.attempt.attemptId !== attempt.attemptId) return;
      current.observation = {
        ...current.observation,
        last_result: "success" in result ? "success" : "failed",
        error_code: "errorCode" in result ? result.errorCode : null,
        last_success:
          "success" in result
            ? result.success
            : current.observation.last_success,
      };
    },
    getAccountFetchObservations: async (connection) =>
      [...observations.values()]
        .filter(
          ({ attempt }) =>
            attempt.connection.subject === connection.subject &&
            attempt.connection.connectionId === connection.connectionId,
        )
        .map(({ observation }) => structuredClone(observation)),
  };
}
