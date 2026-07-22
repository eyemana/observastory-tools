import assert from "node:assert/strict";
import test from "node:test";

import { createResponsePolicy } from "../evaluators/response-policy.mjs";

function entryForName(entries, name) {
  return entries?.[name] ?? entries?.[name.replace(/\s+/g, "")];
}

function policy(overrides = {}) {
  return createResponsePolicy({
    awarenessRationaleMode: "extractive",
    awarenessRationaleSources: new Set(["scene"]),
    calibrationMode: "draft",
    calibrationModeConfig: {
      scoreCeilings: { Pacing: 6 },
      fieldCeilings: { "Reader Awareness": { delta: 4, confidence: 7 } },
      guidance: "Treat scaffolding conservatively."
    },
    sceneLifecycleStatus: "draft",
    configEntryForName: entryForName,
    ...overrides
  });
}

test("response policy accepts only exact bounded evidence", () => {
  const response = policy().normalizeReaderAwarenessMap({
    Mara: {
      delta: 12,
      salience: 4,
      confidence: 8,
      alignment: -20,
      evidenceStrength: 3,
      evidence: ["Mara entered the vault.", "Invented evidence.", "Mara entered the vault."]
    }
  }, ["Mara"], "At dusk, Mara entered the vault.");

  assert.deepEqual(response.Mara.evidence, ["Mara entered the vault."]);
  assert.equal(response.Mara.delta, 10);
  assert.equal(response.Mara.alignment, -10);
});

test("response policy normalizes missing entity results without dropping configured targets", () => {
  const settings = {
    rationaleMode: "paraphrase",
    rationaleField: "rationale",
    rationaleType: "rationale"
  };
  const result = policy().normalizeSubjectRelationshipScoreMap(
    { Mara: { delta: 6, rationale: "Mara changes." } },
    ["Mara", "Theo"],
    "character",
    "raw",
    settings,
    ""
  );

  assert.equal(result.scene, 6);
  assert.equal(result.items.Mara.scene, 6);
  assert.equal(result.items.Theo.scene, 0);
});

test("response policy applies lifecycle calibration without losing raw values", () => {
  const responsePolicy = policy();
  const pacing = responsePolicy.applyCalibrationToStandardScores(
    { scene: 9, items: {} },
    "Pacing"
  );
  const awareness = responsePolicy.applyCalibrationToReaderAwarenessMap({
    Mara: { delta: 8, salience: 5, confidence: 9, alignment: 1, evidenceStrength: 5 }
  }, "Reader Awareness");

  assert.equal(pacing.scene, 6);
  assert.equal(pacing.rawScene, 9);
  assert.equal(awareness.Mara.delta, 4);
  assert.equal(awareness.Mara.confidence, 7);
  assert.deepEqual(awareness.Mara.calibration.raw, { delta: 8, confidence: 9 });
  assert.match(responsePolicy.calibrationPromptGuidance("Pacing"), /do not score Pacing above 6/);
});
