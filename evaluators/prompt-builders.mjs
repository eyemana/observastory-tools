export function buildStandardMetricPrompt({
  metricName,
  targetConfig,
  targetNames,
  targetDefinitions,
  settings,
  metricDefinition,
  calibrationGuidance,
  linkedTargetsText,
  valueKind,
  sceneContext,
  priorContext,
  sceneContent,
  rationaleInstructions,
  bucketRationaleShape,
  itemRationaleShape
}) {
  if (targetConfig.sceneOnly) {
    return `
Return JSON only.
Return compact valid JSON.
Do not include trailing commas.
Every opened object must be closed.
Do not include markdown.

Score only this scene.
${settings.priorContext
    ? "Use only the current scene and the explicitly supplied bounded context. Do not use truth ledgers or external story context."
    : "Do not use other scenes, truth ledgers, chronology, or external story context."}
This is a scene craft score, not a story trajectory delta.

${calibrationGuidance}

${rationaleInstructions}

Use this definition of ${metricName}:
${metricDefinition}

${sceneContext}

${priorContext}

Scene:

${sceneContent}

Required JSON:
{
  "${targetConfig.key}": {
    "${valueKind}": number${bucketRationaleShape}
  }
}
`;
  }

  return `
Return JSON only.
Return compact valid JSON.
Do not include trailing commas.
Every opened object must be closed.
Do not include markdown.

${targetConfig.pluralLabel} to evaluate:
${JSON.stringify(targetNames, null, 2)}

${targetConfig.pluralLabel} explicitly linked in this scene:
${linkedTargetsText}

You must return one ${valueKind} object for every listed ${targetConfig.label}.
Use EXACTLY the listed names as JSON keys.
Do not omit any listed item.
Do not add unlisted items.
${valueKind === "score"
    ? "If evidence for an item is weak, still include it with a conservative score and configured rationale output."
    : "If an item barely changes in this scene, still include it with delta 0 or a low delta and configured rationale output."}

${valueKind === "score"
    ? `Score from 0-10.\nThis is a per-scene assessment, not a trajectory delta.\nMeasure how strongly the scene satisfies the selected dimension for each listed ${targetConfig.label}.`
    : `Score delta from 0-10.\nThis is a scene delta/change observation, not an absolute state score.\nMeasure how much this scene changes, advances, pressures, reveals, complicates, reinforces, or resolves the selected dimension for each listed ${targetConfig.label}.\nDo not score general importance, screen time, or static relevance.`}

${calibrationGuidance}

${rationaleInstructions}

Use this definition of ${metricName}:
${metricDefinition}

Use these ${targetConfig.pluralLabel} definitions:
${targetDefinitions}

${sceneContext}

${priorContext}

Scene:

${sceneContent}

Required JSON:
{
  "${targetConfig.key}": {
    "${valueKind}": number${bucketRationaleShape},
    "${targetConfig.label}Name": {
      "${valueKind}": number${itemRationaleShape}
    }
  }
}
`;
}

export function readerAwarenessGuidance(targetConfig) {
  if (targetConfig.readerAwareness && typeof targetConfig.readerAwareness === "object") {
    return {
      subject: targetConfig.readerAwareness.subject ?? targetConfig.pluralLabel,
      meaning: targetConfig.readerAwareness.meaning ??
        `Reader awareness means how much NEW information the reader gains during this scene about a ${targetConfig.label}.`,
      low: targetConfig.readerAwareness.low ??
        `1-3 = the reader gains minor, indirect, or confirmatory information about the ${targetConfig.label}.`,
      medium: targetConfig.readerAwareness.medium ??
        "4-6 = the reader gains meaningful new information or a clearer connection.",
      high: targetConfig.readerAwareness.high ??
        `7-9 = the reader gains major new understanding of the ${targetConfig.label}.`,
      decisive: targetConfig.readerAwareness.decisive ??
        `10 = the reader receives a decisive revelation about the ${targetConfig.label}.`,
      cautions: Array.isArray(targetConfig.readerAwareness.cautions)
        ? targetConfig.readerAwareness.cautions
        : ["Do not score general importance.", "If the scene repeats information the reader already had, use delta 0 or a low confirmatory score."]
    };
  }

  return {
    subject: targetConfig.pluralLabel,
    meaning: `Reader awareness means how much NEW information the reader gains during this scene about a ${targetConfig.label}.`,
    low: `1-3 = the reader gains minor, indirect, or confirmatory information about the ${targetConfig.label}.`,
    medium: `4-6 = the reader gains meaningful new information or a clearer connection about the ${targetConfig.label}.`,
    high: `7-9 = the reader gains major new understanding of the ${targetConfig.label}.`,
    decisive: `10 = the reader receives a decisive revelation about the ${targetConfig.label}.`,
    cautions: [
      "Do not score general importance.",
      "If the scene repeats information the reader already had, use delta 0 or a low confirmatory score."
    ]
  };
}

export function buildRelationshipPrompt({
  contract,
  targetConfig,
  targetNames,
  targetDefinitions,
  observerNames,
  observerDefinitions,
  priorContext,
  truthLedgerSupport,
  linkedTargetsText,
  linkedObserversText,
  calibrationGuidance,
  rationaleInstructions,
  relationshipEntryShape,
  sceneContent
}) {
  const valueKind = contract.valueKind ?? "delta";
  const observerLabel = contract.observer.mode === "entities"
    ? contract.observer.label ?? contract.observer.key
    : contract.observer.name;

  return `
Return JSON only. Return compact valid JSON without markdown or trailing commas.

Evaluate the configured relationship "${contract.metric}" for this scene.
This evaluator is defined by configuration; do not substitute a different story abstraction.

Targets (${targetConfig.pluralLabel}):
${JSON.stringify(targetNames, null, 2)}

Observers (${observerLabel}):
${JSON.stringify(observerNames, null, 2)}

Use EXACTLY the listed target and observer names as JSON keys. Do not add, shorten, or omit names.

Meaning:
${contract.meaning ?? `Measure ${contract.metric} between each observer and target in this scene.`}

Knowledge boundary:
${contract.knowledgeBoundary ?? "Use only the supplied definitions, prior context, truth support, and current scene."}

The primary value is "${valueKind}" on a 0-10 scale.
salience = how present or noticeable the relationship is in this scene (0-10).
confidence = confidence warranted by supplied evidence (0-10).
alignment = agreement with intended definitions and truth support (-10 to 10; use 0 without a basis).
evidenceStrength = strength of supplied textual support (0-10).
If valueKind is delta, score change made visible in this scene rather than cumulative state.

${calibrationGuidance}
${rationaleInstructions}

Target definitions:
${targetDefinitions}

Observer definitions:
${observerDefinitions || "The observer is supplied directly by configuration."}

Explicitly linked targets:
${linkedTargetsText}

Explicitly linked observers:
${linkedObserversText}

Prior context:
${priorContext}

Truth Ledger support:
${truthLedgerSupport}

Current scene:
${sceneContent}

Required JSON:
{
  "${targetConfig.key}": {
    "targetName": {
      "observerName": ${relationshipEntryShape}
    }
  }
}
`;
}

export function buildTrajectoryPrompt({
  contract,
  targetConfig,
  targetNames,
  targetDefinitions,
  priorContext,
  truthLedgerSupport,
  linkedTargetsText,
  calibrationGuidance,
  rationaleInstructions,
  trajectoryEntryShape,
  sceneContent
}) {
  return `
Return JSON only. Return compact valid JSON without markdown or trailing commas.

Evaluate the configured trajectory "${contract.metric}" for each listed ${targetConfig.label}.
A trajectory is only a generic description of change over story time. It does not imply a
character arc, fixed stages, forward progress, improvement, or even linear movement.

${contract.meaning ?? "Describe the state or transition made visible by this scene using the author's definition."}

Use the author's terminology where the definition supplies it. If the definition does not
name formal states, use short descriptive state labels grounded in the supplied text.
Use an empty stateBefore, stateAfter, or transition when the evidence does not establish it.
movement measures how much change this scene makes visible (0-10), not whether it is good.
clarity measures how clearly the state/transition is surfaced (0-10).
confidence and evidenceStrength are 0-10.
Do not manufacture a transition merely because the item is called an arc or trajectory.

Use EXACTLY these names as JSON keys:
${JSON.stringify(targetNames, null, 2)}

${calibrationGuidance}
${rationaleInstructions}

Definitions:
${targetDefinitions}

Explicitly linked targets:
${linkedTargetsText}

Prior context:
${priorContext}

Truth Ledger support:
${truthLedgerSupport}

Current scene:
${sceneContent}

Required JSON:
{
  "${targetConfig.key}": {
    "targetName": ${trajectoryEntryShape}
  }
}
`;
}
