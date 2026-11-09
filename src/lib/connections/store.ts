import { neon } from "@neondatabase/serverless";

import { decryptBankSessionId, encryptBankSessionId } from "@/lib/connections/crypto";

export interface BankConnection {
  connectedAt: string;
  consentExpiresAt: string | null;
  country: string;
  provider: string;
  sessionId: string;
  subject: string;
}

interface StoredConnectionRow {
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
      consent_expires_at
    ) VALUES (
      ${input.subject},
      ${input.provider},
      ${input.country},
      ${encryptedSessionId},
      ${input.consentExpiresAt ?? null}
    )
    ON CONFLICT (subject) DO UPDATE SET
      provider_name = EXCLUDED.provider_name,
      provider_country = EXCLUDED.provider_country,
      encrypted_session_id = EXCLUDED.encrypted_session_id,
      consent_expires_at = EXCLUDED.consent_expires_at,
      connected_at = NOW(),
      updated_at = NOW()
  `;
}

export async function getBankConnection(subject: string): Promise<BankConnection | null> {
  const sql = getSql();
  await ensureConnectionSchema();
  const rows = await sql`
    SELECT
      subject,
      provider_name,
      provider_country,
      encrypted_session_id,
      consent_expires_at,
      connected_at
    FROM bank_connections
    WHERE subject = ${subject}
    LIMIT 1
  ` as StoredConnectionRow[];
  const row = rows[0];

  if (!row) {
    return null;
  }

  return {
    connectedAt: toIsoString(row.connected_at),
    consentExpiresAt: row.consent_expires_at ? toIsoString(row.consent_expires_at) : null,
    country: row.provider_country,
    provider: row.provider_name,
    sessionId: decryptBankSessionId(row.encrypted_session_id),
    subject: row.subject,
  };
}

export async function deleteBankConnection(subject: string) {
  const sql = getSql();
  await ensureConnectionSchema();
  await sql`DELETE FROM bank_connections WHERE subject = ${subject}`;
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
}

function getSql() {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to persist private bank connections.");
  }

  return neon(databaseUrl);
}

function toIsoString(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
