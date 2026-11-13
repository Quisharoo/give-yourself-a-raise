import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  AUTH_COOKIE_NAME,
  AUTH_COOKIE_MAX_AGE_SECONDS,
  createAuthSessionToken,
  getAuthCookieOptions,
  hasAuthConfig,
  readAuthConfig,
  verifyAuthSessionToken,
} from "./session.ts";

beforeEach(() => {
  process.env.PRIVATE_PLUGIN_SUBJECT = "user_private_owner";
  process.env.APP_LOGIN_PASSWORD = "test-password";
  process.env.APP_LOGIN_SECRET = "test-signing-secret";
});

test("fallback sessions expire on the server after twelve hours", () => {
  const issuedAt = 1_800_000_000;
  const token = createAuthSessionToken(issuedAt);
  assert.equal(verifyAuthSessionToken(token, issuedAt), true);
  assert.equal(verifyAuthSessionToken(token, issuedAt + AUTH_COOKIE_MAX_AGE_SECONDS - 1), true);
  assert.equal(verifyAuthSessionToken(token, issuedAt + AUTH_COOKIE_MAX_AGE_SECONDS), false);
  assert.equal(verifyAuthSessionToken(token, issuedAt - 1), false);
});

test("fallback sessions bind the configured owner and signing secret", () => {
  const token = createAuthSessionToken();
  process.env.PRIVATE_PLUGIN_SUBJECT = "user_other";
  assert.equal(verifyAuthSessionToken(token), false);
  delete process.env.PRIVATE_PLUGIN_SUBJECT;
  assert.equal(verifyAuthSessionToken(token), false);
  assert.throws(() => createAuthSessionToken());
  process.env.PRIVATE_PLUGIN_SUBJECT = "user_private_owner";
  process.env.APP_LOGIN_SECRET = "changed-signing-secret";
  assert.equal(verifyAuthSessionToken(token), false);
});

test("fallback sessions reject legacy, malformed and tampered claims", () => {
  const now = 1_800_000_000;
  const legacy = `v1.${createHmac("sha256", "test-signing-secret").update("v1").digest("hex")}`;
  assert.equal(verifyAuthSessionToken(legacy, now), false);
  const token = createAuthSessionToken(now);
  for (const value of [null, undefined, "", "v2", "v2.!.!", `${token}.extra`, `${token}x`]) {
    assert.equal(verifyAuthSessionToken(value, now), false);
  }
  const signClaims = (claims: unknown) => {
    const payload = `v2.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;
    return `${payload}.${createHmac("sha256", "test-signing-secret").update(payload).digest("hex")}`;
  };
  for (const claims of [
    null,
    { sub: "user_private_owner", iat: now, exp: now + AUTH_COOKIE_MAX_AGE_SECONDS + 1 },
    { sub: "user_private_owner", iat: now + 1, exp: now + 1 + AUTH_COOKIE_MAX_AGE_SECONDS },
    { sub: "user_private_owner", iat: now + 0.5, exp: now + 0.5 + AUTH_COOKIE_MAX_AGE_SECONDS },
    { sub: "user_private_owner", iat: String(now), exp: now + AUTH_COOKIE_MAX_AGE_SECONDS },
    { sub: "user_other", iat: now, exp: now + AUTH_COOKIE_MAX_AGE_SECONDS },
  ]) assert.equal(verifyAuthSessionToken(signClaims(claims), now), false);
  const [, encoded, signature] = token.split(".");
  const altered = Buffer.from(JSON.stringify({ sub: "user_private_owner", iat: now, exp: now + 999999 })).toString("base64url");
  assert.notEqual(encoded, altered);
  assert.equal(verifyAuthSessionToken(`v2.${altered}.${signature}`, now), false);
});

test("readAuthConfig returns the required auth settings", () => {
  process.env.APP_LOGIN_PASSWORD = "top-secret";
  process.env.APP_LOGIN_SECRET = "12345678901234567890123456789012";

  assert.deepEqual(readAuthConfig(), {
    password: "top-secret",
    secret: "12345678901234567890123456789012",
  });
});

test("readAuthConfig throws when auth env vars are missing", () => {
  delete process.env.APP_LOGIN_PASSWORD;
  delete process.env.APP_LOGIN_SECRET;

  assert.throws(() => readAuthConfig(), /APP_LOGIN_PASSWORD/);
  assert.equal(hasAuthConfig(), false);
});

test("createAuthSessionToken produces a verifiable token", () => {
  process.env.APP_LOGIN_PASSWORD = "top-secret";
  process.env.APP_LOGIN_SECRET = "12345678901234567890123456789012";

  const token = createAuthSessionToken();

  assert.equal(typeof token, "string");
  assert.equal(verifyAuthSessionToken(token), true);
  assert.equal(hasAuthConfig(), true);
});

test("verifyAuthSessionToken rejects a tampered token", () => {
  process.env.APP_LOGIN_PASSWORD = "top-secret";
  process.env.APP_LOGIN_SECRET = "12345678901234567890123456789012";

  const token = createAuthSessionToken();
  const tamperedToken = `${token}x`;

  assert.equal(verifyAuthSessionToken(tamperedToken), false);
});

test("getAuthCookieOptions marks cookies as httpOnly and lax", () => {
  const env = process.env as Record<string, string | undefined>;
  const originalNodeEnv = process.env.NODE_ENV;
  env.NODE_ENV = "production";

  assert.deepEqual(getAuthCookieOptions(), {
    httpOnly: true,
    maxAge: 60 * 60 * 12,
    path: "/",
    sameSite: "lax",
    secure: true,
  });

  env.NODE_ENV = originalNodeEnv;
});

test("AUTH_COOKIE_NAME is stable", () => {
  assert.equal(AUTH_COOKIE_NAME, "gyr-auth");
});
