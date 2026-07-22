import assert from "node:assert/strict";
import test from "node:test";

import { buildFragmentImpacts } from "../status/dependency-impact.mjs";

test("fragment impact index identifies every owning official scene", () => {
  assert.deepEqual(buildFragmentImpacts([
    {
      path: "Scenes/Birth.md",
      compositionDependencies: ["Scenes/Fragments/Infancy.md"]
    },
    {
      path: "Scenes/Flashback.md",
      compositionDependencies: [
        "Scenes/Fragments/Infancy.md",
        "Scenes/Fragments/Secret.md"
      ]
    }
  ]), [
    {
      fragmentPath: "Scenes/Fragments/Infancy.md",
      scenes: ["Scenes/Birth.md", "Scenes/Flashback.md"]
    },
    {
      fragmentPath: "Scenes/Fragments/Secret.md",
      scenes: ["Scenes/Flashback.md"]
    }
  ]);
});
