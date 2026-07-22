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

export function buildCharacterAwarenessPrompt({
  characterNames,
  plotThreadNames,
  characterDefinitions,
  plotThreadDefinitions,
  priorChronologyContext,
  truthLedgerSupport,
  linkedCharactersText,
  linkedPlotThreadsText,
  calibrationGuidance,
  rationaleInstructions,
  awarenessEntryShape,
  sceneContent
}) {
  return `
Return JSON only.
Return compact valid JSON.
Do not include trailing commas.
Every opened object must be closed.
Do not include markdown.

Evaluate character awareness of plot threads for this scene.

Characters:
${JSON.stringify(characterNames, null, 2)}

plot threads:
${JSON.stringify(plotThreadNames, null, 2)}

Characters explicitly linked in this scene:
${linkedCharactersText}

Plot threads explicitly linked in this scene:
${linkedPlotThreadsText}

Use EXACTLY the listed plot thread names as JSON keys.
Use EXACTLY the listed character names as JSON keys.
Do not shorten names.
Do not use first names.
Do not add unlisted characters or plot threads.
Do not omit listed characters or plot threads.

character awareness means how much NEW information a character gains during this scene about a plot thread.

Score delta from 0-10.
Score salience from 0-10.
Score confidence from 0-10.
Score alignment from -10 to 10.
Score evidenceStrength from 0-10.

0 = the character gains no new information about the plot thread in this scene.
1-3 = the character gains minor or indirect information.
4-6 = the character gains meaningful new information.
7-9 = the character gains major new understanding.
10 = the character receives a decisive revelation.

salience = how present or noticeable the plot thread is to the character in this scene.
confidence = how certain the character seems about what they know or infer.
alignment = how aligned the character's apparent understanding is with the supplied definitions and scene evidence. Use 0 if there is no reliable basis.
evidenceStrength = how much support the supplied text gives for these scores.

This is a delta, not cumulative awareness.
Compare this scene to the prior chronology context, and score only information newly available to the character in this scene.
Do not assume a character knows a prior chronological scene unless the character was present in that scene or the supplied text gives the character plausible access to that information.
Do not score scene relevance.
Do not score reader awareness.
Do not score plot importance.
Only score what each character plausibly learns during this scene.
If a character is not present or cannot plausibly learn the information, use delta 0.

${calibrationGuidance}

${rationaleInstructions}

Use these character definitions:
${characterDefinitions}

Use these plot thread definitions:
${plotThreadDefinitions}

Prior chronology context for comparison:
${priorChronologyContext}

Truth Ledger support map:
${truthLedgerSupport}

Use prior chronology support as possible evidence available before this scene.
Use author support as grounding for the story's intended truth, but do not assume a character knows author support unless prior chronology context or the current scene gives that character plausible access.

Scene:

${sceneContent}

Required JSON:
{
  "plotThreads": {
    "plotThreadName": {
      "characterName": ${awarenessEntryShape}
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

  if (targetConfig.key === "characters") {
    return {
      subject: "characters",
      meaning: "Reader awareness means how much this scene increases, refreshes, or reinforces reader-facing awareness of a character, including explicit mention, first introduction, existence, role, relationship to the setting or cast, behavior, habits, traits, goals, stakes, choices, or reputation.",
      low: "1-3 = the reader receives minor, indirect, confirmatory, first-contact, or salience-building awareness of the character.",
      medium: "4-6 = the reader gains meaningful new information about the character's role, traits, relationships, goals, history, choices, or stakes.",
      high: "7-9 = the reader gains major new understanding of the character.",
      decisive: "10 = the reader receives a decisive revelation about the character.",
      cautions: [
        "Score what the reader newly learns about the character, not whether the character is important.",
        "The reader can learn about absent characters if the scene reveals meaningful information about them.",
        "Do not infer awareness from the frontmatter list alone; score only what is visible in the prose or reader knowledge marker.",
        "Do not require first contact for a nonzero score; repeated on-page mentions can still earn a low positive delta when they keep the character present in the reader's mind.",
        "If the prose names or clearly identifies the character, this is usually at least delta 1 even when the reader has prior context.",
        "If a mention also establishes or reinforces setting, occupation, relationship, routine, attitude, social role, or a memorable behavioral detail, use delta 2-4 depending on specificity.",
        "Use delta 0 only when the scene gives the reader no practical awareness signal for the character beyond the character being listed in frontmatter."
      ]
    };
  }

  if (targetConfig.key === "arcs") {
    return {
      subject: "arcs",
      meaning: "Reader awareness means how much NEW evidence the reader receives during this scene that an arc is progressing, changing direction, deepening, or resolving.",
      low: "1-3 = the reader receives minor, indirect, or confirmatory evidence of arc movement.",
      medium: "4-6 = the reader receives meaningful evidence of progress, regression, complication, or change in the arc.",
      high: "7-9 = the reader receives major evidence of arc movement or a significant turning point.",
      decisive: "10 = the reader receives decisive evidence of a major arc breakthrough, reversal, or resolution.",
      cautions: [
        "Score evidence shown to the reader, not author intent that remains invisible on the page.",
        "Do not score whether the arc is important in the story.",
        "If the scene only repeats already-established arc movement, use delta 0 or a low confirmatory score."
      ]
    };
  }

  if (targetConfig.key === "plotThreads") {
    return {
      subject: "plot threads",
      meaning: "Reader awareness means how much NEW information the reader gains during this scene about a plot thread.",
      low: "1-3 = the reader gains minor, indirect, or confirmatory information about the plot thread.",
      medium: "4-6 = the reader gains meaningful new information or a clearer connection.",
      high: "7-9 = the reader gains major new understanding.",
      decisive: "10 = the reader receives a decisive revelation about the plot thread.",
      cautions: [
        "Do not score plot importance.",
        "If the scene repeats information the reader already had, use delta 0 or a low confirmatory score."
      ]
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

export function buildReaderAwarenessPrompt({
  targetConfig,
  targetNames,
  targetDefinitions,
  priorSceneContext,
  truthLedgerSupport,
  linkedTargetsText,
  guidance,
  calibrationGuidance,
  rationaleInstructions,
  awarenessShape,
  sceneContent
}) {
  return `
Return JSON only.
Return compact valid JSON.
Do not include trailing commas.
Every opened object must be closed.
Do not include markdown.

Evaluate reader awareness of ${guidance.subject} for this scene.

${targetConfig.pluralLabel}:
${JSON.stringify(targetNames, null, 2)}

${targetConfig.pluralLabel} explicitly linked in this scene:
${linkedTargetsText}

Use EXACTLY the listed ${targetConfig.label} names as JSON keys.
Do not shorten names.
Do not add unlisted ${targetConfig.pluralLabel}.
Do not omit listed ${targetConfig.pluralLabel}.

${guidance.meaning}

Score delta from 0-10.
Score salience from 0-10.
Score confidence from 0-10.
Score alignment from -10 to 10.
Score evidenceStrength from 0-10.

0 = the reader gains no new awareness for this ${targetConfig.label} in this scene.
${guidance.low}
${guidance.medium}
${guidance.high}
${guidance.decisive}

salience = how present or noticeable this ${targetConfig.label} is to the reader in this scene.
confidence = how certain the reader is likely to feel about what they know or infer.
alignment = how aligned the reader's likely understanding is with the supplied definitions, prior context, and scene evidence. Use 0 if there is no reliable basis.
evidenceStrength = how much support the supplied text gives for these scores.

This is a delta, not cumulative awareness.
Compare this scene to the prior scene context, and score only information newly available to the reader in this scene.
The reader can learn from narration, dramatic irony, scene framing, implications, reveals, and any point-of-view character.
The reader is not limited to what any character knows.
Do not score what characters know; this is reader-facing awareness only.
Do not score scene relevance.
${guidance.cautions.join("\n")}

${calibrationGuidance}

${rationaleInstructions}

Use these ${targetConfig.pluralLabel} definitions:
${targetDefinitions}

Prior scene context available to the reader:
${priorSceneContext}

Truth Ledger support map:
${truthLedgerSupport}

Use reader-visible support as evidence the reader could already have before this scene.
Use author support as grounding for the story's intended truth, but do not treat author support as reader knowledge unless it appears in prior scene context or the current scene.

Current scene:

${sceneContent}

Required JSON:
${awarenessShape}
`;
}
