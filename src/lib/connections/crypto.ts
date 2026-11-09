import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";

export function encryptBankSessionId(sessionId: string) {
  const key = readEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(sessionId, "utf8"), cipher.final()]);

  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptBankSessionId(payload: string) {
  const [version, encodedIv, encodedTag, encodedCiphertext] = payload.split(".");

  if (version !== VERSION || !encodedIv || !encodedTag || !encodedCiphertext) {
    throw new Error("Stored bank connection has an unsupported encryption format.");
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    readEncryptionKey(),
    Buffer.from(encodedIv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function readEncryptionKey() {
  const encodedKey = process.env.BANK_CONNECTION_ENCRYPTION_KEY?.trim();

  if (!encodedKey) {
    throw new Error("BANK_CONNECTION_ENCRYPTION_KEY is required.");
  }

  const key = Buffer.from(encodedKey, "base64");

  if (key.length !== 32) {
    throw new Error("BANK_CONNECTION_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }

  return key;
}
