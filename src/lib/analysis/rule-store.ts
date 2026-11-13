import { neon } from "@neondatabase/serverless";
import {
  financialRuleSchema,
  type FinancialRule,
  transactionOverrideSchema,
  transactionOverrideInputSchema,
  type TransactionOverride,
  type ClassificationSnapshot,
} from "./classification";
import { TransactionInputError } from "@/lib/transactions";
import { z } from "zod";

export const INITIAL_OWNER_RULES: FinancialRule[] = [
  {
    id: "owner-apple-business",
    priority: 100,
    merchant_key: "apple",
    direction: "debit",
    except_amount: { currency: "EUR", amount: "9.99" },
    purpose: "business",
    project: "INCREMNT",
    zero_amount: false,
    flow_kind: "expense",
  },
  {
    id: "owner-join-brands",
    priority: 100,
    merchant_key: "join_brands",
    direction: "debit",
    except_amount: null,
    purpose: "business",
    project: "INCREMNT",
    flow_kind: "expense",
  },
  {
    id: "owner-amazon",
    priority: 100,
    merchant_key: "amazon",
    direction: "either",
    except_amount: null,
    purpose: "personal",
    project: null,
    flow_kind: null,
  },
  {
    id: "owner-amazon-prime",
    priority: 100,
    merchant_key: "amazon_prime",
    direction: "either",
    except_amount: null,
    purpose: "personal",
    project: null,
    flow_kind: null,
  },
  {
    id: "owner-apple-distribution",
    priority: 100,
    merchant_key: "apple_distribution",
    direction: "credit",
    except_amount: null,
    purpose: "business",
    project: "INCREMNT",
    flow_kind: "revenue",
  },
];

for (const key of [
  "openai_chatgpt",
  "openrouter",
  "render",
  "register365",
  "hetzner",
  "upstash",
  "vercel",
  "cursor",
  "lovable",
  "intellectual_property_office",
  "companies_registration_office",
]) {
  INITIAL_OWNER_RULES.push({
    id: `owner-${key.replaceAll("_", "-")}`,
    priority: 100,
    merchant_key: key,
    direction: "debit",
    except_amount: null,
    purpose: "business",
    project: "INCREMNT",
    flow_kind: "expense",
    zero_amount: false,
  });
}
for (const key of [
  "google_play",
  "exchanged_to_usd",
  "kevin_byrne",
  "paul_michael_mccarthy",
]) {
  INITIAL_OWNER_RULES.push({
    id: `owner-${key.replaceAll("_", "-")}`,
    priority: 100,
    merchant_key: key,
    direction: "either",
    except_amount: null,
    purpose: "personal",
    project: null,
    flow_kind: null,
  });
}
INITIAL_OWNER_RULES.push({
  id: "owner-apple-personal",
  priority: 110,
  merchant_key: "apple",
  direction: "debit",
  except_amount: null,
  exact_amount: { currency: "EUR", amount: "9.99" },
  purpose: "personal",
  project: null,
  flow_kind: "expense",
});
const legacyApple = {
  id: "owner-apple-business",
  priority: 100,
  merchant_key: "apple",
  direction: "debit",
  except_amount: { currency: "EUR", amount: "9.99" },
  purpose: "business",
  project: null,
  flow_kind: "expense",
};
let schemaPromise: Promise<void> | null = null;
function database() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url)
    throw new Error("DATABASE_URL is required for financial classifications.");
  return neon(url);
}
async function ensureSchema() {
  const sql = database();
  schemaPromise ??= (async () => {
    await sql`CREATE TABLE IF NOT EXISTS bank_financial_rules (subject TEXT NOT NULL, rule_id TEXT NOT NULL, rule JSONB NOT NULL, PRIMARY KEY(subject, rule_id))`;
    await sql`CREATE TABLE IF NOT EXISTS bank_classification_migrations (subject TEXT NOT NULL, version INTEGER NOT NULL, PRIMARY KEY(subject, version))`;
    await sql`CREATE TABLE IF NOT EXISTS bank_transaction_identities (subject TEXT NOT NULL, transaction_ref TEXT NOT NULL, evidence TEXT NOT NULL, ambiguous BOOLEAN NOT NULL DEFAULT FALSE, PRIMARY KEY(subject, transaction_ref))`;
    await sql`CREATE TABLE IF NOT EXISTS bank_transaction_overrides (subject TEXT NOT NULL, transaction_ref TEXT NOT NULL, labels JSONB NOT NULL, PRIMARY KEY(subject, transaction_ref), FOREIGN KEY(subject, transaction_ref) REFERENCES bank_transaction_identities(subject, transaction_ref))`;
  })().catch((error) => {
    schemaPromise = null;
    throw error;
  });
  await schemaPromise;
}
async function seedOwner(subject: string) {
  await ensureSchema();
  if (subject !== process.env.PRIVATE_PLUGIN_SUBJECT?.trim()) return;
  const sql = database();
  await sql`WITH installed AS (
      INSERT INTO bank_classification_migrations(subject, version) VALUES (${subject}, 2) ON CONFLICT DO NOTHING RETURNING subject
    ), existing AS MATERIALIZED (SELECT EXISTS(SELECT 1 FROM bank_financial_rules WHERE subject = ${subject}) AS present),
    seeded AS (
      INSERT INTO bank_financial_rules(subject, rule_id, rule)
      SELECT ${subject}, value->>'id', value FROM jsonb_array_elements(${JSON.stringify(INITIAL_OWNER_RULES)}::jsonb)
      WHERE EXISTS(SELECT 1 FROM installed)
        AND (NOT (SELECT present FROM existing) OR value->>'id' NOT IN ('owner-apple-business', 'owner-join-brands', 'owner-amazon', 'owner-amazon-prime', 'owner-apple-distribution'))
      ON CONFLICT(subject, rule_id) DO NOTHING RETURNING rule_id
    ) UPDATE bank_financial_rules SET rule = ${JSON.stringify(INITIAL_OWNER_RULES[0])}::jsonb
      WHERE subject = ${subject} AND rule_id = 'owner-apple-business' AND rule = ${JSON.stringify(legacyApple)}::jsonb AND EXISTS(SELECT 1 FROM installed)`;
}
export async function listFinancialRules(
  subject: string,
): Promise<FinancialRule[]> {
  await seedOwner(subject);
  const sql = database();
  const rows =
    await sql`SELECT rule FROM bank_financial_rules WHERE subject = ${subject} ORDER BY rule_id`;
  return z
    .array(z.object({ rule: financialRuleSchema }))
    .parse(rows)
    .map((row) => row.rule);
}
export async function getClassificationSnapshot(
  subject: string,
): Promise<ClassificationSnapshot> {
  await seedOwner(subject);
  const sql = database();
  const rows = await sql`SELECT
    COALESCE((SELECT jsonb_agg(rule ORDER BY rule_id) FROM bank_financial_rules WHERE subject = ${subject}), '[]'::jsonb) AS rules,
    COALESCE((SELECT jsonb_agg(o.labels || jsonb_build_object('transaction_ref', o.transaction_ref) ORDER BY o.transaction_ref) FROM bank_transaction_overrides o JOIN bank_transaction_identities i USING(subject, transaction_ref) WHERE o.subject = ${subject} AND NOT i.ambiguous), '[]'::jsonb) AS overrides`;
  const row = z
    .object({
      rules: z.array(financialRuleSchema),
      overrides: z.array(transactionOverrideSchema),
    })
    .parse(rows[0]);
  return { subject, ...row };
}
export async function listTransactionOverrides(
  subject: string,
): Promise<TransactionOverride[]> {
  await ensureSchema();
  const sql = database();
  const rows =
    await sql`SELECT o.transaction_ref, o.labels FROM bank_transaction_overrides o JOIN bank_transaction_identities i USING(subject, transaction_ref) WHERE o.subject = ${subject} AND NOT i.ambiguous ORDER BY o.transaction_ref`;
  const overrides = z
    .array(
      z.object({
        transaction_ref: z.string(),
        labels: transactionOverrideSchema.omit({ transaction_ref: true }),
      }),
    )
    .parse(rows)
    .map((row) => ({ transaction_ref: row.transaction_ref, ...row.labels }));
  return overrides;
}
export async function upsertFinancialRule(subject: string, raw: unknown) {
  const rule = financialRuleSchema.parse(raw);
  await seedOwner(subject);
  const sql = database();
  await sql`INSERT INTO bank_financial_rules(subject, rule_id, rule) VALUES (${subject}, ${rule.id}, ${JSON.stringify(rule)}::jsonb) ON CONFLICT(subject, rule_id) DO UPDATE SET rule = EXCLUDED.rule`;
  return rule;
}
export async function deleteFinancialRule(subject: string, id: string) {
  await seedOwner(subject);
  const sql = database();
  const rows =
    await sql`DELETE FROM bank_financial_rules WHERE subject = ${subject} AND rule_id = ${id} RETURNING rule_id`;
  return rows.length > 0;
}
export interface ObservedIdentity {
  transaction_ref: string;
  evidence: string;
  supported: boolean;
}
export async function observeTransactionIdentities(
  subject: string,
  identities: readonly ObservedIdentity[],
) {
  await ensureSchema();
  if (!identities.length) return [];
  const unique = new Map<string, ObservedIdentity>();
  for (const identity of identities) {
    const previous = unique.get(identity.transaction_ref);
    unique.set(identity.transaction_ref, {
      ...identity,
      supported:
        identity.supported &&
        (!previous ||
          (previous.supported && previous.evidence === identity.evidence)),
    });
  }
  const sql = database();
  const rows =
    await sql`INSERT INTO bank_transaction_identities(subject, transaction_ref, evidence, ambiguous)
    SELECT ${subject}, value->>'transaction_ref', value->>'evidence', NOT (value->>'supported')::boolean FROM jsonb_array_elements(${JSON.stringify([...unique.values()])}::jsonb)
    ON CONFLICT(subject, transaction_ref) DO UPDATE SET ambiguous = bank_transaction_identities.ambiguous OR EXCLUDED.ambiguous OR bank_transaction_identities.evidence <> EXCLUDED.evidence
    RETURNING transaction_ref, ambiguous`;
  return z
    .array(z.object({ transaction_ref: z.string(), ambiguous: z.boolean() }))
    .parse(rows);
}
export async function setTransactionOverride(subject: string, raw: unknown) {
  const override = transactionOverrideInputSchema.parse(raw);
  await ensureSchema();
  const sql = database();
  if ("labels" in override) {
    await sql`DELETE FROM bank_transaction_overrides WHERE subject = ${subject} AND transaction_ref = ${override.transaction_ref}`;
    return null;
  }
  const { transaction_ref, ...labels } = override;
  const rows =
    await sql`INSERT INTO bank_transaction_overrides(subject, transaction_ref, labels)
    SELECT subject, transaction_ref, ${JSON.stringify(labels)}::jsonb FROM bank_transaction_identities WHERE subject = ${subject} AND transaction_ref = ${transaction_ref} AND NOT ambiguous
    ON CONFLICT(subject, transaction_ref) DO UPDATE SET labels = EXCLUDED.labels RETURNING transaction_ref`;
  if (!rows.length)
    throw new TransactionInputError(
      "Override refused. Refresh the transaction and use a supported, unambiguous transaction_ref.",
    );
  return override;
}
