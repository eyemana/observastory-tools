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
    writeTrajectoryObservations: (...args) => writes.push(args)
  };
  const families = createEvaluatorFamilies({
    sceneContent: "Mara waits at the harbor.",
    getTargetConfig: name => targetConfigs[name],
    getTargetDefinitions: () => [],
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

test("standard evaluator skips an unreferenced target set without a model call", async () => {
  const { families, writes, marks } = familyFixture();
  const updated = await families.evaluateStandardMetric("Tension", "character");

  assert.equal(updated, false);
  assert.equal(writes.length, 0);
  assert.equal(marks.length, 0);
});

test("configured relationship evaluator handles arbitrary observer-target pairs", async () => {
  const writes = [];
  const configs = {
    narrator: { key: "narrators", target: "narrator", label: "narrator", pluralLabel: "narrators" },
    character: { key: "characters", target: "character", label: "character", pluralLabel: "characters" }
  };
  const { families } = familyFixture({
    getTargetConfig: name => configs[name],
    getTargetDefinitions: config => config.key === "narrators"
      ? [{ name: "Hidden Voice", content: "An unseen narrator." }]
      : [{ name: "Joe", content: "The protagonist." }],
    relationshipContractFor: () => ({
      key: "trust", metric: "Trust", dimension: "trust", valueKind: "score",
      priorContext: "chronology",
      observer: { mode: "entities", target: "character", key: "characters", storageKey: "characters" },
      meaning: "Measure Joe's trust.", knowledgeBoundary: "Only Joe's available evidence."
    }),
    evaluationStore: {
      evaluationInputHash: () => "hash", shouldSkipEvaluation: () => false,
      markEvaluationInput: () => {},
      writeRelationshipObservations: (...args) => writes.push(args),
      writeStandardMetricObservations: () => {}, writeTrajectoryObservations: () => {}
    },
    requestModelJson: async () => ({ parsedResponse: {
      narrators: { "Hidden Voice": { Joe: {
        score: 7, salience: 6, confidence: 5, alignment: 1, evidenceStrength: 8,
        rationale: "Joe accepts the account."
      } } }
    } })
  });

  assert.equal(await families.evaluateRelationship("Trust", "narrator"), true);
  assert.equal(writes[0][2]["Hidden Voice"].Joe.score, 7);
  assert.equal(writes[0][3][0].name, "Joe");
});

test("configured trajectory evaluator does not require an arc target or fixed stages", async () => {
  const writes = [];
  const motif = { key: "motifs", target: "motif", label: "motif", pluralLabel: "motifs" };
  const { families } = familyFixture({
    getTargetConfig: () => motif,
    getTargetDefinitions: () => [{ name: "Weather", content: "Cycles between shelter and exposure." }],
    trajectoryContractFor: () => ({
      key: "change", metric: "Change", dimension: "change", priorContext: "readerOrder",
      meaning: "Use the motif's cyclical model."
    }),
    evaluationStore: {
      evaluationInputHash: () => "hash", shouldSkipEvaluation: () => false,
      markEvaluationInput: () => {}, writeRelationshipObservations: () => {},
      writeStandardMetricObservations: () => {},
      writeTrajectoryObservations: (...args) => writes.push(args)
    },
    requestModelJson: async () => ({ parsedResponse: {
      motifs: { Weather: {
        stateBefore: "Shelter", stateAfter: "Exposure", transition: "The storm opens",
        movement: 6, clarity: 7, confidence: 8, evidenceStrength: 7, rationale: "Weather changes."
      } }
    } })
  });

  assert.equal(await families.evaluateTrajectory("Change", "motif"), true);
  assert.equal(writes[0][2].Weather.stateAfter, "Exposure");
});
