import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRelationshipPrompt,
  buildStandardMetricPrompt,
  buildTrajectoryPrompt,
  readerAwarenessGuidance
} from "../evaluators/prompt-builders.mjs";

test("standard scene prompt keeps its bounded-context prohibition", () => {
  const prompt = buildStandardMetricPrompt({
    metricName: "Pacing",
    targetConfig: { key: "scene", label: "scene", pluralLabel: "scenes", sceneOnly: true },
    targetNames: [],
    targetDefinitions: "",
    settings: { priorContext: null },
    metricDefinition: "Measure momentum.",
    calibrationGuidance: "Draft calibration.",
    linkedTargetsText: "None.",
    valueKind: "score",
    sceneContext: "",
    priorContext: "",
    sceneContent: "Mara runs.",
    rationaleInstructions: "Return rationale.",
    bucketRationaleShape: ',\n    "rationale": string',
    itemRationaleShape: ""
  });

  assert.match(prompt, /Do not use other scenes, truth ledgers, chronology/);
  assert.match(prompt, /"score": number/);
  assert.match(prompt, /Mara runs/);
});

test("reader-awareness guidance comes from entity configuration rather than entity names", () => {
  const guidance = readerAwarenessGuidance({
    key: "arcs",
    label: "arc",
    pluralLabel: "arcs",
    readerAwareness: {
      meaning: "Use this author's configured meaning.",
      cautions: ["Do not impose stages."]
    }
  });
  assert.equal(guidance.meaning, "Use this author's configured meaning.");
  assert.deepEqual(guidance.cautions, ["Do not impose stages."]);
});

test("generic relationship and trajectory prompts preserve configured semantics", () => {
  const relationship = buildRelationshipPrompt({
    contract: {
      metric: "Trust",
      valueKind: "score",
      meaning: "Measure Joe's trust.",
      knowledgeBoundary: "Use only Joe's evidence.",
      observer: { mode: "entities", key: "characters" }
    },
    targetConfig: { key: "narrators", label: "narrator", pluralLabel: "narrators" },
    targetNames: ["Hidden Voice"], targetDefinitions: "definition",
    observerNames: ["Joe"], observerDefinitions: "Joe definition",
    priorContext: "prior", truthLedgerSupport: "truth",
    linkedTargetsText: "Hidden Voice", linkedObserversText: "Joe",
    calibrationGuidance: "", rationaleInstructions: "",
    relationshipEntryShape: '{ "score": number }', sceneContent: "scene"
  });
  const trajectory = buildTrajectoryPrompt({
    contract: { metric: "Trajectory", meaning: "Use whatever change model is defined." },
    targetConfig: { key: "motifs", label: "motif" },
    targetNames: ["Weather"], targetDefinitions: "cyclical definition",
    priorContext: "prior", truthLedgerSupport: "truth", linkedTargetsText: "Weather",
    calibrationGuidance: "", rationaleInstructions: "",
    trajectoryEntryShape: '{ "movement": number }', sceneContent: "scene"
  });

  assert.match(relationship, /Measure Joe's trust/);
  assert.match(relationship, /"score"/);
  assert.match(trajectory, /does not imply a\s+character arc, fixed stages/i);
  assert.match(trajectory, /motif/);
});
