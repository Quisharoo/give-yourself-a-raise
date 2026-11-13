import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  ECONOMIC_FLOWS,
  PURPOSES,
  financialRuleSchema,
  transactionOverrideSchema,
} from "@/lib/analysis/classification";
import { CATEGORY_LABELS } from "@/lib/analysis/rules";
import { BANK_TRANSACTION_STATUSES } from "@/lib/transactions";

type Schema = Record<string, unknown>;
const string = { type: "string" };
const number = { type: "number", description: "Numeric analysis estimate, not an exact booked amount." };
const count = { type: "integer", minimum: 0 };
const boolean = { type: "boolean" };
const date = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
const decimal = {
  type: "string",
  pattern: "^-?\\d+(?:\\.\\d+)?$",
  description: "Exact decimal amount; preserve as a string for arithmetic.",
};
const currency = { type: "string", pattern: "^[A-Z]{3}$" };
const purpose = { type: "string", enum: PURPOSES };
const flow = { type: "string", enum: ECONOMIC_FLOWS };
const confidence = { type: "string", enum: ["high", "medium", "low"] };
const category = { type: "string", enum: Object.keys(CATEGORY_LABELS) };
const statuses = [...BANK_TRANSACTION_STATUSES, "UNKNOWN"];
const status = { type: "string", enum: statuses };
const array = (items: Schema) => ({ type: "array", items });
const nullable = (schema: Schema) => ({ anyOf: [schema, { type: "null" }] });
function object(properties: Record<string, Schema>, optional: string[] = []) {
  return {
    type: "object" as const,
    properties,
    required: Object.keys(properties).filter((key) => !optional.includes(key)),
  };
}
const fetchRequest = {
  date_from: nullable(date),
  date_to: nullable(date),
  status: nullable(string),
};
const fetchSuccess = object({
  ...fetchRequest,
  completed_at: string,
  pagination_complete: { const: true },
  history_complete: { const: "unknown" },
  returned_count: count,
  earliest_transaction_date: nullable(date),
  latest_transaction_date: nullable(date),
  latest_booked_transaction_date: nullable(date),
});
const dataStatus = array(object({
  account_ref: string,
  resource: { type: "string", enum: ["balances", "transactions"] },
  request: object(fetchRequest),
  last_attempt_at: string,
  last_result: { type: "string", enum: ["running", "success", "failed"] },
  error_code: nullable(string),
  last_success: nullable(fetchSuccess),
  broad_success: nullable(fetchSuccess),
}, ["broad_success"]));
const consent = object({
  state: { type: "string", enum: ["unknown", "active", "expiring", "expired"] },
  expires_at: nullable(string),
  expiry_source: { type: "string", enum: ["unknown", "provider"] },
  warning: nullable(string),
});
const observations = { consent, data_status: dataStatus };
const error = object({
  error: object({ code: string, message: string, reconnect_url: string }),
  data_status: dataStatus,
});
const totals = array(object({
  currency, count, debit: decimal, credit: decimal, net: decimal,
}));
const statusCounts = object(Object.fromEntries(statuses.map((key) => [key, count])));
const totalsProperties = {
  date_from: date,
  date_to: date,
  matched_count: count,
  status: { type: "string", enum: [...statuses, "all"] },
  status_counts: statusCounts,
  totals_by_status: object(Object.fromEntries(statuses.map((key) => [key, totals]))),
  totals,
  classified_totals: array(object({
    currency,
    ...Object.fromEntries(ECONOMIC_FLOWS.map((key) => [key, decimal])),
  })),
  totals_scope: string,
};
const transaction = object({
  transaction_ref: string,
  override_supported: boolean,
  override_reason: nullable(string),
  account_ref: string,
  date,
  amount_decimal: decimal,
  currency,
  merchant: string,
  status,
  category_key: category,
  flow_kind: flow,
  purpose,
  project: nullable(string),
  raw_descriptor: string,
  provider_amount_decimal: decimal,
  category_label: string,
  confidence,
  matched_rule_id: nullable(string),
  classification_source: { type: "string", enum: ["transaction_override", "user_rule", "family", "heuristic", "rule"] },
  classification_reason: string,
  event_kind: { type: "string", enum: ["unknown", "refund", "reversal"] },
  zero_amount: boolean,
}, ["raw_descriptor", "provider_amount_decimal", "category_label", "confidence",
  "matched_rule_id", "classification_source", "classification_reason", "event_kind", "zero_amount"]);
const analysisProperties = {
  estimate: string,
  account_count: count,
  generated_at: string,
  baseline: nullable(object({
    currency,
    discretionary_monthly_spend: number,
    raise_target: number,
    target_percentage: number,
  })),
  currency_summary: object({ primary_currency: nullable(currency), other_currencies: array(currency) }),
  debug_counts: object({
    behavioural_transactions: count,
    excluded_non_booked_transactions: count,
    status_counts: statusCounts,
    excluded_one_off_transactions: count,
    fixed_cost_transactions: count,
    total_transactions: count,
    uncertain_transactions: count,
    wealth_flow_transactions: count,
  }, ["excluded_non_booked_transactions", "status_counts"]),
  fixed_cost_context: array(object({ category_key: category, label: string, merchant_examples: array(string), monthly_spend: number })),
  habit_merchants: array(object({
    average_spend: number, category_key: category, confidence, count, label: string,
    monthly_spend: number, pattern: { type: "string", enum: ["habit", "one_off", "sporadic", "subscription_candidate"] },
  })),
  subscriptions: array(object({ confidence, count, label: string, monthly_spend: number, sample_amount: number })),
  top_levers: array(object({
    category_key: category, confidence, controllability_score: number,
    estimated_half_cut_impact: number, label: string, merchant_examples: array(string),
    monthly_spend: number, target_coverage: number,
  })),
  uncertain_spend: array(object({
    label: string, merchant_family: string, monthly_spend: number, reason: string, transaction_count: count,
  }, ["merchant_family"])),
};
const analysis = {
  ...object(analysisProperties, ["estimate"]),
  description: "Monthly analysis amounts are numeric estimates, separate from exact period totals.",
};
const period = object({ ...totalsProperties, analysis }, ["totals_by_status"]);

function output(success: Schema): NonNullable<Tool["outputSchema"]> {
  return { type: "object", anyOf: [success, error] };
}

export const OUTPUT_SCHEMAS = {
  upsert_classification_rule: output(object({ rule: z.toJSONSchema(financialRuleSchema, { target: "draft-7" }) })),
  delete_classification_rule: output(object({ id: string, deleted: boolean })),
  set_transaction_override: output(object({ override: nullable(z.toJSONSchema(transactionOverrideSchema, { target: "draft-7" })) })),
  get_connection_status: output({
    anyOf: [
      object({ connected: { const: false }, connect_url: string, message: string }),
      object({
        connected: { const: true }, connected_at: string, consent_expires_at: nullable(string),
        country: string, provider: string, reconnect_url: string, ...observations,
      }),
    ]
  }),
  get_account_summary: output(object({
    accounts: array(object({
      account_ref: string, account_type: nullable(string), currency: nullable(currency),
      details_available: boolean,
      balances: array(object({
        amount_decimal: decimal, currency, type: nullable(string),
        reference_date: nullable(date), last_change_date_time: nullable(string),
      })),
      name: string, transaction_count: count,
    })),
    date_from: date, date_to: date, ...observations,
  })),
  summarize_spending: output(object({ ...totalsProperties, ...analysisProperties, ...observations }, ["totals_by_status", "estimate"])),
  find_transactions: output(object({
    ...totalsProperties, pending: object(totalsProperties, ["totals_by_status"]), transactions: array(transaction), page_limited_by_size: boolean,
    next_cursor: nullable(string), truncated: boolean, ...observations,
  }, ["totals_by_status", "pending"])),
  get_transaction_totals: output(object({ ...totalsProperties, pending: object(totalsProperties, ["totals_by_status"]), ...observations }, ["totals_by_status", "pending"])),
  compare_spending_periods: output(object({
    current: period, previous: period, discretionary_monthly_change: number, ...observations,
  })),
  list_classification_rules: output(object({
    rules: array(z.toJSONSchema(financialRuleSchema, { target: "draft-7", io: "input" })),
    overrides: array(z.toJSONSchema(transactionOverrideSchema, { target: "draft-7" })),
  })),
  get_recurring_transactions: output(object({
    date_from: date, date_to: date,
    merchant_amount_changes: array(object({ merchant: string, currency, purpose, project: nullable(string), evidence: string, amount_changes: array(object({ date, previous_date: date, previous_account_ref: string, account_ref: string, previous_amount_decimal: decimal, amount_decimal: decimal, difference_decimal: decimal })) })),
    recurring: array(object({
      account_ref: string, merchant: string, currency, purpose, project: nullable(string),
      observation_count: count,
      cadence: nullable({ type: "string", enum: ["weekly", "fortnightly", "monthly", "quarterly", "annual"] }),
      confidence, last_charge_date: date, last_amount_decimal: decimal,
      previous_amount_decimal: nullable(decimal), next_expected_date: nullable(date),
      amount_changes: array(object({ date, previous_amount_decimal: decimal, amount_decimal: decimal, difference_decimal: decimal })),
      amount_change_count: count,
      charge_state: { type: "string", enum: ["stale_data", "insufficient_evidence", "overdue_not_observed", "expected"] },
      overdue_not_observed: nullable(boolean),
      evidence_reason: nullable({ type: "string", enum: ["fetch_unavailable", "incomplete_pagination", "stale_fetch", "incompatible_status_coverage", "insufficient_date_coverage", "ambiguous_multiple_charges", "insufficient_cadence_evidence"] }),
      provider_history_complete: { const: "unknown" }, grace_days: count,
    })),
    matched_count: count, next_offset: nullable(count), paging_note: string, estimate: string, ...observations,
  })),
} satisfies Record<string, NonNullable<Tool["outputSchema"]>>;
