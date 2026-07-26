import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInlineEmbedPlan,
  findEmbedOccurrences
} from "../inline-embed-references.mjs";

const sourcePath = "Fragments/Source.md";
const sourceContent = [
  "---",
  "temporary: true",
  "---",
  "# Opening",
  "Opening prose.",
  "",
  "# Ending",
  "Ending prose. ^ending"
].join("\n");

function resolveTarget(target) {
  return target === "Source" || target === "Fragments/Source"
    ? sourcePath
    : null;
}

test("embed discovery ignores frontmatter, code, comments, and inline code", () => {
  const content = [
    "---",
    "reference: \"![[Source]]\"",
    "---",
    "![[Source]]",
    "`![[Source]]`",
    "```md",
    "![[Source]]",
    "```",
    "%% ![[Source]] %%"
  ].join("\n");

  assert.equal(findEmbedOccurrences(content).length, 1);
});

test("plan replaces whole-note, heading, and block embeds in managed and outside notes", () => {
  const plan = buildInlineEmbedPlan({
    sourcePath,
    sourceContent,
    resolveTarget,
    notes: [
      {
        path: "Scenes/One.md",
        managed: true,
        content: "Before\n![[Source#Opening]]\nAfter"
      },
      {
        path: "Characters/Mara.md",
        managed: true,
        content: "![[Fragments/Source#^ending]]"
      },
      {
        path: "Archive/Old.md",
        managed: false,
        content: "![[Source]]"
      }
    ]
  });

  assert.equal(plan.managedOccurrenceCount, 2);
  assert.equal(plan.outsideOccurrenceCount, 1);
  assert.match(plan.managedChanges[0].updatedContent, /# Opening\nOpening prose\./);
  assert.equal(plan.managedChanges[1].updatedContent, "Ending prose.");
  assert.doesNotMatch(plan.outsideChanges[0].updatedContent, /temporary: true/);
});

test("plan reports unresolved selectors before any caller writes", () => {
  const plan = buildInlineEmbedPlan({
    sourcePath,
    sourceContent,
    resolveTarget,
    notes: [{
      path: "Scenes/One.md",
      managed: true,
      content: "![[Source#Missing]]"
    }]
  });

  assert.equal(plan.errors.length, 1);
  assert.equal(plan.managedChanges.length, 0);
  assert.match(plan.errors[0].message, /Heading "Missing" was not found/);
});
