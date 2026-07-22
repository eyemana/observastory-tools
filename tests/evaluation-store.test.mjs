import assert from "node:assert/strict";
import test from "node:test";

import { createEvaluationStore } from "../evaluators/evaluation-store.mjs";

function createStore(parsed, overrides = {}) {
  return createEvaluationStore({
    parsed,
    filePath: "C:/vault/Scenes/Opening.md",
    model: "test-model",
    profileName: "default",
    lifecycleStatus: "draft",
    calibrationMode: "draft",
    cacheEnabled: true,
    forceEvaluation: false,
    awarenessRationaleMode: "paraphrase",
    normalizeName: value => String(value).trim().toLowerCase(),
    dimensionKey: value => {
      const camel = String(value).replace(/\s+(.)/g, (_, letter) => letter.toUpperCase());
      return camel[0].toLowerCase() + camel.slice(1);
    },
    standardMetricValueKind: (settings, target) => settings.valueKind ?? (target.sceneOnly ? "score" : "delta"),
    now: () => "2026-07-22T00:00:00.000Z",
    ...overrides
  });
}

test("evaluation store hashes inputs and skips only matching completed work", () => {
  const parsed = { data: { ai: { observations: {} } } };
  const store = createStore(parsed);
  const first = store.evaluationInputHash("Pacing", "Scene", "prompt one");
  const second = store.evaluationInputHash("Pacing", "Scene", "prompt two");
  assert.notEqual(first, second);
  assert.equal(store.shouldSkipEvaluation("pacing", "scene", first), false);

  parsed.data.ai.observations.scene = { Opening: { pacing: { value: 4 } } };
  store.markEvaluationInput("pacing", "scene", first, "Pacing", "Scene");
  assert.equal(store.shouldSkipEvaluation("pacing", "scene", first), true);
  assert.equal(store.shouldSkipEvaluation("pacing", "scene", second), false);
});

test("evaluation store owns standard and relationship observation shapes", () => {
  const parsed = { data: { ai: {} } };
  const store = createStore(parsed);
  const characterTarget = {
    key: "characters",
    entityType: "character",
    label: "character",
    sceneOnly: false
  };

  store.writeStandardMetricObservations(
    "Tension",
    characterTarget,
    { items: { Mara: { scene: 7, rationale: "Pressure rises." } } },
    { valueKind: "delta", rationaleMode: "paraphrase", rationaleField: "rationale" }
  );
  store.writeRelationshipObservations({
    key: "readerAwareness", metric: "Reader Awareness", dimension: "awareness", valueKind: "delta",
    observer: { mode: "constant", type: "reader", name: "Reader", key: "reader", storageKey: "reader" }
  }, characterTarget, {
    Mara: { Reader: {
      delta: 3,
      salience: 4,
      confidence: 5,
      alignment: 2,
      evidenceStrength: 6,
      rationale: "The reader notices Mara."
    } }
  }, [{ type: "reader", name: "Reader" }]);

  const observation = parsed.data.ai.observations.characters.Mara;
  assert.equal(observation.tension.values.delta, 7);
  assert.equal(observation.tension.rationale, "Pressure rises.");
  assert.equal(observation.awareness.reader.observer.name, "Reader");
  assert.equal(observation.awareness.reader.value, 3);
});

test("evaluation store persists generic relationships and trajectories canonically", () => {
  const parsed = { data: { ai: {} } };
  const store = createStore(parsed);
  const narratorTarget = { key: "narrators", entityType: "narrators", label: "narrator" };
  const arcTarget = { key: "arcs", entityType: "arcs", label: "arc" };
  const trust = {
    key: "trust", metric: "Trust", dimension: "trust", valueKind: "score",
    observer: { mode: "entities", key: "characters", storageKey: "characters" }
  };
  store.writeRelationshipObservations(trust, narratorTarget, {
    "Hidden Voice": { Joe: {
      score: 7, salience: 6, confidence: 5, alignment: 1, evidenceStrength: 8,
      rationale: "Joe accepts the voice."
    } }
  }, [{ type: "characters", name: "Joe" }]);
  store.writeTrajectoryObservations(
    { key: "trajectory", metric: "Trajectory", dimension: "trajectory" },
    arcTarget,
    { Reputation: {
      stateBefore: "Unknown", stateAfter: "Local celebrity", transition: "First recognition",
      movement: 5, clarity: 7, confidence: 8, evidenceStrength: 7, rationale: "Recognition begins."
    } }
  );

  const relationship = parsed.data.ai.observations.narrators["Hidden Voice"].trust.characters.Joe;
  assert.equal(relationship.valueKind, "score");
  assert.equal(relationship.values.score, 7);
  assert.equal(relationship.observer.name, "Joe");
  const trajectory = parsed.data.ai.observations.arcs.Reputation.trajectory;
  assert.equal(trajectory.stateAfter, "Local celebrity");
  assert.equal(trajectory.values.movement, 5);

  const hash = store.evaluationInputHash("Trust", "Narrator", "prompt");
  store.markEvaluationInput("trust", "narrators", hash, "Trust", "Narrator");
  assert.equal(store.shouldSkipEvaluation("trust", "narrators", hash, {
    relationship: true, dimension: "trust", storageKey: "characters", observerMode: "entities"
  }), true);
});
