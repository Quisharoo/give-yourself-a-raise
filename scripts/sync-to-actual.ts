/**
 * Enable Banking → Actual Budget bridge.
 *
 * First run (interactive): prompts you to map each EB account to an Actual account.
 * Subsequent runs (idempotent): pulls transactions and imports — Actual dedupes on imported_id.
 *
 * Usage:
 *   npx tsx scripts/sync-to-actual.ts            # default: last 30 days
 *   npx tsx scripts/sync-to-actual.ts --days 90  # backfill 90 days
 *   npx tsx scripts/sync-to-actual.ts --remap    # rerun the account-mapping prompt
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";

import {
  getSessionOverview,
  getAllAccountTransactions,
} from "../src/lib/enable-banking/client";
import type {
  EnableBankingAccountSnapshot,
  EnableBankingTransaction,
} from "../src/lib/enable-banking/types";

const REPO = process.cwd();
const LOCAL_DIR = join(REPO, ".local");
const SESSION_PATH = join(LOCAL_DIR, "eb-session.json");
const MAP_PATH = join(LOCAL_DIR, "account-map.json");
const ACTUAL_DATA_DIR = join(LOCAL_DIR, "actual-data");

loadEnv({ path: join(REPO, ".env.local") });
loadEnv({ path: join(REPO, ".env") });

type AccountMap = Record<string, string>; // EB account uid -> Actual account id

interface CliArgs {
  days: number;
  remap: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let days = 30;
  let remap = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--days") days = Number(args[++i]);
    else if (args[i] === "--remap") remap = true;
  }
  return { days, remap };
}

function loadSessionId(): string {
  if (!existsSync(SESSION_PATH)) {
    throw new Error(
      `No Enable Banking session found at ${SESSION_PATH}. Run \`npm run dev\`, link Revolut in the browser, then retry.`,
    );
  }
  const { session_id } = JSON.parse(readFileSync(SESSION_PATH, "utf8")) as {
    session_id: string;
  };
  if (!session_id) throw new Error("eb-session.json is missing session_id");
  return session_id;
}

function readActualEnv() {
  const serverURL = process.env.ACTUAL_SERVER_URL?.trim();
  const password = process.env.ACTUAL_PASSWORD?.trim();
  const syncId = process.env.ACTUAL_SYNC_ID?.trim();
  if (!serverURL || !password || !syncId) {
    throw new Error(
      "Set ACTUAL_SERVER_URL, ACTUAL_PASSWORD, ACTUAL_SYNC_ID in .env.local",
    );
  }
  return { serverURL, password, syncId };
}

function toActualAmount(t: EnableBankingTransaction): number {
  const cents = Math.round(parseFloat(t.transaction_amount.amount) * 100);
  return t.credit_debit_indicator === "DBIT" ? -Math.abs(cents) : Math.abs(cents);
}

function pickPayee(t: EnableBankingTransaction): string {
  const isOutflow = t.credit_debit_indicator === "DBIT";
  const counterparty = isOutflow ? t.creditor?.name : t.debtor?.name;
  if (counterparty?.trim()) return counterparty.trim();
  const remit = t.remittance_information?.find((r) => r.trim().length > 0);
  return remit?.trim() ?? "(unknown)";
}

function pickDate(t: EnableBankingTransaction): string | null {
  const d = t.booking_date || t.transaction_date || t.value_date;
  return d ?? null;
}

function pickImportedId(t: EnableBankingTransaction): string | undefined {
  return t.transaction_id ?? t.entry_reference ?? undefined;
}

function transformTransactions(account: EnableBankingAccountSnapshot) {
  return account.transactions
    .map((t) => {
      const date = pickDate(t);
      if (!date) return null;
      return {
        date,
        amount: toActualAmount(t),
        payee_name: pickPayee(t),
        notes: (t.remittance_information ?? []).join(" ").trim() || undefined,
        imported_id: pickImportedId(t),
        cleared: t.status?.toUpperCase() === "BOOK",
      };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);
}

async function ensureMapping(
  api: typeof import("@actual-app/api"),
  ebAccounts: EnableBankingAccountSnapshot[],
  remap: boolean,
): Promise<AccountMap> {
  if (!remap && existsSync(MAP_PATH)) {
    return JSON.parse(readFileSync(MAP_PATH, "utf8")) as AccountMap;
  }

  const actualAccounts = await api.getAccounts();
  console.log("\nActual accounts:");
  actualAccounts.forEach((a, i) => console.log(`  [${i}] ${a.name} (${a.id})`));

  const rl = createInterface({ input, output });
  const map: AccountMap = {};
  for (const eb of ebAccounts) {
    const label = eb.name || eb.iban || eb.accountId;
    const ans = await rl.question(
      `\nEB account ${label} (uid=${eb.accountId})\n  pick Actual index (or 's' to skip): `,
    );
    if (ans.trim().toLowerCase() === "s") continue;
    const idx = Number(ans);
    const target = actualAccounts[idx];
    if (!target) {
      console.log(`  → invalid index, skipping ${label}`);
      continue;
    }
    map[eb.accountId] = target.id;
    console.log(`  → mapped to ${target.name}`);
  }
  rl.close();

  await mkdir(LOCAL_DIR, { recursive: true });
  await writeFile(MAP_PATH, `${JSON.stringify(map, null, 2)}\n`, "utf8");
  console.log(`\nWrote ${MAP_PATH}`);
  return map;
}

async function main() {
  const { days, remap } = parseArgs();
  const sessionId = loadSessionId();
  const { serverURL, password, syncId } = readActualEnv();

  const since = new Date();
  since.setDate(since.getDate() - days);
  const dateFrom = since.toISOString().slice(0, 10);

  console.log(`Pulling EB session ${sessionId} since ${dateFrom}…`);
  const overview = await getSessionOverview(sessionId, {
    transactions: { dateFrom },
  } as Parameters<typeof getSessionOverview>[1]);

  if (!overview.accounts.length) {
    console.log("No accounts in session. Re-link in the browser.");
    return;
  }

  // Re-fetch each account's full window (overview may cap)
  for (const acct of overview.accounts) {
    acct.transactions = await getAllAccountTransactions(acct.accountId, {
      dateFrom,
    });
  }

  const api = await import("@actual-app/api");
  await mkdir(ACTUAL_DATA_DIR, { recursive: true });
  await api.init({ dataDir: ACTUAL_DATA_DIR, serverURL, password });
  await api.downloadBudget(syncId);

  try {
    const map = await ensureMapping(api, overview.accounts, remap);

    for (const acct of overview.accounts) {
      const target = map[acct.accountId];
      if (!target) {
        console.log(`Skipping unmapped EB account ${acct.name || acct.accountId}`);
        continue;
      }
      const txns = transformTransactions(acct).map((t) => ({ ...t, account: target }));
      if (!txns.length) {
        console.log(`No transactions for ${acct.name || acct.accountId}`);
        continue;
      }
      const result = await api.importTransactions(target, txns);
      console.log(
        `Imported ${result.added.length} new, ${result.updated.length} updated to ${acct.name || acct.accountId}`,
      );
    }

    await api.sync();
    console.log("Synced.");
  } finally {
    await api.shutdown();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
