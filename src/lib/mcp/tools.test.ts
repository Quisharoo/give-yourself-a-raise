import assert from "node:assert/strict";
import test from "node:test";

import { MCP_ACCESS_SCOPE } from "./auth.ts";
import { CHATGPT_TOOLS } from "./tools.ts";

test("publishes the private Revolut tool set", () => {
  assert.deepEqual(
    CHATGPT_TOOLS.map((tool) => tool.name),
    [
      "get_connection_status",
      "get_account_summary",
      "summarize_spending",
      "find_transactions",
      "compare_spending_periods",
    ],
  );
});

test("marks every banking tool read-only and OAuth protected", () => {
  for (const tool of CHATGPT_TOOLS) {
    assert.equal(tool.annotations?.readOnlyHint, true);
    assert.equal(tool.annotations?.destructiveHint, false);
    assert.deepEqual(tool.securitySchemes, [{ scopes: [MCP_ACCESS_SCOPE], type: "oauth2" }]);
    assert.deepEqual(tool._meta?.securitySchemes, tool.securitySchemes);
  }
});
