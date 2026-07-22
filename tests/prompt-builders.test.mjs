import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCharacterAwarenessPrompt,
  buildReaderAwarenessPrompt,
  buildStandardMetricPrompt,
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

test("awareness prompts preserve observer-specific knowledge boundaries", () => {
  const characterPrompt = buildCharacterAwarenessPrompt({
    characterNames: ["Mara"],
    plotThreadNames: ["Missing Ledger"],
    characterDefinitions: "Mara definition",
    plotThreadDefinitions: "Ledger definition",
    priorChronologyContext: "Earlier chronology",
    truthLedgerSupport: "Author support",
    linkedCharactersText: "Mara",
    linkedPlotThreadsText: "Missing Ledger",
    calibrationGuidance: "",
    rationaleInstructions: "",
    awarenessEntryShape: "{ fields }",
    sceneContent: "Current scene"
  });
  const target = { key: "characters", label: "character", pluralLabel: "characters" };
  const readerPrompt = buildReaderAwarenessPrompt({
    targetConfig: target,
    targetNames: ["Mara"],
    targetDefinitions: "Mara definition",
    priorSceneContext: "Earlier reader scene",
    truthLedgerSupport: "Author support",
    linkedTargetsText: "Mara",
    guidance: readerAwarenessGuidance(target),
    calibrationGuidance: "",
    rationaleInstructions: "",
    awarenessShape: "{ fields }",
    sceneContent: "Current scene"
  });

  assert.match(characterPrompt, /Only score what each character plausibly learns/);
  assert.match(characterPrompt, /prior chronology context/);
  assert.match(readerPrompt, /reader is not limited to what any character knows/i);
  assert.match(readerPrompt, /prior scene context available to the reader/i);
});

test("reader-awareness guidance retains specialized arc semantics", () => {
  const guidance = readerAwarenessGuidance({
    key: "arcs",
    label: "arc",
    pluralLabel: "arcs"
  });
  assert.match(guidance.meaning, /progressing, changing direction, deepening, or resolving/);
  assert.match(guidance.cautions.join(" "), /author intent that remains invisible/);
});
