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
> {
  const observations = new Map<
    string,
    { attempt: FetchAttempt; observation: AccountFetchObservation }
  >();
  const key = (attempt: FetchAttempt) =>
    JSON.stringify([
      attempt.connection.subject,
      attempt.connection.connectionId,
      attempt.accountRef,
      attempt.resource,
    ]);
  return {
    updateConsentExpiry: async () => {},
    listFinancialRules: async () => [],
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
