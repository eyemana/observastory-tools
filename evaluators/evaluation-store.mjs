import crypto from "crypto";
import path from "path";

export const EVALUATION_INPUT_HASH_VERSION = 3;

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

  function hasExistingEvaluation(metricKey, targetKey, options = {}) {
    const observations = parsed.data.ai?.observations;
    if (!observations || typeof observations !== "object") return false;

    if (targetKey === "scene") {
      const sceneName = path.basename(filePath, ".md");
      return Boolean(observations.scene?.[sceneName]?.[metricKey]);
    }

    if (options.relationship) {
      const dimension = options.dimension ?? metricKey;
      const storageKey = options.storageKey ?? "observer";
      return Object.values(observations[targetKey] ?? {}).some(entry => {
        const relationship = entry?.[dimension]?.[storageKey];
        return options.observerMode === "entities"
          ? relationship && Object.keys(relationship).length > 0
          : Boolean(relationship);
      });
    }

    if (options.trajectory) {
      const dimension = options.dimension ?? metricKey;
      return Object.values(observations[targetKey] ?? {})
        .some(entry => Boolean(entry?.[dimension]));
    }

    return Object.values(observations[targetKey] ?? {})
      .some(entry => Boolean(entry?.[metricKey]));
  }

  function shouldSkipEvaluation(metricKey, targetKey, inputHash, options = {}) {
    if (!cacheEnabled || forceEvaluation || !hasExistingEvaluation(metricKey, targetKey, options)) {
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

  function relationshipObservationPayload(contract, entry, targetConfig, entityName, observer) {
    const valueKind = contract.valueKind ?? "delta";
    const value = entry[valueKind] ?? 0;
    const payload = {
      entity: { name: entityName, type: targetConfig.entityType, target: targetConfig.label },
      dimension: dimensionKey(contract.dimension ?? contract.key),
      metric: contract.metric,
      valueKind,
      value,
      values: {
        [valueKind]: value,
        salience: entry.salience,
        confidence: entry.confidence,
        alignment: entry.alignment,
        evidenceStrength: entry.evidenceStrength
      },
      scale: { min: 0, max: 10 },
      fieldScales: {
        [valueKind]: { min: 0, max: 10 },
        salience: { min: 0, max: 10 },
        confidence: { min: 0, max: 10 },
        alignment: { min: -10, max: 10 },
        evidenceStrength: { min: 0, max: 10 }
      },
      observer,
      lifecycleStatus,
      calibrationMode,
      profile: profileName,
      model,
      updated: now()
    };
    if (entry.calibration) payload.calibration = entry.calibration;
    if (awarenessRationaleMode === "paraphrase") payload.rationale = entry.rationale ?? "";
    if (awarenessRationaleMode === "extractive") payload.evidence = entry.evidence ?? [];
    return payload;
  }

  function writeRelationshipObservations(contract, targetConfig, scores, observers) {
    parsed.data.ai.observations = parsed.data.ai.observations ?? {};
    const target = parsed.data.ai.observations[targetConfig.key] =
      parsed.data.ai.observations[targetConfig.key] ?? {};
    const dimension = dimensionKey(contract.dimension ?? contract.key);
    const storageKey = contract.observer.storageKey ?? contract.observer.key ?? "observer";

    for (const [entityName, observerScores] of Object.entries(scores ?? {})) {
      target[entityName] = target[entityName] ?? {};
      target[entityName][dimension] = target[entityName][dimension] ?? {};
      const bucket = target[entityName][dimension];

      if (contract.observer.mode === "entities") {
        bucket[storageKey] = bucket[storageKey] ?? {};
        for (const [observerName, entry] of Object.entries(observerScores ?? {})) {
          const observer = observers.find(item => item.name === observerName) ?? {
            type: contract.observer.key,
            name: observerName
          };
          bucket[storageKey][observerName] = relationshipObservationPayload(
            contract, entry, targetConfig, entityName, observer
          );
        }
      } else {
        const observer = observers[0] ?? {
          type: contract.observer.type ?? contract.observer.key,
          name: contract.observer.name
        };
        const entry = observerScores?.[observer.name] ?? Object.values(observerScores ?? {})[0] ?? {};
        bucket[storageKey] = relationshipObservationPayload(
          contract, entry, targetConfig, entityName, observer
        );
      }
    }
  }

  function writeTrajectoryObservations(contract, targetConfig, scores) {
    parsed.data.ai.observations = parsed.data.ai.observations ?? {};
    const target = parsed.data.ai.observations[targetConfig.key] =
      parsed.data.ai.observations[targetConfig.key] ?? {};
    const dimension = dimensionKey(contract.dimension ?? contract.key);

    for (const [entityName, entry] of Object.entries(scores ?? {})) {
      target[entityName] = target[entityName] ?? {};
      const payload = {
        entity: { name: entityName, type: targetConfig.entityType, target: targetConfig.label },
        dimension,
        metric: contract.metric,
        valueKind: "movement",
        value: entry.movement,
        values: {
          movement: entry.movement,
          clarity: entry.clarity,
          confidence: entry.confidence,
          evidenceStrength: entry.evidenceStrength
        },
        stateBefore: entry.stateBefore,
        stateAfter: entry.stateAfter,
        transition: entry.transition,
        scale: { min: 0, max: 10 },
        lifecycleStatus,
        calibrationMode,
        profile: profileName,
        model,
        updated: now()
      };
      if (entry.calibration) payload.calibration = entry.calibration;
      if (awarenessRationaleMode === "paraphrase") payload.rationale = entry.rationale ?? "";
      if (awarenessRationaleMode === "extractive") payload.evidence = entry.evidence ?? [];
      target[entityName][dimension] = payload;
    }
  }

  return {
    evaluationInputHash,
    markEvaluationInput,
    shouldSkipEvaluation,
    writeRelationshipObservations,
    writeStandardMetricObservations,
    writeTrajectoryObservations
  };
}
