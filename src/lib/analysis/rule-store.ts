import { neon } from "@neondatabase/serverless";
import { financialRuleSchema, type FinancialRule } from "./classification";
import { z } from "zod";

export const INITIAL_OWNER_RULES: FinancialRule[] = [
  {
    id: "owner-apple-business",
    priority: 100,
    merchant_key: "apple",
    direction: "debit",
    except_amount: { currency: "EUR", amount: "9.99" },
    purpose: "business",
    project: null,
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
let schemaPromise: Promise<void> | null = null;
export async function listFinancialRules(
  subject: string,
): Promise<FinancialRule[]> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl)
    throw new Error("DATABASE_URL is required for financial rules.");
  const sql = neon(databaseUrl);
  schemaPromise ??= sql`CREATE TABLE IF NOT EXISTS bank_financial_rules (
    subject TEXT NOT NULL, rule_id TEXT NOT NULL, rule JSONB NOT NULL, PRIMARY KEY(subject, rule_id)
  )`
    .then(() => {})
    .catch((error) => {
      schemaPromise = null;
      throw error;
    });
  await schemaPromise;
  if (subject === process.env.PRIVATE_PLUGIN_SUBJECT?.trim()) {
    for (const rule of INITIAL_OWNER_RULES)
      await sql`INSERT INTO bank_financial_rules(subject, rule_id, rule)
      VALUES (${subject}, ${rule.id}, ${JSON.stringify(rule)}::jsonb) ON CONFLICT(subject, rule_id) DO NOTHING`;
  }
  const rows =
    await sql`SELECT rule FROM bank_financial_rules WHERE subject = ${subject} ORDER BY rule_id`;
  return z
    .array(z.object({ rule: financialRuleSchema }))
    .parse(rows)
    .map((row) => row.rule);
}
