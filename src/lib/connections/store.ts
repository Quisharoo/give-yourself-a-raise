import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  decryptBankSessionId,
  encryptBankSessionId,
} from "@/lib/connections/crypto";

export interface BankConnection {
  connectionId: string;
  connectedAt: string;
  consentExpiresAt: string | null;
  country: string;
  provider: string;
  sessionId: string;
  subject: string;
}

interface StoredConnectionRow {
  connection_id: string;
  connected_at: Date | string;
  consent_expires_at: Date | string | null;
  encrypted_session_id: string;
  provider_country: string;
  provider_name: string;
  subject: string;
}

let schemaPromise: Promise<void> | null = null;

export async function saveBankConnection(input: {
  consentExpiresAt?: string | null;
  country: string;
  provider: string;
  sessionId: string;
  subject: string;
}) {
  const sql = getSql();
  await ensureConnectionSchema();
  const encryptedSessionId = encryptBankSessionId(input.sessionId);

  await sql`
    INSERT INTO bank_connections (
      subject,
      provider_name,
      provider_country,
      encrypted_session_id,
      connection_id,
      consent_expires_at
    ) VALUES (
      ${input.subject},
      ${input.provider},
      ${input.country},
      ${encryptedSessionId},
      ${randomUUID()},
      ${input.consentExpiresAt ?? null}
    )
    ON CONFLICT (subject) DO UPDATE SET
      provider_name = EXCLUDED.provider_name,
      provider_country = EXCLUDED.provider_country,
      encrypted_session_id = EXCLUDED.encrypted_session_id,
      connection_id = EXCLUDED.connection_id,
      consent_expires_at = EXCLUDED.consent_expires_at,
      connected_at = NOW(),
      updated_at = NOW()
  `;
}

export async function getBankConnection(
  subject: string,
): Promise<BankConnection | null> {
  const sql = getSql();
  await ensureConnectionSchema();
  const rows = (await sql`
    SELECT
      subject,
      connection_id,
      provider_name,
      provider_country,
      encrypted_session_id,
      consent_expires_at,
      connected_at
    FROM bank_connections
    WHERE subject = ${subject}
    LIMIT 1
  `) as StoredConnectionRow[];
  const row = rows[0];

  if (!row) {
    return null;
  }

  return {
    connectionId: row.connection_id,
    connectedAt: toIsoString(row.connected_at),
    consentExpiresAt: row.consent_expires_at
      ? toIsoString(row.consent_expires_at)
      : null,
    country: row.provider_country,
    provider: row.provider_name,
    sessionId: decryptBankSessionId(row.encrypted_session_id),
    subject: row.subject,
  };
}

export async function deleteBankConnection(
  subject: string,
  expectedSessionId: string,
): Promise<boolean> {
  const sql = getSql();
  await ensureConnectionSchema();
  const rows = await sql`
    SELECT encrypted_session_id FROM bank_connections WHERE subject = ${subject} LIMIT 1
  `;
  const encryptedSessionId = rows[0]?.encrypted_session_id;
  if (
    typeof encryptedSessionId !== "string" ||
    decryptBankSessionId(encryptedSessionId) !== expectedSessionId
  ) {
    return false;
  }
  const deleted = await sql`
    DELETE FROM bank_connections
    WHERE subject = ${subject} AND encrypted_session_id = ${encryptedSessionId}
    RETURNING subject
  `;
  return deleted.length > 0;
}

export async function ensureConnectionSchema() {
  schemaPromise ??= createSchema().catch((error) => {
    schemaPromise = null;
    throw error;
  });

  return schemaPromise;
}

async function createSchema() {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS bank_connections (
      subject TEXT PRIMARY KEY,
      provider_name TEXT NOT NULL,
      provider_country TEXT NOT NULL,
      encrypted_session_id TEXT NOT NULL,
      consent_expires_at TIMESTAMPTZ,
      connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE bank_connections ADD COLUMN IF NOT EXISTS connection_id TEXT NOT NULL DEFAULT gen_random_uuid()::text`;
  await sql`
    CREATE TABLE IF NOT EXISTS bank_account_fetches (
      subject TEXT NOT NULL REFERENCES bank_connections(subject) ON DELETE CASCADE,
      connection_id TEXT NOT NULL,
      account_ref TEXT NOT NULL,
      resource TEXT NOT NULL CHECK (resource IN ('balances', 'transactions')),
      attempt_id TEXT NOT NULL,
      last_attempt_at TIMESTAMPTZ NOT NULL,
      last_result TEXT NOT NULL CHECK (last_result IN ('running', 'success', 'failed')),
      error_code TEXT,
      request JSONB NOT NULL,
      last_success JSONB,
      PRIMARY KEY (subject, account_ref, resource)
    )
  `;
}

const requestSchema = z.object({
  date_from: z.string().nullable(),
  date_to: z.string().nullable(),
  status: z.string().nullable(),
});
const successSchema = z.object({
  ...requestSchema.shape,
  completed_at: z.string(),
  pagination_complete: z.literal(true),
  history_complete: z.literal("unknown"),
  returned_count: z.number().int().nonnegative(),
  earliest_transaction_date: z.string().nullable(),
  latest_transaction_date: z.string().nullable(),
  latest_booked_transaction_date: z.string().nullable(),
});
const observationSchema = z.object({
  account_ref: z.string(),
  resource: z.enum(["balances", "transactions"]),
  last_attempt_at: z.union([z.string(), z.date()]).transform(toIsoString),
  last_result: z.enum(["running", "success", "failed"]),
  error_code: z.string().nullable(),
  request: requestSchema,
  last_success: successSchema.nullable(),
});
export type FetchRequest = z.infer<typeof requestSchema>;
export type FetchSuccess = z.infer<typeof successSchema>;
export type AccountFetchObservation = z.infer<typeof observationSchema>;
export type FetchResource = AccountFetchObservation["resource"];
export interface FetchAttempt {
  connection: Pick<BankConnection, "subject" | "connectionId">;
  accountRef: string;
  resource: FetchResource;
  attemptId: string;
}

export async function updateConsentExpiry(
  connection: BankConnection,
  expiresAt: string | null,
) {
  const sql = getSql();
  await ensureConnectionSchema();
  await sql`UPDATE bank_connections SET consent_expires_at = ${expiresAt}, updated_at = NOW()
    WHERE subject = ${connection.subject} AND connection_id = ${connection.connectionId}`;
}

export async function beginAccountFetch(
  attempt: FetchAttempt,
  request: FetchRequest,
): Promise<boolean> {
  const sql = getSql();
  await ensureConnectionSchema();
  const rows = await sql`
    INSERT INTO bank_account_fetches (
      subject, connection_id, account_ref, resource, attempt_id, last_attempt_at, last_result, request
    ) SELECT subject, connection_id, ${attempt.accountRef}, ${attempt.resource}, ${attempt.attemptId}, clock_timestamp(), 'running', ${JSON.stringify(request)}::jsonb
      FROM bank_connections WHERE subject = ${attempt.connection.subject} AND connection_id = ${attempt.connection.connectionId}
    ON CONFLICT (subject, account_ref, resource) DO UPDATE SET
      connection_id = EXCLUDED.connection_id, attempt_id = EXCLUDED.attempt_id,
      last_attempt_at = EXCLUDED.last_attempt_at, last_result = 'running', error_code = NULL, request = EXCLUDED.request,
      last_success = CASE WHEN bank_account_fetches.connection_id = EXCLUDED.connection_id THEN bank_account_fetches.last_success ELSE NULL END
    RETURNING account_ref
  `;
  return rows.length > 0;
}

export async function finishAccountFetch(
  attempt: FetchAttempt,
  result: { success: FetchSuccess } | { errorCode: string },
) {
  const sql = getSql();
  await ensureConnectionSchema();
  await sql`UPDATE bank_account_fetches SET
      last_result = ${"success" in result ? "success" : "failed"},
      error_code = ${"errorCode" in result ? result.errorCode : null},
      last_success = CASE WHEN ${"success" in result} THEN ${"success" in result ? JSON.stringify(result.success) : null}::jsonb ELSE last_success END
    WHERE subject = ${attempt.connection.subject} AND connection_id = ${attempt.connection.connectionId}
      AND account_ref = ${attempt.accountRef} AND resource = ${attempt.resource} AND attempt_id = ${attempt.attemptId}
      AND EXISTS (SELECT 1 FROM bank_connections c WHERE c.subject = bank_account_fetches.subject AND c.connection_id = bank_account_fetches.connection_id)
  `;
}

export async function getAccountFetchObservations(
  connection: Pick<BankConnection, "subject" | "connectionId">,
): Promise<AccountFetchObservation[]> {
  const sql = getSql();
  await ensureConnectionSchema();
  const rows =
    await sql`SELECT account_ref, resource, last_attempt_at, last_result, error_code, request, last_success
    FROM bank_account_fetches WHERE subject = ${connection.subject} AND connection_id = ${connection.connectionId}
      AND EXISTS (SELECT 1 FROM bank_connections c WHERE c.subject = bank_account_fetches.subject AND c.connection_id = bank_account_fetches.connection_id)
    ORDER BY account_ref, resource`;
  return z.array(observationSchema).parse(rows);
}

function getSql() {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required to persist private bank connections.",
    );
  }

  return neon(databaseUrl);
}

function toIsoString(value: Date | string) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
