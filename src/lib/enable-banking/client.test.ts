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
