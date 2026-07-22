function clampNumber(value, min, max, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeEvidence(rawEvidence, sourceText) {
  const items = Array.isArray(rawEvidence) ? rawEvidence : [];
  const seen = new Set();
  const evidence = [];

  for (const item of items) {
    const text = typeof item === "string"
      ? item
      : item && typeof item === "object"
        ? item.text ?? item.excerpt ?? ""
        : "";
    const excerpt = String(text).trim();
    const exact = excerpt && sourceText && (
      sourceText.includes(excerpt) ||
      normalizeWhitespace(sourceText).includes(normalizeWhitespace(excerpt))
    );

    if (!exact || seen.has(excerpt)) {
      continue;
    }

    seen.add(excerpt);
    evidence.push(excerpt);

    if (evidence.length >= 3) {
      break;
    }
  }

  return evidence;
}

function readStandardMetricRationale(rawValue, settings) {
  if (!rawValue || typeof rawValue !== "object") {
    return "";
  }

  const configured = rawValue[settings.rationaleField];
  if (typeof configured === "string") return configured;
  if (typeof rawValue.sceneRationale === "string") return rawValue.sceneRationale;
  if (typeof rawValue.rationale === "string") return rawValue.rationale;
  return "";
}

export function createResponsePolicy({
  awarenessRationaleMode,
  awarenessRationaleSources,
  calibrationMode,
  calibrationModeConfig,
  sceneLifecycleStatus,
  configEntryForName
}) {
  function awarenessSourceText(parts) {
    return Object.entries(parts)
      .filter(([name]) => awarenessRationaleSources.has(name))
      .map(([, value]) => value)
      .filter(Boolean)
      .join("\n\n");
  }

  function awarenessSourceListText() {
    const labels = {
      scene: "current scene",
      definitions: "supplied definitions",
      priorScenes: "prior scene context"
    };
    return [...awarenessRationaleSources]
      .map(source => labels[source] ?? source)
      .join(", ");
  }

  function awarenessRationaleInstructions() {
    if (awarenessRationaleMode === "off") {
      return "Do not return rationale, evidence, belief, source, trajectory, truthStatus, labels, or explanatory prose.";
    }

    if (awarenessRationaleMode === "extractive") {
      return `
Do not return paraphrased rationale or explanatory prose.
Return evidence as 0-3 exact excerpts copied from these allowed sources: ${awarenessSourceListText()}.
Each evidence excerpt must use the author's own words exactly.
Do not return belief, source, trajectory, truthStatus, labels, or invented categories.`;
    }

    return `
Return rationale as one tight sentence supporting the numeric values.
Do not return belief, source, trajectory, truthStatus, labels, or invented categories.`;
  }

  function standardMetricSourceText(settings, parts) {
    return Object.entries(parts)
      .filter(([name]) => settings.rationaleSources.has(name))
      .map(([, value]) => value)
      .filter(Boolean)
      .join("\n\n");
  }

  function standardMetricSourceListText(settings) {
    const labels = {
      scene: "current scene",
      definitions: "supplied definitions",
      sceneContext: "configured scene context",
      priorScenes: "prior scene context"
    };
    return [...settings.rationaleSources]
      .map(source => labels[source] ?? source)
      .join(", ");
  }

  function standardMetricRationaleInstructions(settings) {
    if (settings.rationaleMode === "off") {
      return "Do not return rationale, evidence, excerpts, or explanatory prose.";
    }

    if (settings.rationaleMode === "extractive") {
      return `
Do not return paraphrased rationale or explanatory prose.
Return evidence as 0-3 exact excerpts copied from these allowed sources: ${standardMetricSourceListText(settings)}.
Each evidence excerpt must use the author's own words exactly.`;
    }

    return `
Return ${settings.rationaleType} as one tight sentence supporting the associated numeric value.
Use the JSON field "${settings.rationaleField}" for that rationale.`;
  }

  function standardMetricRationaleJsonShape(settings, indent = "    ") {
    if (settings.rationaleMode === "off") return "";
    if (settings.rationaleMode === "extractive") {
      return `,\n${indent}"evidence": ["exact excerpt"]`;
    }
    return `,\n${indent}"${settings.rationaleField}": string`;
  }

  function normalizeStandardMetricEntry(rawValue, settings, sourceText) {
    const rawObject = rawValue && typeof rawValue === "object" ? rawValue : {};
    const numericValue = typeof rawObject.delta === "number"
      ? rawObject.delta
      : typeof rawObject.score === "number"
        ? rawObject.score
        : 0;
    const normalized = { scene: numericValue };

    if (settings.rationaleMode === "paraphrase") {
      normalized[settings.rationaleField] = readStandardMetricRationale(rawObject, settings);
    } else if (settings.rationaleMode === "extractive") {
      normalized.evidence = normalizeEvidence(
        rawObject.evidence ?? rawObject.excerpts,
        sourceText
      );
    }

    return normalized;
  }

  function awarenessEntryJsonShape() {
    const rationaleShape = awarenessRationaleMode === "paraphrase"
      ? `,\n      "rationale": "string"`
      : "";
    const evidenceShape = awarenessRationaleMode === "extractive"
      ? `,\n      "evidence": ["exact excerpt"]`
      : "";

    return `{
  "delta": number,
  "salience": number,
  "confidence": number,
  "alignment": number,
  "evidenceStrength": number${rationaleShape}${evidenceShape}
}`;
  }

  function awarenessJsonShape(targetConfig) {
    return `{
  "${targetConfig.key}": {
    "${targetConfig.label}Name": ${awarenessEntryJsonShape()}
  }
}`;
  }

  function normalizeAwarenessEntry(rawValue, sourceText) {
    const rawObject = typeof rawValue === "number"
      ? { delta: rawValue }
      : rawValue && typeof rawValue === "object"
        ? rawValue
        : {};
    const normalized = {
      delta: clampNumber(rawObject.delta, 0, 10),
      salience: clampNumber(rawObject.salience, 0, 10),
      confidence: clampNumber(rawObject.confidence, 0, 10),
      alignment: clampNumber(rawObject.alignment, -10, 10),
      evidenceStrength: clampNumber(rawObject.evidenceStrength, 0, 10)
    };

    if (awarenessRationaleMode === "paraphrase") {
      normalized.rationale = typeof rawObject.rationale === "string"
        ? rawObject.rationale
        : "";
    } else if (awarenessRationaleMode === "extractive") {
      normalized.evidence = normalizeEvidence(
        rawObject.evidence ?? rawObject.excerpts,
        sourceText
      );
    }

    return normalized;
  }

  function normalizeSubjectRelationshipScoreMap(
    bucket,
    expectedNames,
    label,
    rawResponse,
    settings,
    sourceText
  ) {
    if (expectedNames.length === 0) {
      const empty = { scene: 0, items: {} };
      if (settings.rationaleMode === "paraphrase") {
        empty[settings.rationaleField] = `No eligible ${label}s were available for this evaluation.`;
      } else if (settings.rationaleMode === "extractive") {
        empty.evidence = [];
      }
      return empty;
    }

    if (!bucket || typeof bucket !== "object") {
      throw new Error(`Invalid ${label} bucket: ${rawResponse}`);
    }

    const normalized = { scene: 0, items: {} };
    const returnedItemScores = [];

    for (const name of expectedNames) {
      const rawValue = bucket[name];
      if (rawValue && typeof rawValue === "object" && (
        typeof rawValue.delta === "number" || typeof rawValue.score === "number"
      )) {
        const entry = normalizeStandardMetricEntry(rawValue, settings, sourceText);
        normalized.items[name] = entry;
        returnedItemScores.push(entry.scene);
      } else {
        normalized.items[name] = { scene: 0 };
        if (settings.rationaleMode === "paraphrase") {
          normalized.items[name][settings.rationaleField] =
            `${label} was selected for evaluation, but the model did not return a delta value.`;
        } else if (settings.rationaleMode === "extractive") {
          normalized.items[name].evidence = [];
        }
      }
    }

    if (typeof bucket.delta === "number") {
      normalized.scene = bucket.delta;
    } else if (typeof bucket.score === "number") {
      normalized.scene = bucket.score;
    } else if (returnedItemScores.length > 0) {
      normalized.scene = Math.round(
        returnedItemScores.reduce((total, score) => total + score, 0) /
        returnedItemScores.length
      );
    } else {
      throw new Error(`Invalid ${label} scene score: ${rawResponse}`);
    }

    if (settings.rationaleMode === "paraphrase") {
      normalized[settings.rationaleField] = readStandardMetricRationale(bucket, settings) ||
        (returnedItemScores.length > 0
          ? `Aggregate ${label} score derived from returned item scores.`
          : "");
    } else if (settings.rationaleMode === "extractive") {
      normalized.evidence = normalizeEvidence(bucket.evidence ?? bucket.excerpts, sourceText);
    }

    return normalized;
  }

  function normalizeSceneOnlyScore(bucket, label, rawResponse, settings, sourceText) {
    if (!bucket || typeof bucket !== "object" || (
      typeof bucket.score !== "number" && typeof bucket.delta !== "number"
    )) {
      throw new Error(`Invalid ${label} scene score: ${rawResponse}`);
    }
    return normalizeStandardMetricEntry(bucket, settings, sourceText);
  }

  function configuredScoreCeiling(metricName) {
    const value = Number(configEntryForName(calibrationModeConfig?.scoreCeilings, metricName));
    return Number.isFinite(value) ? clampNumber(value, 0, 10, 10) : null;
  }

  function configuredFieldCeilings(metricName) {
    const entry = configEntryForName(calibrationModeConfig?.fieldCeilings, metricName);
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return {};
    return Object.entries(entry).reduce((ceilings, [field, value]) => {
      const number = Number(value);
      if (Number.isFinite(number)) ceilings[field] = clampNumber(number, 0, 10, 10);
      return ceilings;
    }, {});
  }

  function calibrationPromptGuidance(metricName) {
    const ceiling = configuredScoreCeiling(metricName);
    const fieldCeilings = configuredFieldCeilings(metricName);
    const guidance = typeof calibrationModeConfig.guidance === "string"
      ? calibrationModeConfig.guidance.trim()
      : "";

    if (!guidance && ceiling === null && Object.keys(fieldCeilings).length === 0) return "";
    const lines = [
      `Scene lifecycle status: ${sceneLifecycleStatus}.`,
      `Calibration mode: ${calibrationMode}.`
    ];
    if (guidance) lines.push(guidance);
    if (ceiling !== null) {
      lines.push(`Calibration cap: do not score ${metricName} above ${ceiling} on the 0-10 scale in this mode unless the configured cap is changed.`);
    }
    if (Object.keys(fieldCeilings).length > 0) {
      const fields = Object.entries(fieldCeilings)
        .map(([field, value]) => `${field} <= ${value}`)
        .join(", ");
      lines.push(`Calibration field caps for ${metricName}: ${fields}. Use these caps unless the configured cap is changed.`);
    }
    return lines.join("\n");
  }

  function applyCalibrationToMetricEntry(entry, metricName) {
    const ceiling = configuredScoreCeiling(metricName);
    if (ceiling === null || !entry || typeof entry.scene !== "number" || entry.scene <= ceiling) {
      return entry;
    }
    return {
      ...entry,
      rawScene: entry.scene,
      scene: ceiling,
      calibration: { mode: calibrationMode, lifecycleStatus: sceneLifecycleStatus, cappedAt: ceiling }
    };
  }

  function applyCalibrationToStandardScores(scores, metricName) {
    const items = {};
    for (const [name, value] of Object.entries(scores.items ?? {})) {
      items[name] = applyCalibrationToMetricEntry(value, metricName);
    }
    return { ...applyCalibrationToMetricEntry(scores, metricName), items };
  }

  function applyCalibrationToAwarenessEntry(entry, metricName) {
    const fieldCeilings = configuredFieldCeilings(metricName);
    const raw = {};
    let calibrated = entry;
    for (const [field, ceiling] of Object.entries(fieldCeilings)) {
      if (typeof calibrated?.[field] !== "number" || calibrated[field] <= ceiling) continue;
      raw[field] = calibrated[field];
      calibrated = { ...calibrated, [field]: ceiling };
    }
    if (Object.keys(raw).length === 0) return entry;
    return {
      ...calibrated,
      calibration: {
        mode: calibrationMode,
        lifecycleStatus: sceneLifecycleStatus,
        fieldCeilings,
        raw
      }
    };
  }

  function applyCalibrationToReaderAwarenessMap(scores, metricName) {
    return Object.fromEntries(Object.entries(scores ?? {}).map(([name, entry]) => [
      name,
      applyCalibrationToAwarenessEntry(entry, metricName)
    ]));
  }

  function applyCalibrationToCharacterAwarenessMap(scores, metricName) {
    return Object.fromEntries(Object.entries(scores ?? {}).map(([thread, characters]) => [
      thread,
      Object.fromEntries(Object.entries(characters ?? {}).map(([character, entry]) => [
        character,
        applyCalibrationToAwarenessEntry(entry, metricName)
      ]))
    ]));
  }

  function normalizeCharacterAwarenessMap(scores, plotThreadNames, characterNames, sourceText) {
    const source = scores && typeof scores === "object" ? scores : {};
    return Object.fromEntries(plotThreadNames.map(plotThreadName => [
      plotThreadName,
      Object.fromEntries(characterNames.map(characterName => [
        characterName,
        normalizeAwarenessEntry(
          source[plotThreadName] && typeof source[plotThreadName] === "object"
            ? source[plotThreadName][characterName]
            : undefined,
          sourceText
        )
      ]))
    ]));
  }

  function normalizeReaderAwarenessMap(scores, targetNames, sourceText) {
    const source = scores && typeof scores === "object" ? scores : {};
    return Object.fromEntries(targetNames.map(targetName => [
      targetName,
      normalizeAwarenessEntry(source[targetName], sourceText)
    ]));
  }

  return {
    applyCalibrationToCharacterAwarenessMap,
    applyCalibrationToReaderAwarenessMap,
    applyCalibrationToStandardScores,
    awarenessEntryJsonShape,
    awarenessJsonShape,
    awarenessRationaleInstructions,
    awarenessSourceText,
    calibrationPromptGuidance,
    normalizeCharacterAwarenessMap,
    normalizeReaderAwarenessMap,
    normalizeSceneOnlyScore,
    normalizeSubjectRelationshipScoreMap,
    standardMetricRationaleInstructions,
    standardMetricRationaleJsonShape,
    standardMetricSourceText
  };
}
