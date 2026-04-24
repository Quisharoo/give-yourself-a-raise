import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTH_COOKIE_NAME,
  createAuthSessionToken,
  getAuthCookieOptions,
  hasAuthConfig,
  readAuthConfig,
  verifyAuthSessionToken,
} from "./session.ts";

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
