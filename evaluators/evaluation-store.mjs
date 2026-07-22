import crypto from "crypto";
import path from "path";

export const EVALUATION_INPUT_HASH_VERSION = 2;

export function createEvaluationStore({
  parsed,
  filePath,
  model,
  profileName,
  lifecycleStatus,
  calibrationMode,
  cacheEnabled,
  forceEvaluation,
  awarenessRationaleMode,
  normalizeName,
  dimensionKey,
  standardMetricValueKind,
  now = () => new Date().toISOString()
}) {
  function evaluationInputHash(metricName, targetName, prompt) {
    return crypto
      .createHash("sha256")
      .update(JSON.stringify({
        version: EVALUATION_INPUT_HASH_VERSION,
        model,
        metricName,
        targetName,
        profile: profileName,
        lifecycleStatus,
        calibrationMode,
        prompt
      }))
      .digest("hex");
  }

  function hasExistingEvaluation(metricKey, targetKey) {
    const observations = parsed.data.ai?.observations;
    if (!observations || typeof observations !== "object") return false;

    if (targetKey === "scene") {
      const sceneName = path.basename(filePath, ".md");
      return Boolean(observations.scene?.[sceneName]?.[metricKey]);
    }

    if (metricKey === "readerAwareness") {
      return Object.values(observations[targetKey] ?? {})
        .some(entry => Boolean(entry?.awareness?.reader));
    }

    if (metricKey === "characterAwareness") {
      return Object.values(observations[targetKey] ?? {})
        .some(entry => Object.keys(entry?.awareness?.characters ?? {}).length > 0);
    }

    return Object.values(observations[targetKey] ?? {})
      .some(entry => Boolean(entry?.[metricKey]));
  }

  function shouldSkipEvaluation(metricKey, targetKey, inputHash) {
    if (!cacheEnabled || forceEvaluation || !hasExistingEvaluation(metricKey, targetKey)) {
      return false;
    }

    const metadata = parsed.data.ai?.evaluationInputs?.[metricKey]?.[targetKey];
    return metadata?.version === EVALUATION_INPUT_HASH_VERSION &&
      metadata?.inputHash === inputHash;
  }

  function markEvaluationInput(metricKey, targetKey, inputHash, metricName, targetName) {
    parsed.data.ai.evaluationInputs = parsed.data.ai.evaluationInputs ?? {};
    parsed.data.ai.evaluationInputs[metricKey] =
      parsed.data.ai.evaluationInputs[metricKey] ?? {};
    parsed.data.ai.evaluationInputs[metricKey][targetKey] = {
      version: EVALUATION_INPUT_HASH_VERSION,
      inputHash,
      model,
      profile: profileName,
      lifecycleStatus,
      calibrationMode,
      metric: normalizeName(metricName),
      target: normalizeName(targetName),
      updated: now()
    };
  }

  function standardMetricObservationPayload(metricName, entry, settings, targetConfig, entityName) {
    const valueKind = standardMetricValueKind(settings, targetConfig);
    const payload = {
      entity: {
        name: entityName,
        type: targetConfig.entityType,
        target: targetConfig.label
      },
      dimension: dimensionKey(metricName),
      metric: metricName,
      valueKind,
      value: entry.scene,
      values: { [valueKind]: entry.scene },
      scale: { min: 0, max: 10 },
      fieldScales: {
        delta: { min: 0, max: 10 },
        salience: { min: 0, max: 10 },
        confidence: { min: 0, max: 10 },
        alignment: { min: -10, max: 10 },
        evidenceStrength: { min: 0, max: 10 }
      },
      lifecycleStatus,
      calibrationMode,
      profile: profileName,
      model,
      updated: now()
    };

    if (typeof entry.rawScene === "number") {
      payload.rawValue = entry.rawScene;
      payload.calibration = entry.calibration;
    }
    if (settings.rationaleMode === "paraphrase") {
      payload.rationale = entry[settings.rationaleField] ?? "";
    } else if (settings.rationaleMode === "extractive") {
      payload.evidence = entry.evidence ?? [];
    }
    return payload;
  }

  function writeStandardMetricObservations(metricName, targetConfig, scores, settings) {
    const dimension = dimensionKey(metricName);
    parsed.data.ai.observations = parsed.data.ai.observations ?? {};
    parsed.data.ai.observations[targetConfig.key] =
      parsed.data.ai.observations[targetConfig.key] ?? {};

    if (targetConfig.sceneOnly) {
      const sceneName = path.basename(filePath, ".md");
      const target = parsed.data.ai.observations[targetConfig.key];
      target[sceneName] = target[sceneName] ?? {};
      target[sceneName][dimension] = standardMetricObservationPayload(
        metricName,
        scores,
        settings,
        targetConfig,
        sceneName
      );
      return;
    }

    for (const [entityName, entry] of Object.entries(scores.items ?? {})) {
      const target = parsed.data.ai.observations[targetConfig.key];
      target[entityName] = target[entityName] ?? {};
      target[entityName][dimension] = standardMetricObservationPayload(
        metricName,
        entry,
        settings,
        targetConfig,
        entityName
      );
    }
  }

  function awarenessObservationPayload(metricName, entry, targetConfig, entityName, observer = null) {
    const payload = {
      entity: { name: entityName, type: targetConfig.entityType, target: targetConfig.label },
      dimension: "awareness",
      metric: metricName,
      valueKind: "delta",
      value: entry.delta,
      values: {
        delta: entry.delta,
        salience: entry.salience,
        confidence: entry.confidence,
        alignment: entry.alignment,
        evidenceStrength: entry.evidenceStrength
      },
      scale: { min: 0, max: 10 },
      lifecycleStatus,
      calibrationMode,
      profile: profileName,
      model,
      updated: now()
    };

    if (observer) payload.observer = observer;
    if (entry.calibration) payload.calibration = entry.calibration;
    if (awarenessRationaleMode === "paraphrase") {
      payload.rationale = entry.rationale ?? "";
    } else if (awarenessRationaleMode === "extractive") {
      payload.evidence = entry.evidence ?? [];
    }
    return payload;
  }

  function writeReaderAwarenessObservations(targetConfig, scores) {
    parsed.data.ai.observations = parsed.data.ai.observations ?? {};
    const target = parsed.data.ai.observations[targetConfig.key] =
      parsed.data.ai.observations[targetConfig.key] ?? {};

    for (const [entityName, entry] of Object.entries(scores ?? {})) {
      target[entityName] = target[entityName] ?? {};
      target[entityName].awareness = target[entityName].awareness ?? {};
      target[entityName].awareness.reader = awarenessObservationPayload(
        "reader awareness",
        entry,
        targetConfig,
        entityName,
        { type: "reader", name: "Reader" }
      );
    }
  }

  function writeCharacterAwarenessObservations(plotThreadConfig, scores) {
    parsed.data.ai.observations = parsed.data.ai.observations ?? {};
    const target = parsed.data.ai.observations[plotThreadConfig.key] =
      parsed.data.ai.observations[plotThreadConfig.key] ?? {};

    for (const [plotThreadName, characterScores] of Object.entries(scores ?? {})) {
      target[plotThreadName] = target[plotThreadName] ?? {};
      target[plotThreadName].awareness = target[plotThreadName].awareness ?? {};
      const characters = target[plotThreadName].awareness.characters =
        target[plotThreadName].awareness.characters ?? {};

      for (const [characterName, entry] of Object.entries(characterScores ?? {})) {
        characters[characterName] = awarenessObservationPayload(
          "character awareness",
          entry,
          plotThreadConfig,
          plotThreadName,
          { type: "characters", name: characterName }
        );
      }
    }
  }

  return {
    evaluationInputHash,
    markEvaluationInput,
    shouldSkipEvaluation,
    writeCharacterAwarenessObservations,
    writeReaderAwarenessObservations,
    writeStandardMetricObservations
  };
}
