import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  listTruthLedgerSources,
  truthLedgerInferenceInput,
  truthLedgerSourceFingerprint
} from "../truth/truth-sources.mjs";

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "observastory-truth-sources-"));

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
  }

  return root;
}

function config() {
  return {
    story: {
      root: "",
      folders: {
        scenes: "Scenes",
        notes: "Notes"
      }
    },
    truthLedger: {
      folders: ["notes", "scenes"]
    },
    evaluation: {
      elementFilters: { excludeStatuses: ["scratch", "archived", "inactive"] },
      sceneFilters: { excludeStatuses: ["scratch", "archived", "inactive"] }
    },
    sceneComposition: { maxDepth: 5 }
  };
}

function sourceNames(sources) {
  return sources.map(source => source.relativePath.replace(/\\/g, "/"));
}

test("truth sources include definitions and official scenes but omit ordinary fragments", () => {
  const root = fixture({
    "Notes/World.md": "The harbor belongs to the city.",
    "Notes/Scratch.md": "---\nstatus: scratch\n---\nDiscarded worldbuilding.",
    "Scenes/Opening.md": "---\ntype: scene\n---\n![[Fragments/Arrival]]",
    "Scenes/Scratch Scene.md": "---\ntype: scene\nstatus: scratch\n---\nDiscarded scene.",
    "Scenes/Fragments/Arrival.md": "Mara arrives.",
    "Scenes/Fragments/Unused.md": "Unpublished possibility."
  });

  try {
    const sources = listTruthLedgerSources({ config: config(), vaultRoot: root });

    assert.deepEqual(sourceNames(sources), ["Notes/World.md", "Scenes/Opening.md"]);
    assert.deepEqual(sources.map(source => source.kind), ["note", "scene"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("official scene inference expands fragments and its fingerprint follows dependencies", () => {
  const root = fixture({
    "Scenes/Opening.md": "---\ntype: scene\n---\nBefore.\n\n![[Fragments/Arrival]]\n\nAfter.",
    "Scenes/Fragments/Arrival.md": "Mara arrives."
  });

  try {
    const [source] = listTruthLedgerSources({ config: config(), vaultRoot: root });
    const content = truthLedgerInferenceInput(source, config());
    const first = truthLedgerSourceFingerprint(source, config());

    assert.match(content, /Before[\s\S]*Mara arrives[\s\S]*After/);
    assert.equal(source.dependencies.length, 1);

    fs.writeFileSync(path.join(root, "Scenes/Fragments/Arrival.md"), "Mara returns.", "utf8");
    const second = truthLedgerSourceFingerprint(source, config());
    assert.notEqual(first, second);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a fragment contributes only explicit author claims and is never inferred independently", () => {
  const root = fixture({
    "Scenes/Claim Fragment.md": [
      "> [!claim] childhood.arm",
      "> truth: true",
      "> statement: Joe broke his arm when he was eight."
    ].join("\n"),
    "Scenes/Ordinary Fragment.md": "A discarded possibility."
  });

  try {
    const sources = listTruthLedgerSources({ config: config(), vaultRoot: root });

    assert.deepEqual(sourceNames(sources), ["Scenes/Claim Fragment.md"]);
    assert.equal(sources[0].kind, "fragment");
    assert.equal(sources[0].hasAuthoredClaims, true);
    assert.equal(sources[0].infer, false);
    assert.equal(truthLedgerInferenceInput(sources[0], config()), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("shared fragments contribute through each owning official scene, not as a third source", () => {
  const root = fixture({
    "Scenes/First.md": "---\ntype: scene\n---\n![[Fragments/Infancy]]",
    "Scenes/Second.md": "---\ntype: scene\n---\n![[Fragments/Infancy]]",
    "Scenes/Fragments/Infancy.md": "Joe remembers the blue room."
  });

  try {
    const sources = listTruthLedgerSources({ config: config(), vaultRoot: root });

    assert.deepEqual(sourceNames(sources), ["Scenes/First.md", "Scenes/Second.md"]);
    assert.equal(
      sources.filter(source => /blue room/.test(truthLedgerInferenceInput(source, config()))).length,
      2
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
