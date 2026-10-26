import assert from "node:assert/strict";
import test from "node:test";
import { applicationName } from "../../src/index.ts";

test("exports the application name", () => {
  assert.equal(applicationName, "PsyAlien ShopSystem");
});
