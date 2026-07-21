import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  listSceneFiles,
  resolveSceneText,
  sceneCompositionFingerprint,
  SceneCompositionError
} from "../scene-composition.mjs";

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "observastory-composition-"));

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
  }

  return root;
}

function removeFixture(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

test("official scenes are discovered recursively while fragments are excluded", () => {
  const root = fixture({
    "One.md": "---\ntype: scene\n---\nOne",
    "Fragments/Part.md": "Part",
    "Nested/Two.md": "---\ntype: Scene\n---\nTwo"
  });

  try {
    assert.deepEqual(
      listSceneFiles(root).map((filePath) => path.relative(root, filePath).replace(/\\/g, "/")),
      ["Nested/Two.md", "One.md"]
    );
  } finally {
    removeFixture(root);
  }
});

test("ordinary links remain and nested fragment embeds expand without frontmatter", () => {
  const root = fixture({
    "Scene.md": "---\ntype: scene\npov: Mara\n---\nBefore [[Theo Vale]].\n\n![[Fragments/Part]]\n\nAfter.",
    "Fragments/Part.md": "---\nnote: ignored\n---\nPart one.\n\n![[Nested]]",
    "Fragments/Nested.md": "Nested prose."
  });

  try {
    const result = resolveSceneText(path.join(root, "Scene.md"), { scenesRoot: root });
    assert.match(result.content, /Before \[\[Theo Vale\]\]\./);
    assert.match(result.content, /Part one\./);
    assert.match(result.content, /Nested prose\./);
    assert.doesNotMatch(result.content, /note: ignored/);
    assert.equal(result.dependencies.length, 2);
  } finally {
    removeFixture(root);
  }
});

test("heading and block embeds select only requested prose", () => {
  const root = fixture({
    "Scene.md": "---\ntype: scene\n---\n![[Fragments/Parts#Wanted]]\n\n![[Fragments/Blocks#^keeper]]",
    "Fragments/Parts.md": "# Other\nNo.\n\n# Wanted\nYes.\n\n## Child\nAlso yes.\n\n# Later\nNo.",
    "Fragments/Blocks.md": "Discard.\n\nKeep this sentence. ^keeper\n\nDiscard again."
  });

  try {
    const content = resolveSceneText(path.join(root, "Scene.md"), { scenesRoot: root }).content;
    assert.match(content, /# Wanted/);
    assert.match(content, /Also yes\./);
    assert.match(content, /Keep this sentence\./);
    assert.doesNotMatch(content, /# Other|# Later|Discard/);
  } finally {
    removeFixture(root);
  }
});

test("embed syntax in code or comments is left untouched", () => {
  const root = fixture({
    "Scene.md": "---\ntype: scene\n---\n`![[Fragments/Part]]`\n\n```md\n![[Fragments/Part]]\n```\n\n%% ![[Fragments/Part]] %%",
    "Fragments/Part.md": "Expanded"
  });

  try {
    const content = resolveSceneText(path.join(root, "Scene.md"), { scenesRoot: root }).content;
    assert.equal((content.match(/!\[\[Fragments\/Part\]\]/g) ?? []).length, 3);
    assert.doesNotMatch(content, /Expanded/);
  } finally {
    removeFixture(root);
  }
});

test("self embeds, official-scene embeds, and excessive depth fail clearly", () => {
  const selfRoot = fixture({
    "Scene.md": "---\ntype: scene\n---\n![[Scene]]"
  });
  const sceneRoot = fixture({
    "One.md": "---\ntype: scene\n---\n![[Two]]",
    "Two.md": "---\ntype: scene\n---\nTwo"
  });
  const depthRoot = fixture({
    "Scene.md": "---\ntype: scene\n---\n![[A]]",
    "A.md": "![[B]]",
    "B.md": "![[C]]",
    "C.md": "End"
  });

  try {
    assert.throws(
      () => resolveSceneText(path.join(selfRoot, "Scene.md"), { scenesRoot: selfRoot }),
      (error) => error instanceof SceneCompositionError && /Circular or self-referential/.test(error.message)
    );
    assert.throws(
      () => resolveSceneText(path.join(sceneRoot, "One.md"), { scenesRoot: sceneRoot }),
      (error) => error instanceof SceneCompositionError && /cannot embed another official scene/i.test(error.message)
    );
    assert.throws(
      () => resolveSceneText(path.join(depthRoot, "Scene.md"), { scenesRoot: depthRoot, maxDepth: 2 }),
      (error) => error instanceof SceneCompositionError && /maximum depth of 2/.test(error.message)
    );
  } finally {
    removeFixture(selfRoot);
    removeFixture(sceneRoot);
    removeFixture(depthRoot);
  }
});

test("changing a fragment changes the root scene fingerprint", () => {
  const root = fixture({
    "Scene.md": "---\ntype: scene\n---\n![[Part]]",
    "Part.md": "First version."
  });

  try {
    const scenePath = path.join(root, "Scene.md");
    const first = sceneCompositionFingerprint(scenePath, { scenesRoot: root });
    fs.writeFileSync(path.join(root, "Part.md"), "Second version.", "utf8");
    const second = sceneCompositionFingerprint(scenePath, { scenesRoot: root });
    assert.notEqual(first, second);
  } finally {
    removeFixture(root);
  }
});
