import assert from "node:assert/strict";
import test from "node:test";

import { createEvaluationStore } from "../evaluators/evaluation-store.mjs";
import { createEvaluatorFamilies } from "../evaluators/evaluator-families.mjs";
import { createResponsePolicy } from "../evaluators/response-policy.mjs";

const camel = value => String(value).trim()
  .replace(/[^a-zA-Z0-9]+(.)/g, (_, letter) => letter.toUpperCase())
  .replace(/^[A-Z]/, letter => letter.toLowerCase());

test("configured evaluation flows from contract through prompt, policy, and canonical storage", async () => {
  const parsed = { data: { ai: {} } };
  const responsePolicy = createResponsePolicy({
    awarenessRationaleMode: "paraphrase",
    awarenessRationaleSources: new Set(["scene", "definitions", "priorScenes"]),
    calibrationMode: "live", calibrationModeConfig: {}, sceneLifecycleStatus: "live",
    configEntryForName: () => undefined
  });
  const store = createEvaluationStore({
    parsed, filePath: "C:/vault/Scenes/Test.md", model: "mock-model",
    profileName: "default", lifecycleStatus: "live", calibrationMode: "live",
    cacheEnabled: true, forceEvaluation: false, awarenessRationaleMode: "paraphrase",
    normalizeName: value => String(value).toLowerCase(), dimensionKey: camel,
    standardMetricValueKind: settings => settings.valueKind ?? "delta",
    now: () => "2026-07-22T00:00:00.000Z"
  });
  const configs = {
    narrator: { key: "narrators", target: "narrator", label: "narrator", pluralLabel: "narrators" },
    character: { key: "characters", target: "character", label: "character", pluralLabel: "characters" },
    arc: { key: "arcs", target: "arc", label: "arc", pluralLabel: "arcs" }
  };
  const definitions = {
    narrators: [{ name: "Hidden Voice", content: "An unseen observer focused on Joe." }],
    characters: [{ name: "Joe", content: "The apparent protagonist." }],
    arcs: [{ name: "Public Image", content: "Unknown -> local celebrity -> hero -> villain -> faceless hero." }]
  };
  const modelPrompts = [];
  const families = createEvaluatorFamilies({
    sceneContent: "Joe accepts the unseen voice. The crowd recognizes him.",
    getTargetConfig: name => configs[name],
    getTargetDefinitions: config => definitions[config.key] ?? [],
    selectStandardMetricDefinitions: values => values,
    standardMetricSettings: () => ({ rationaleMode: "off", rationaleSources: new Set() }),
    standardMetricValueKind: () => "delta", standardMetricSceneContext: () => "",
    standardMetricPriorContext: () => "", metricDefinition: () => "",
    formatDefinitions: values => values.map(value => `${value.name}: ${value.content}`).join("\n"),
    linkedTargetEntries: () => [], formatLinkedTargetEntries: () => "None.",
    listPriorScenes: () => [], listPriorChronologyScenes: () => [],
    formatPriorSceneContext: () => "No prior reader scenes.",
    formatPriorChronologyContext: () => "No prior chronology scenes.",
    formatTruthLedgerSupport: () => "No prior support.",
    responsePolicy, evaluationStore: store, dimensionKey: camel, logSkippedEvaluation: () => {},
    relationshipContractFor: () => ({
      key: "trust", metric: "Trust", dimension: "trust", valueKind: "score",
      priorContext: "chronology", observer: {
        mode: "entities", key: "characters", target: "character", storageKey: "characters"
      }, meaning: "Measure Joe's trust in the narrator.", knowledgeBoundary: "Use Joe's evidence."
    }),
    trajectoryContractFor: () => ({
      key: "trajectory", metric: "Trajectory", dimension: "trajectory",
      priorContext: "readerOrder", meaning: "Use the definition's own sequence."
    }),
    requestModelJson: async prompt => {
      modelPrompts.push(prompt);
      return prompt.includes('relationship "Trust"')
        ? { parsedResponse: { narrators: { "Hidden Voice": { Joe: {
            score: 7, salience: 6, confidence: 8, alignment: 2, evidenceStrength: 7,
            rationale: "Joe accepts the voice."
          } } } } }
        : { parsedResponse: { arcs: { "Public Image": {
            stateBefore: "Unknown", stateAfter: "Local celebrity", transition: "Recognition",
            movement: 5, clarity: 7, confidence: 8, evidenceStrength: 7,
            rationale: "The crowd recognizes him."
          } } } };
    }
  });

  await families.evaluateRelationship("Trust", "narrator");
  await families.evaluateTrajectory("Trajectory", "arc");

  assert.equal(modelPrompts.length, 2);
  assert.match(modelPrompts[0], /Measure Joe's trust/);
  assert.match(modelPrompts[1], /does not imply a\s+character arc, fixed stages/i);
  assert.equal(parsed.data.ai.observations.narrators["Hidden Voice"].trust.characters.Joe.value, 7);
  assert.equal(parsed.data.ai.observations.arcs["Public Image"].trajectory.stateAfter, "Local celebrity");
  assert.equal(parsed.data.ai.evaluationInputs.trust.narrators.version, 3);
  assert.equal(parsed.data.ai.evaluationInputs.trajectory.arcs.version, 3);
});
