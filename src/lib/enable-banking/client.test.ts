import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test, { type TestContext } from "node:test";

import { getAllAccountTransactions } from "./client.ts";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

test("provider paging preserves filters, follows empty pages, and returns all 738 rows", async (context) => {
  syntheticCredentials(context);
  const keys: Array<string | null> = [];
  context.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, "/accounts/synthetic-account/transactions");
      assert.equal(url.searchParams.get("date_from"), "2026-01-01");
      assert.equal(url.searchParams.get("date_to"), "2026-02-01");
      assert.equal(url.searchParams.get("transaction_status"), "PDNG");
      const key = url.searchParams.get("continuation_key");
      keys.push(key);
      const count = key === null ? 300 : key === "empty" ? 0 : 438;
      return Response.json({
        transactions: Array.from({ length: count }, (_, i) => ({
          entry_reference: `${key}-${i}`,
        })),
        continuation_key:
          key === null ? "empty" : key === "empty" ? "final" : null,
      });
    },
  );
  const transactions = await getAllAccountTransactions("synthetic-account", {
    dateFrom: "2026-01-01",
    dateTo: "2026-02-01",
    transactionStatus: "PDNG",
  });
  assert.equal(transactions.length, 738);
  assert.deepEqual(keys, [null, "empty", "final"]);
});

test("provider paging rejects a repeated continuation key instead of looping", async (context) => {
  syntheticCredentials(context);
  let requests = 0;
  context.mock.method(globalThis, "fetch", async () => {
    requests++;
    return Response.json({
      transactions: [],
      continuation_key: "private-provider-key",
    });
  });
  await assert.rejects(
    getAllAccountTransactions("synthetic-account"),
    /paging did not advance/,
  );
  assert.equal(requests, 2);
});

function syntheticCredentials(context: TestContext) {
  const originalId = process.env.ENABLE_BANKING_APPLICATION_ID;
  const originalPem = process.env.ENABLE_BANKING_PRIVATE_KEY_PEM;
  process.env.ENABLE_BANKING_APPLICATION_ID = "synthetic-app";
  process.env.ENABLE_BANKING_PRIVATE_KEY_PEM = pem;
  context.after(() => {
    if (originalId === undefined)
      delete process.env.ENABLE_BANKING_APPLICATION_ID;
    else process.env.ENABLE_BANKING_APPLICATION_ID = originalId;
    if (originalPem === undefined)
      delete process.env.ENABLE_BANKING_PRIVATE_KEY_PEM;
    else process.env.ENABLE_BANKING_PRIVATE_KEY_PEM = originalPem;
  });
}

test("provider expiry parser accepts actual access expiry and treats missing or invalid expiry as unknown", async () => {
  const { sessionConsentExpiry } = await import("./client");
  for (const valid_until of [undefined, "not a date", "2026-02-30T00:00:00Z", "2026-11-13", 123])
    assert.equal(sessionConsentExpiry({ accounts: [], access: { valid_until } }), null);
  assert.equal(sessionConsentExpiry({ accounts: [], access: { valid_until: "2026-12-01T15:30:00+02:00" } }), "2026-12-01T13:30:00.000Z");
});
test("provider structured errors preserve EXPIRED_SESSION separately from unrelated HTTP 401", async (context) => {
  syntheticCredentials(context);
  const { getSession, EnableBankingError } = await import("./client");
  for (const code of ["EXPIRED_SESSION", "INVALID_SIGNATURE"]) {
    context.mock.method(globalThis, "fetch", async () => Response.json({ error: code, message: "private provider details" }, { status: 401 }));
    await assert.rejects(getSession("private-session"), (error: unknown) => error instanceof EnableBankingError && error.code === code && error.status === 401);
  }
});
test("a failed later provider page throws rather than returning earlier rows as a complete result", async (context) => {
  syntheticCredentials(context);
  let count = 0;
  context.mock.method(globalThis, "fetch", async () => ++count === 1 ? Response.json({ transactions: [{ entry_reference: "private" }], continuation_key: "next" }) : Response.json({ error: "ASPSP_ERROR" }, { status: 502 }));
  await assert.rejects(getAllAccountTransactions("private-account")); assert.equal(count, 2);
});
