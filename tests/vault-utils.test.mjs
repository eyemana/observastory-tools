import assert from "node:assert/strict";
import test from "node:test";

import { toCamelCase } from "../vault-utils.mjs";

test("canonical dimension keys preserve word boundaries and normalize acronyms", () => {
  assert.equal(toCamelCase("POV Legibility"), "povLegibility");
  assert.equal(toCamelCase("Reader Awareness"), "readerAwareness");
  assert.equal(toCamelCase("plotThreads"), "plotThreads");
});
