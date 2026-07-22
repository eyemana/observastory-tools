import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createTruthLedgerContext } from "../evaluators/truth-ledger-context.mjs";

test("truth context separates reader-visible support from author support", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "observastory-truth-context-"));
  const ledgerPath = path.join(root, "ledger.json");
  fs.writeFileSync(ledgerPath, JSON.stringify({
    claims: [{
      id: "harbor.owner",
      authority: "author",
      statement: "Mara owns the harbor ledger.",
      entities: [{ type: "characters", name: "Mara Vale" }],
      support: [{
        path: "Notes/Canon.md",
        line: 4,
        excerpt: "Mara owns the harbor ledger."
      }]
    }],
    inferredClaims: [{
      id: "inferred.arrival",
      authority: "inferred",
      statement: "Mara has reached the harbor.",
      characters: ["Mara Vale"],
      support: [{
        path: "Scenes/Opening.md",
        line: 2,
        excerpt: "Mara stepped onto the pier."
      }]
    }]
  }), "utf8");

  try {
    const context = createTruthLedgerContext({
      config: { truthLedger: { outputPath: ledgerPath } },
      toolRoot: root,
      normalizeTargetName: value => String(value).trim()
    });
    const text = context.formatSupport(
      { key: "characters", label: "character" },
      ["Mara Vale"],
      [{ path: "Scenes/Opening.md" }],
      "Reader-visible support"
    );

    assert.match(text, /Reader-visible support:[\s\S]*Scenes\/Opening\.md/);
    assert.match(text, /Author support[\s\S]*Notes\/Canon\.md/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
