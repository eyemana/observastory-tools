import assert from "node:assert/strict";
import test from "node:test";

import { EVALUATION_INPUT_HASH_VERSION } from "../evaluators/evaluation-store.mjs";
import { evaluationMetadataIsCurrent } from "../status/freshness.mjs";

test("freshness accepts the evaluator store's current metadata version", () => {
  assert.equal(
    evaluationMetadataIsCurrent({
      version: EVALUATION_INPUT_HASH_VERSION,
      inputHash: "current-input"
    }),
    true
  );
  assert.equal(
    evaluationMetadataIsCurrent({
      version: EVALUATION_INPUT_HASH_VERSION - 1,
      inputHash: "old-input"
    }),
    false
  );
  assert.equal(
    evaluationMetadataIsCurrent({
      version: EVALUATION_INPUT_HASH_VERSION,
      inputHash: ""
    }),
    false
  );
});
