import test from "node:test";
import assert from "node:assert/strict";

import { getSafeNextPath, isPublicPath } from "./paths.ts";

test("allows the login page", () => {
  assert.equal(isPublicPath("/login"), true);
});

test("allows the auth routes", () => {
  assert.equal(isPublicPath("/api/auth/login"), true);
  assert.equal(isPublicPath("/api/auth/logout"), true);
});

test("allows the enable banking callback route", () => {
  assert.equal(isPublicPath("/api/enable-banking/callback"), true);
});

test("protects the main app routes", () => {
  assert.equal(isPublicPath("/"), false);
  assert.equal(isPublicPath("/debug"), false);
  assert.equal(isPublicPath("/api/enable-banking/connect"), false);
});

test("treats next internals and static assets as public", () => {
  assert.equal(isPublicPath("/_next/static/chunks/app.js"), true);
  assert.equal(isPublicPath("/favicon.ico"), true);
});

test("getSafeNextPath keeps only internal absolute paths", () => {
  assert.equal(getSafeNextPath("/debug"), "/debug");
  assert.equal(getSafeNextPath("https://evil.example"), "/");
  assert.equal(getSafeNextPath("//evil.example"), "/");
  assert.equal(getSafeNextPath("debug"), "/");
});
