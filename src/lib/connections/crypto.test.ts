import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import { decryptBankSessionId, encryptBankSessionId } from "./crypto.ts";

test("encrypts and decrypts an Enable Banking session ID", () => {
  const previousKey = process.env.BANK_CONNECTION_ENCRYPTION_KEY;
  process.env.BANK_CONNECTION_ENCRYPTION_KEY = randomBytes(32).toString("base64");

  try {
    const encrypted = encryptBankSessionId("session-private-123");

    assert.notEqual(encrypted, "session-private-123");
    assert.equal(decryptBankSessionId(encrypted), "session-private-123");
  } finally {
    restoreEnvironment("BANK_CONNECTION_ENCRYPTION_KEY", previousKey);
  }
});

test("rejects tampered ciphertext", () => {
  const previousKey = process.env.BANK_CONNECTION_ENCRYPTION_KEY;
  process.env.BANK_CONNECTION_ENCRYPTION_KEY = randomBytes(32).toString("base64");

  try {
    const encrypted = encryptBankSessionId("session-private-123");
    assert.throws(() => decryptBankSessionId(`${encrypted}x`));
  } finally {
    restoreEnvironment("BANK_CONNECTION_ENCRYPTION_KEY", previousKey);
  }
});

test("requires a 32-byte encryption key", () => {
  const previousKey = process.env.BANK_CONNECTION_ENCRYPTION_KEY;
  process.env.BANK_CONNECTION_ENCRYPTION_KEY = Buffer.from("too-short").toString("base64");

  try {
    assert.throws(() => encryptBankSessionId("session-private-123"), /32-byte key/);
  } finally {
    restoreEnvironment("BANK_CONNECTION_ENCRYPTION_KEY", previousKey);
  }
});

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
