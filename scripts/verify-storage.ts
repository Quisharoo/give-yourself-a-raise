import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { FinancialRule } from "../src/lib/analysis/classification";
import type {
  FetchAttempt,
  FetchRequest,
  FetchSuccess,
} from "../src/lib/connections/store";

type SqlRow = Record<string, unknown>;
type SqlValue = string | number | boolean | null | undefined;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appRequire = createRequire(join(repoRoot, "package.json"));
const commandEnv = {
  PATH: process.env.PATH,
  LC_ALL: "C",
  TZ: "UTC",
  NODE_ENV: "test",
} satisfies NodeJS.ProcessEnv;
const owner = "storage-verification-owner";
const otherOwner = "storage-verification-other-owner";
const nullMarker = `null-${randomUUID()}`;
const expectedRules = [
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
] satisfies FinancialRule[];

function parseCsv(output: string): SqlRow[] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < output.length; index++) {
    const character = output[index];
    if (character === '"') {
      if (quoted && output[index + 1] === '"') {
        field += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && character === ",") {
      row.push(field);
      field = "";
    } else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && output[index + 1] === "\n") index++;
      row.push(field);
      records.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  assert.equal(quoted, false, "psql returned an unterminated CSV field");
  if (field !== "" || row.length > 0) records.push([...row, field]);
  const [headers, ...values] = records;
  if (!headers) return [];
  return values.map((columns) => {
    assert.equal(columns.length, headers.length, "psql CSV column count");
    return Object.fromEntries(
      headers.map((header, index) => {
        const value = columns[index];
        if (value === nullMarker) return [header, null];
        if (
          ["request", "last_success", "rule"].includes(header) &&
          value !== undefined
        ) {
          const parsed: unknown = JSON.parse(value);
          return [header, parsed];
        }
        return [header, value];
      }),
    );
  });
}

function quoteSql(value: SqlValue): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    assert(Number.isFinite(value), "SQL numbers must be finite");
    return String(value);
  }
  if (typeof value === "boolean") return String(value);
  assert(!value.includes("\0"), "PostgreSQL text cannot contain NUL");
  return `'${value.replaceAll("'", "''")}'`;
}

async function main() {
  for (const command of ["initdb", "pg_ctl", "psql"]) {
    try {
      execFileSync(command, ["--version"], { env: commandEnv, stdio: "pipe" });
    } catch {
      throw new Error(
        `Storage verification requires ${command} on PATH. Install PostgreSQL locally, then rerun npx tsx scripts/verify-storage.ts.`,
      );
    }
  }

  const fixture = mkdtempSync(join(tmpdir(), "gyar-storage-"));
  const dataDirectory = join(fixture, "data");
  const socketDirectory = join(fixture, "socket");
  const savedEnv = Object.fromEntries(
    [
      "DATABASE_URL",
      "BANK_CONNECTION_ENCRYPTION_KEY",
      "PRIVATE_PLUGIN_SUBJECT",
    ].map((key) => [key, process.env[key]]),
  );
  let queryCount = 0;
  let cleanupError: unknown;
  let afterNextSessionLookup: (() => Promise<void>) | null = null;

  function query(statement: string): SqlRow[] {
    queryCount++;
    return parseCsv(
      execFileSync(
        "psql",
        [
          "-X",
          "-q",
          "--csv",
          "--no-password",
          "-v",
          "ON_ERROR_STOP=1",
          "--pset",
          `null=${nullMarker}`,
          "-h",
          socketDirectory,
          "-p",
          "5432",
          "-U",
          "storage_fixture",
          "-d",
          "postgres",
          "-c",
          statement,
        ],
        {
          encoding: "utf8",
          env: commandEnv,
          stdio: ["ignore", "pipe", "pipe"],
        },
      ),
    );
  }

  async function sql(
    strings: TemplateStringsArray,
    ...values: SqlValue[]
  ): Promise<SqlRow[]> {
    const statement = strings.reduce(
      (text, part, index) =>
        text + part + (index < values.length ? quoteSql(values[index]) : ""),
      "",
    );
    const rows = query(statement);
    if (
      afterNextSessionLookup &&
      /^\s*SELECT encrypted_session_id FROM bank_connections/.test(statement)
    ) {
      const reconnect = afterNextSessionLookup;
      afterNextSessionLookup = null;
      await reconnect();
    }
    return rows;
  }

  let restoreNeon = () => {};
  try {
    mkdirSync(socketDirectory, { mode: 0o700 });
    assert(
      Buffer.byteLength(join(socketDirectory, ".s.PGSQL.5432")) < 104,
      "Temporary directory path is too long for a PostgreSQL socket. Set TMPDIR to a shorter private directory.",
    );
    execFileSync(
      "initdb",
      [
        "-D",
        dataDirectory,
        "-U",
        "storage_fixture",
        "--auth=trust",
        "--no-locale",
        "--encoding=UTF8",
      ],
      { env: commandEnv, stdio: "pipe" },
    );
    execFileSync(
      "pg_ctl",
      [
        "-D",
        dataDirectory,
        "-l",
        join(fixture, "postgres.log"),
        "-o",
        `-F -k '${socketDirectory}' -h '' -p 5432 -c unix_socket_permissions=0700`,
        "-w",
        "start",
      ],
      { env: commandEnv, stdio: "pipe" },
    );
    assert.deepEqual(
      query("SHOW listen_addresses"),
      [{ listen_addresses: "" }],
      "fixture must not listen on TCP",
    );
    assert.deepEqual(
      query(
        "SELECT '' AS empty, NULL AS absent, 'comma,quote\"and' || chr(10) || 'newline' AS text",
      ),
      [{ empty: "", absent: null, text: 'comma,quote"and\nnewline' }],
      "CSV preserves empty, NULL, comma, quote, and newline",
    );

    process.env.DATABASE_URL =
      "postgres://synthetic-local-fixture.invalid/postgres";
    process.env.BANK_CONNECTION_ENCRYPTION_KEY = Buffer.alloc(32, 29).toString(
      "base64",
    );
    process.env.PRIVATE_PLUGIN_SUBJECT = owner;
    const neonPath = appRequire.resolve("@neondatabase/serverless");
    const neonExports: unknown = appRequire(neonPath);
    const neonCache = appRequire.cache[neonPath];
    assert(
      neonCache && typeof neonExports === "object" && neonExports !== null,
    );
    neonCache.exports = { ...neonExports, neon: () => sql };
    restoreNeon = () => {
      neonCache.exports = neonExports;
    };

    const storePath = appRequire.resolve("./src/lib/connections/store.ts");
    let store: typeof import("../src/lib/connections/store") =
      appRequire(storePath);
    const crypto: typeof import("../src/lib/connections/crypto") = appRequire(
      "./src/lib/connections/crypto.ts",
    );
    await store.ensureConnectionSchema();
    assert.deepEqual(
      query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
      ),
      [
        { table_name: "bank_account_fetches" },
        { table_name: "bank_connections" },
      ],
      "fresh schema creates both connection tables",
    );
    query("DROP TABLE bank_account_fetches; DROP TABLE bank_connections");
    query(`CREATE TABLE bank_connections (
      subject TEXT PRIMARY KEY, provider_name TEXT NOT NULL, provider_country TEXT NOT NULL,
      encrypted_session_id TEXT NOT NULL, consent_expires_at TIMESTAMPTZ,
      connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    const originalSession = "synthetic-session,'quoted'\nline";
    await sql`INSERT INTO bank_connections(subject, provider_name, provider_country, encrypted_session_id, consent_expires_at, connected_at)
      VALUES (${owner}, ${'Synthetic, "Bank"\nFixture'}, ${"IE"}, ${crypto.encryptBankSessionId(originalSession)}, ${"2026-12-13T12:00:00Z"}, ${"2026-11-01T12:00:00Z"})`;
    delete appRequire.cache[storePath];
    store = appRequire(storePath);
    const connection = await store.getBankConnection(owner);
    assert(connection);
    assert.match(connection.connectionId, /^[0-9a-f-]{36}$/);
    assert.deepEqual(
      { ...connection, connectionId: "generated" },
      {
        connectionId: "generated",
        connectedAt: "2026-11-01T12:00:00.000Z",
        consentExpiresAt: "2026-12-13T12:00:00.000Z",
        country: "IE",
        provider: 'Synthetic, "Bank"\nFixture',
        sessionId: originalSession,
        subject: owner,
      },
      "legacy migration preserves encrypted connection and metadata",
    );
    assert.equal(await store.getBankConnection(otherOwner), null);
    const encrypted = query(
      `SELECT encrypted_session_id FROM bank_connections WHERE subject = ${quoteSql(owner)}`,
    )[0]?.encrypted_session_id;
    assert.equal(typeof encrypted, "string");
    assert.notEqual(encrypted, originalSession, "session is encrypted at rest");
    assert.equal(
      typeof encrypted === "string" && encrypted.includes(originalSession),
      false,
    );

    const request = {
      date_from: "2026-10-01",
      date_to: "2026-11-13",
      status: "BOOK",
    } satisfies FetchRequest;
    const success = {
      ...request,
      completed_at: "2026-11-13T12:00:00Z",
      pagination_complete: true,
      history_complete: "unknown",
      returned_count: 1,
      earliest_transaction_date: "2026-11-01",
      latest_transaction_date: "2026-11-01",
      latest_booked_transaction_date: "2026-11-01",
    } satisfies FetchSuccess;
    const attempt = {
      connection,
      accountRef: "acc_synthetic",
      resource: "transactions",
      attemptId: "attempt-one",
    } satisfies FetchAttempt;
    assert.equal(await store.beginAccountFetch(attempt, request), true);
    await store.finishAccountFetch(attempt, { success });
    let observations = await store.getAccountFetchObservations(connection);
    assert.equal(observations.length, 1);
    const observedAt = observations[0]?.last_attempt_at;
    assert.equal(typeof observedAt, "string");
    assert(observedAt && Number.isFinite(Date.parse(observedAt)));
    assert.deepEqual(
      observations,
      [
        {
          account_ref: attempt.accountRef,
          resource: "transactions",
          last_attempt_at: observedAt,
          last_result: "success",
          error_code: null,
          request,
          last_success: success,
        },
      ],
      "success metadata roundtrips exactly",
    );
    const nextAttempt = { ...attempt, attemptId: "attempt-two" };
    assert.equal(await store.beginAccountFetch(nextAttempt, request), true);
    await store.finishAccountFetch(attempt, { errorCode: "late_failure" });
    observations = await store.getAccountFetchObservations(connection);
    assert.equal(
      observations[0]?.last_result,
      "running",
      "late result cannot finish newer attempt",
    );
    assert.deepEqual(observations[0]?.last_success, success);
    await store.finishAccountFetch(nextAttempt, {
      errorCode: "provider_unavailable",
    });
    observations = await store.getAccountFetchObservations(connection);
    assert.equal(observations[0]?.last_result, "failed");
    assert.equal(observations[0]?.error_code, "provider_unavailable");
    assert.deepEqual(observations[0]?.request, request);
    assert.deepEqual(
      observations[0]?.last_success,
      success,
      "failure retains previous successful coverage",
    );

    await store.saveBankConnection({
      subject: otherOwner,
      provider: "Other synthetic bank",
      country: "IE",
      sessionId: "other-synthetic-session",
    });
    const otherConnection = await store.getBankConnection(otherOwner);
    assert(otherConnection);
    assert.deepEqual(
      await store.getAccountFetchObservations({
        subject: otherOwner,
        connectionId: connection.connectionId,
      }),
      [],
    );
    assert.equal(
      await store.beginAccountFetch(
        {
          ...attempt,
          connection: {
            subject: otherOwner,
            connectionId: connection.connectionId,
          },
        },
        request,
      ),
      false,
    );
    const otherAttempt = { ...attempt, connection: otherConnection };
    assert.equal(await store.beginAccountFetch(otherAttempt, request), true);
    await store.finishAccountFetch(otherAttempt, {
      success: { ...success, returned_count: 7 },
    });
    assert.equal(
      (await store.getAccountFetchObservations(otherConnection))[0]
        ?.last_success?.returned_count,
      7,
    );
    assert.deepEqual(
      (await store.getAccountFetchObservations(connection))[0]?.last_success,
      success,
      "same account reference is isolated by owner",
    );

    await store.saveBankConnection({
      subject: owner,
      provider: "Synthetic replacement",
      country: "IE",
      sessionId: "synthetic-session-two",
    });
    const replacement = await store.getBankConnection(owner);
    assert(replacement);
    assert.notEqual(replacement.connectionId, connection.connectionId);
    assert.equal(replacement.sessionId, "synthetic-session-two");
    assert.equal(replacement.consentExpiresAt, null);
    assert.equal(
      await store.beginAccountFetch(attempt, request),
      false,
      "old connection cannot start a fetch",
    );
    await store.finishAccountFetch(nextAttempt, {
      success: { ...success, returned_count: 99 },
    });
    await store.updateConsentExpiry(connection, "2027-01-01T00:00:00Z");
    assert.equal(
      (await store.getBankConnection(owner))?.consentExpiresAt,
      null,
      "old connection cannot update consent",
    );
    assert.deepEqual(await store.getAccountFetchObservations(connection), []);
    assert.deepEqual(await store.getAccountFetchObservations(replacement), []);
    const replacementAttempt = {
      ...attempt,
      connection: replacement,
      attemptId: "attempt-replacement",
    };
    assert.equal(
      await store.beginAccountFetch(replacementAttempt, request),
      true,
    );
    observations = await store.getAccountFetchObservations(replacement);
    assert.equal(
      observations[0]?.last_success,
      null,
      "reconnection does not inherit prior coverage",
    );
    await store.finishAccountFetch(nextAttempt, { success });
    assert.equal(
      (await store.getAccountFetchObservations(replacement))[0]?.last_result,
      "running",
    );
    assert.equal(
      await store.deleteBankConnection(owner, originalSession),
      false,
      "stale session cannot disconnect replacement",
    );
    assert.equal(
      (await store.getBankConnection(owner))?.connectionId,
      replacement.connectionId,
    );
    afterNextSessionLookup = async () => {
      await store.saveBankConnection({
        subject: owner,
        provider: "Concurrent synthetic replacement",
        country: "IE",
        sessionId: "synthetic-session-three",
      });
    };
    assert.equal(
      await store.deleteBankConnection(owner, "synthetic-session-two"),
      false,
      "concurrent reconnection survives disconnect compare-and-delete",
    );
    assert.equal(
      afterNextSessionLookup,
      null,
      "concurrent reconnection ran between lookup and delete",
    );
    assert.equal(
      (await store.getBankConnection(owner))?.sessionId,
      "synthetic-session-three",
    );
    assert.equal(
      await store.deleteBankConnection(owner, "synthetic-session-three"),
      true,
    );
    assert.equal(await store.getBankConnection(owner), null);
    assert.deepEqual(
      query(
        `SELECT account_ref FROM bank_account_fetches WHERE subject = ${quoteSql(owner)}`,
      ),
      [],
      "disconnect cascades only owner's fetch state",
    );
    assert.equal(
      (await store.getBankConnection(otherOwner))?.sessionId,
      "other-synthetic-session",
    );
    assert.equal(
      (await store.getAccountFetchObservations(otherConnection))[0]
        ?.last_success?.returned_count,
      7,
    );

    const rules: typeof import("../src/lib/analysis/rule-store") = appRequire(
      "./src/lib/analysis/rule-store.ts",
    );
    const sortedRules = [...expectedRules].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    assert.deepEqual(
      rules.INITIAL_OWNER_RULES,
      expectedRules,
      "initial owner rules have the intended exact values",
    );
    assert.deepEqual(
      await rules.listFinancialRules(otherOwner),
      [],
      "other owner is never seeded",
    );
    assert.deepEqual(
      await rules.listFinancialRules(owner),
      sortedRules,
      "owner rules persist with exact values",
    );
    assert.deepEqual(
      query(
        `SELECT rule FROM bank_financial_rules WHERE subject = ${quoteSql(owner)} ORDER BY rule_id`,
      ),
      sortedRules.map((rule) => ({ rule })),
    );
    const override: FinancialRule = {
      ...expectedRules[0],
      purpose: "personal",
      project: 'Synthetic override, "quoted"\nline',
    };
    await sql`UPDATE bank_financial_rules SET rule = ${JSON.stringify(override)}::jsonb WHERE subject = ${owner} AND rule_id = ${override.id}`;
    const overriddenRules = sortedRules.map((rule) =>
      rule.id === override.id ? override : rule,
    );
    assert.deepEqual(
      await rules.listFinancialRules(owner),
      overriddenRules,
      "idempotent seed preserves stored override",
    );
    assert.deepEqual(
      await rules.listFinancialRules(owner),
      overriddenRules,
      "repeat seed remains idempotent",
    );
    assert.deepEqual(
      await rules.listFinancialRules(otherOwner),
      [],
      "owner seed and override never leak",
    );
    assert.deepEqual(
      query(
        "SELECT subject, count(*)::text AS count FROM bank_financial_rules GROUP BY subject ORDER BY subject",
      ),
      [{ subject: owner, count: String(expectedRules.length) }],
    );
  } finally {
    restoreNeon();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (existsSync(join(dataDirectory, "postmaster.pid"))) {
      try {
        execFileSync(
          "pg_ctl",
          ["-D", dataDirectory, "-m", "immediate", "-w", "stop"],
          { env: commandEnv, stdio: "pipe" },
        );
      } catch (error) {
        cleanupError = error;
      }
    }
    if (!cleanupError) rmSync(fixture, { recursive: true, force: true });
    if (cleanupError)
      throw new Error(
        `Could not stop owned PostgreSQL fixture. Run pg_ctl -D ${dataDirectory} -m immediate -w stop, then remove ${fixture}.`,
        { cause: cleanupError },
      );
  }
  console.log(
    JSON.stringify({
      result: "PASS",
      synthetic_postgres_queries: queryCount,
      checks: [
        "fresh schema",
        "legacy schema migration",
        "encrypted session roundtrip",
        "successful fetch metadata",
        "failed fetch retains success",
        "late attempt guard",
        "owner isolation",
        "reconnection generation guards",
        "disconnect compare and delete",
        "persisted owner rules",
        "idempotent seed preserves override",
        "other owner has no seed or leak",
      ],
    }),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
