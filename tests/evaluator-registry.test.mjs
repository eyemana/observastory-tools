import assert from "node:assert/strict";
import test from "node:test";

import { createEvaluatorRegistry } from "../evaluators/evaluator-registry.mjs";

test("evaluator registry selects specialized evaluators and preserves a standard fallback", () => {
  const standard = () => "standard";
  const reader = () => "reader";
  const registry = createEvaluatorRegistry({
    normalizeName: value => String(value).replace(/\s+/g, "").toLowerCase(),
    specialized: { readerawareness: reader },
    fallback: standard
  });

  assert.equal(registry.resolve("Reader Awareness"), reader);
  assert.equal(registry.resolve("Pacing"), standard);
});
