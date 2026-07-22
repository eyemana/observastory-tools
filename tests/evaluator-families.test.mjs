import assert from "node:assert/strict";
import test from "node:test";

import { createEvaluatorFamilies } from "../evaluators/evaluator-families.mjs";
import { createResponsePolicy } from "../evaluators/response-policy.mjs";

function responsePolicy() {
  return createResponsePolicy({
    awarenessRationaleMode: "paraphrase",
    awarenessRationaleSources: new Set(["scene", "definitions", "priorScenes"]),
    calibrationMode: "draft",
    calibrationModeConfig: {},
    sceneLifecycleStatus: "draft",
    configEntryForName: () => undefined
  });
}

function familyFixture(overrides = {}) {
  const writes = [];
  const marks = [];
  const targetConfigs = {
    character: {
      key: "characters",
      target: "character",
      label: "character",
      pluralLabel: "characters",
      entityType: "character",
      sceneOnly: false
    },
    "plot thread": {
      key: "plotThreads",
      target: "plot thread",
      label: "plot thread",
      pluralLabel: "plot threads",
      entityType: "plotThread",
      sceneOnly: false
    }
  };
  const evaluationStore = {
    evaluationInputHash: () => "hash",
    shouldSkipEvaluation: () => false,
    markEvaluationInput: (...args) => marks.push(args),
    writeStandardMetricObservations: (...args) => writes.push(args),
    writeCharacterAwarenessObservations: (...args) => writes.push(args),
    writeReaderAwarenessObservations: (...args) => writes.push(args)
  };
  const families = createEvaluatorFamilies({
    sceneContent: "Mara waits at the harbor.",
    getTargetConfig: name => targetConfigs[name],
    getTargetDefinitions: () => [],
    selectStandardMetricDefinitions: definitions => definitions,
    standardMetricSettings: () => ({
      rationaleMode: "paraphrase",
      rationaleField: "rationale",
      rationaleType: "rationale",
      rationaleSources: new Set(["scene"]),
      contextFields: [],
      valueKind: "delta",
      priorContext: null
    }),
    standardMetricValueKind: settings => settings.valueKind,
    standardMetricSceneContext: () => "",
    standardMetricPriorContext: () => "",
    metricDefinition: () => "Metric definition",
    formatDefinitions: definitions => JSON.stringify(definitions),
    linkedTargetEntries: () => [],
    formatLinkedTargetEntries: () => "None.",
    listPriorScenes: () => [],
    listPriorChronologyScenes: () => [],
    formatPriorSceneContext: () => "No prior scenes.",
    formatPriorChronologyContext: () => "No prior chronology.",
    formatTruthLedgerSupport: () => "No support.",
    responsePolicy: responsePolicy(),
    evaluationStore,
    requestModelJson: async () => { throw new Error("Model should not run"); },
    dimensionKey: value => value.replace(/\s+(.)/g, (_, letter) => letter.toUpperCase()),
    logSkippedEvaluation: () => {},
    ...overrides
  });

  return { families, writes, marks, targetConfigs };
}

test("standard evaluator handles an empty configured target set without a model call", async () => {
  const { families, writes, marks } = familyFixture();
  const updated = await families.evaluateStandardMetric("Tension", "character");

  assert.equal(updated, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][2].scene, 0);
  assert.deepEqual(writes[0][2].items, {});
  assert.equal(marks.length, 1);
});

test("character-awareness evaluator rejects unsupported targets before model work", async () => {
  const { families } = familyFixture();
  await assert.rejects(
    families.evaluateCharacterAwareness("character"),
    /only supports target "plot thread"/
  );
});
