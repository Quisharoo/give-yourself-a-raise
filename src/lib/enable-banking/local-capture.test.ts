import assert from "node:assert/strict";
import test from "node:test";

import { shouldCaptureEnableBankingData } from "./local-capture";

test("bank payload captures require an explicit local development opt-in", () => {
  Object.assign(process.env, { NODE_ENV: "development", ENABLE_BANKING_CAPTURE_LOCAL: "1" });
  delete process.env.VERCEL;
  assert.equal(shouldCaptureEnableBankingData(), true);
  process.env.ENABLE_BANKING_CAPTURE_LOCAL = "0";
  assert.equal(shouldCaptureEnableBankingData(), false);
  process.env.ENABLE_BANKING_CAPTURE_LOCAL = "1";
  Object.assign(process.env, { NODE_ENV: "production" });
  assert.equal(shouldCaptureEnableBankingData(), false);
  Object.assign(process.env, { NODE_ENV: "development", VERCEL: "1" });
  assert.equal(shouldCaptureEnableBankingData(), false);
});
