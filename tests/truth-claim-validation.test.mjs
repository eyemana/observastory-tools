import assert from "node:assert/strict";
import test from "node:test";

import { validateClaimIds } from "../truth/claim-validation.mjs";

function claim(overrides = {}) {
  return {
    id: "harbor.owner",
    truth: "true",
    subject: "Harbor",
    statement: "The city owns the harbor.",
    source: { path: "Notes/One.md", line: 1 },
    ...overrides
  };
}

test("repeated identical authored claim IDs are valid occurrences", () => {
  const errors = validateClaimIds([
    claim(),
    claim({ source: { path: "Characters/Mara.md", line: 8 } })
  ]);

  assert.deepEqual(errors, []);
});

test("repeated claim IDs with conflicting content fail clearly", () => {
  const errors = validateClaimIds([
    claim(),
    claim({
      statement: "The guild owns the harbor.",
      source: { path: "Characters/Mara.md", line: 8 }
    })
  ]);

  assert.equal(errors.length, 1);
  assert.match(errors[0], /Conflicting claim id "harbor\.owner"/);
});
