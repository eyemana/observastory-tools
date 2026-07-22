import assert from "node:assert/strict";
import test from "node:test";

import {
  compareStoryOrder,
  formatPriorSceneContext,
  getChronologyOrder,
  getStoryOrder,
  isPriorChronologyScene,
  isPriorStoryScene
} from "../evaluators/scene-order-context.mjs";

test("scene order context reads author order and generated chronology separately", () => {
  const scene = {
    data: {
      chapter_order: 2,
      scene_order: 3,
      ai: { chronology: { sort: "000000000010" } }
    }
  };

  assert.deepEqual(getStoryOrder(scene), { chapterOrder: 2, sceneOrder: 3 });
  assert.equal(getChronologyOrder(scene), "000000000010");
});

test("prior-scene predicates preserve reader and chronology boundaries", () => {
  const earlier = {
    fileName: "Earlier.md",
    storyOrder: { chapterOrder: 1, sceneOrder: 2 },
    chronologyOrder: "000000000010"
  };

  assert.equal(isPriorStoryScene(earlier, { chapterOrder: 2, sceneOrder: 1 }, "Current.md"), true);
  assert.equal(isPriorChronologyScene(earlier, "000000000020", "Current.md"), true);
  assert.equal(isPriorChronologyScene(earlier, null, "Current.md"), false);
});

test("story ordering and prompt formatting remain deterministic", () => {
  const scenes = [
    { fileName: "B.md", storyOrder: null },
    { fileName: "A.md", storyOrder: { chapterOrder: 1, sceneOrder: 1 } }
  ].sort(compareStoryOrder);

  assert.deepEqual(scenes.map(scene => scene.fileName), ["A.md", "B.md"]);
  assert.match(formatPriorSceneContext([]), /No prior scene context/);
});
