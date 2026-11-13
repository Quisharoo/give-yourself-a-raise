import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { beforeEach } from "node:test";
import { encryptBankSessionId } from "./crypto";

const require = createRequire(import.meta.url);
const neonPath = require.resolve("@neondatabase/serverless");
const original: Record<string, unknown> = require(neonPath);
const loaded = require.cache[neonPath];
assert.ok(loaded);
let stored: { subject: string; encrypted_session_id: string } | null;
let replacementOnDelete: string | null = null;
loaded.exports = {
  ...original,
  neon: () => async (strings: TemplateStringsArray, ...values: string[]) => {
    const query = strings.join("?");
    if (query.includes("CREATE TABLE") || query.includes("ALTER TABLE")) return [];
    if (query.includes("SELECT")) return stored && stored.subject === values[0] ? [{ ...stored }] : [];
    if (query.includes("DELETE")) {
      if (replacementOnDelete && stored) stored.encrypted_session_id = replacementOnDelete;
      if (stored?.subject === values[0] && (!query.includes("encrypted_session_id") || stored.encrypted_session_id === values[1])) {
        stored = null;
        return [{ subject: values[0] }];
      }
      return [];
    }
    throw new Error("Unexpected database operation in disconnect test");
  },
};
const { deleteBankConnection }: typeof import("./store") = require("./store");

beforeEach(() => {
  process.env.DATABASE_URL = "postgres://fixture.invalid/test";
  process.env.BANK_CONNECTION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  stored = { subject: "owner", encrypted_session_id: encryptBankSessionId("old-session") };
  replacementOnDelete = null;
});

test("disconnect removes the matching saved connection", async () => {
  assert.equal(await deleteBankConnection("owner", "old-session"), true);
  assert.equal(stored, null);
});

test("disconnect preserves a replacement saved before the row is read", async () => {
  stored = { subject: "owner", encrypted_session_id: encryptBankSessionId("new-session") };
  assert.equal(await deleteBankConnection("owner", "old-session"), false);
  assert.ok(stored);
});

test("disconnect preserves a replacement saved between comparison and deletion", async () => {
  replacementOnDelete = encryptBankSessionId("new-session");
  assert.equal(await deleteBankConnection("owner", "old-session"), false);
  assert.equal(stored?.encrypted_session_id, replacementOnDelete);
});

test("disconnect ignores an already absent connection", async () => {
  stored = null;
  assert.equal(await deleteBankConnection("owner", "old-session"), false);
});
