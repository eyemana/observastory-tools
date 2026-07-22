import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  attachComposedEvidenceProvenance,
  canonicalClaimKey,
  consolidateClaims
} from "../truth/claim-index.mjs";

test("claim consolidation preserves occurrences and detects truth conflicts", () => {
  const author = {
    id: "a", authority: "author", subject: "The Ledger",
    statement: "[[The Ledger|ledger]] is hidden.", truth: "true",
    entities: [{ type: "plotThreads", name: "The Ledger" }], source: { path: "Notes/A.md" }
  };
  const inferred = {
    id: "b", authority: "inferred", subject: "the ledger",
    statement: "The ledger is hidden!", truth: "false", confidence: 7,
    entities: [{ type: "plotThreads", name: "The Ledger" }], source: { path: "Scenes/B.md" }
  };

  assert.equal(canonicalClaimKey(author), canonicalClaimKey(inferred));
  const groups = consolidateClaims([author], [inferred]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].occurrenceCount, 2);
  assert.equal(groups[0].authority, "author");
  assert.equal(groups[0].hasConflict, true);
  assert.equal(groups[0].entities.length, 1);
});

test("composed evidence identifies the exact fragment source", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "observastory-provenance-"));
  const scene = path.join(root, "Scenes", "Scene.md");
  const fragment = path.join(root, "Scenes", "Fragments", "Childhood.md");
  fs.mkdirSync(path.dirname(fragment), { recursive: true });
  fs.writeFileSync(scene, "---\ntype: scene\n---\n![[Fragments/Childhood]]", "utf8");
  fs.writeFileSync(fragment, "First line.\nThe badge was missing.\n", "utf8");

  try {
    const claim = { support: [{ path: "Scenes/Scene.md", line: 1, excerpt: "The badge was missing." }] };
    attachComposedEvidenceProvenance(claim, {
      kind: "scene", path: scene, dependencies: [fragment]
    }, root);
    assert.equal(claim.support[0].composedFrom.kind, "fragment");
    assert.equal(claim.support[0].composedFrom.path.replace(/\\/g, "/"), "Scenes/Fragments/Childhood.md");
    assert.equal(claim.support[0].composedFrom.line, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
