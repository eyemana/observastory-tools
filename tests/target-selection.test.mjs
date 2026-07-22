import assert from "node:assert/strict";
import test from "node:test";
import { selectReferencedDefinitions } from "../evaluators/target-selection.mjs";
import { getStoryConfig } from "../tool-config.mjs";

const definitions = ["Joe", "Theo Vale", "Mara"].map(name => ({ name }));
const targetConfig = {
  key: "characters",
  definitionConfig: { referenceFields: ["characters", "pov"] }
};

test("selects targets named in metadata or Obsidian links", () => {
  const selected = selectReferencedDefinitions({
    definitions,
    sceneData: { characters: ["[[Joe]]"], pov: "Mara" },
    sceneContent: "Theo arrives: [[Theo Vale|Theo]].",
    targetConfig
  });
  assert.deepEqual(selected.map(item => item.name), ["Joe", "Theo Vale", "Mara"]);
});

test("selects no relationship targets when a scene has no callouts", () => {
  assert.deepEqual(selectReferencedDefinitions({
    definitions, sceneData: {}, sceneContent: "Nobody is named.", targetConfig
  }), []);
});

test("explicit all mode remains available as an intentional override", () => {
  assert.equal(selectReferencedDefinitions({
    definitions, sceneData: {}, sceneContent: "", targetConfig, selection: { mode: "all" }
  }).length, 3);
});

test("partial entity overrides retain default reference fields", () => {
  const story = getStoryConfig({ story: { entityTypes: {
    narrators: { label: "voice" }
  } } });
  assert.deepEqual(story.entityTypes.narrators.referenceFields, ["narrators", "narrator", "pov"]);
  assert.equal(story.entityTypes.narrators.label, "voice");
});
