import {
  buildRelationshipPrompt,
  buildStandardMetricPrompt,
  buildTrajectoryPrompt,
  readerAwarenessGuidance
} from "./prompt-builders.mjs";

export function createEvaluatorFamilies({
  sceneContent,
  getTargetConfig,
  getTargetDefinitions,
  standardMetricSettings,
  standardMetricValueKind,
  standardMetricSceneContext,
  standardMetricPriorContext,
  metricDefinition,
  formatDefinitions,
  linkedTargetEntries,
  formatLinkedTargetEntries,
  listPriorScenes,
  listPriorChronologyScenes,
  formatPriorSceneContext,
  formatPriorChronologyContext,
  formatTruthLedgerSupport,
  responsePolicy,
  evaluationStore,
  requestModelJson,
  dimensionKey,
  logSkippedEvaluation,
  relationshipContractFor,
  trajectoryContractFor
}) {
  const {
    applyCalibrationToRelationshipMap,
    applyCalibrationToStandardScores,
    applyCalibrationToTrajectoryMap,
    awarenessRationaleInstructions,
    awarenessSourceText,
    calibrationPromptGuidance,
    normalizeRelationshipMap,
    normalizeSceneOnlyScore,
    normalizeSubjectRelationshipScoreMap,
    normalizeTrajectoryMap,
    relationshipEntryJsonShape,
    standardMetricRationaleInstructions,
    standardMetricRationaleJsonShape,
    standardMetricSourceText,
    trajectoryEntryJsonShape
  } = responsePolicy;
  const {
    evaluationInputHash,
    markEvaluationInput,
    shouldSkipEvaluation,
    writeRelationshipObservations,
    writeStandardMetricObservations,
    writeTrajectoryObservations
  } = evaluationStore;

  async function evaluateStandardMetric(metricName, targetName) {
    const metricKey = dimensionKey(metricName);
    const targetConfig = getTargetConfig(targetName);
    const canonicalTargetName = targetConfig.target;
    const settings = standardMetricSettings(metricName);
    const targetDefinitionEntries = getTargetDefinitions(targetConfig, settings.targetSelection);
    const targetNames = targetDefinitionEntries.map(definition => definition.name);
    if (!targetConfig.sceneOnly && targetNames.length === 0) return false;
    const targetDefinitions = targetConfig.sceneOnly
      ? ""
      : formatDefinitions(targetDefinitionEntries);
    const definition = metricDefinition(metricName);
    const sceneContext = standardMetricSceneContext(settings);
    const priorContext = standardMetricPriorContext(settings);
    const valueKind = standardMetricValueKind(settings, targetConfig);
    const prompt = buildStandardMetricPrompt({
      metricName,
      targetConfig,
      targetNames,
      targetDefinitions,
      settings,
      metricDefinition: definition,
      calibrationGuidance: calibrationPromptGuidance(metricName),
      linkedTargetsText: formatLinkedTargetEntries(
        targetConfig.sceneOnly ? [] : linkedTargetEntries(sceneContent, targetNames)
      ),
      valueKind,
      sceneContext,
      priorContext,
      sceneContent,
      rationaleInstructions: standardMetricRationaleInstructions(settings),
      bucketRationaleShape: standardMetricRationaleJsonShape(settings, "    "),
      itemRationaleShape: standardMetricRationaleJsonShape(settings, "      ")
    });
    const inputHash = evaluationInputHash(metricName, canonicalTargetName, prompt);

    if (shouldSkipEvaluation(metricKey, targetConfig.key, inputHash)) {
      logSkippedEvaluation(metricName, canonicalTargetName);
      return false;
    }

    const { rawResponse, parsedResponse: scores } = await requestModelJson(prompt);
    const sourceText = standardMetricSourceText(settings, {
      scene: sceneContent,
      definitions: `${definition}\n\n${targetDefinitions}`,
      sceneContext,
      priorScenes: priorContext
    });
    let normalizedScores = targetConfig.sceneOnly
      ? normalizeSceneOnlyScore(
        scores[targetConfig.key],
        metricName,
        rawResponse,
        settings,
        sourceText
      )
      : normalizeSubjectRelationshipScoreMap(
        scores[targetConfig.key],
        targetNames,
        targetConfig.label,
        rawResponse,
        settings,
        sourceText
      );

    normalizedScores = applyCalibrationToStandardScores(normalizedScores, metricName);
    writeStandardMetricObservations(metricName, targetConfig, normalizedScores, settings);
    markEvaluationInput(metricKey, targetConfig.key, inputHash, metricName, canonicalTargetName);
    return true;
  }

  async function evaluateRelationship(metricName, targetName) {
    const targetConfig = getTargetConfig(targetName);
    const configured = relationshipContractFor(metricName, targetConfig);
    if (!configured) {
      throw new Error(`No relationship contract permits "${metricName}" for target "${targetName}".`);
    }

    let contract = configured;
    if (contract.targetGuidance === "readerAwareness") {
      const guidance = readerAwarenessGuidance(targetConfig);
      contract = {
        ...contract,
        meaning: guidance.meaning,
        knowledgeBoundary: [contract.knowledgeBoundary, ...guidance.cautions]
          .filter(Boolean)
          .join("\n")
      };
    }

    const targetDefinitionEntries = getTargetDefinitions(targetConfig, contract.targetSelection);
    const targetNames = targetDefinitionEntries.map(definition => definition.name);
    const targetDefinitions = formatDefinitions(targetDefinitionEntries);
    let observerDefinitionEntries = [];
    let observers;

    if (contract.observer.mode === "entities") {
      const observerConfig = getTargetConfig(
        contract.observer.target ?? contract.observer.entityType ?? contract.observer.key
      );
      observerDefinitionEntries = getTargetDefinitions(observerConfig, contract.observer.targetSelection);
      observers = observerDefinitionEntries.map(definition => ({
        type: observerConfig.key,
        name: definition.name
      }));
    } else {
      observers = [{
        type: contract.observer.type ?? contract.observer.key,
        name: contract.observer.name
      }];
    }

    const observerNames = observers.map(observer => observer.name);
    if (targetNames.length === 0 || observerNames.length === 0) return false;
    const priorScenes = contract.priorContext === "chronology"
      ? listPriorChronologyScenes()
      : listPriorScenes();
    const priorContext = contract.priorContext === "chronology"
      ? formatPriorChronologyContext(priorScenes)
      : formatPriorSceneContext(priorScenes);
    const truthLedgerSupport = formatTruthLedgerSupport(
      targetConfig,
      targetNames,
      priorScenes,
      contract.priorContext === "chronology"
        ? "Prior chronology support before this scene"
        : "Reader-visible support before this scene"
    );
    const prompt = buildRelationshipPrompt({
      contract,
      targetConfig,
      targetNames,
      targetDefinitions,
      observerNames,
      observerDefinitions: formatDefinitions(observerDefinitionEntries),
      priorContext,
      truthLedgerSupport,
      linkedTargetsText: formatLinkedTargetEntries(linkedTargetEntries(sceneContent, targetNames)),
      linkedObserversText: formatLinkedTargetEntries(linkedTargetEntries(sceneContent, observerNames)),
      calibrationGuidance: calibrationPromptGuidance(metricName),
      rationaleInstructions: awarenessRationaleInstructions(),
      relationshipEntryShape: relationshipEntryJsonShape(contract.valueKind),
      sceneContent
    });
    const metricKey = dimensionKey(metricName);
    const inputHash = evaluationInputHash(metricName, targetConfig.target, prompt);
    const storageKey = contract.observer.storageKey ?? contract.observer.key ?? "observer";

    if (shouldSkipEvaluation(metricKey, targetConfig.key, inputHash, {
      relationship: true,
      dimension: dimensionKey(contract.dimension),
      storageKey,
      observerMode: contract.observer.mode
    })) {
      logSkippedEvaluation(metricName, targetConfig.target);
      return false;
    }

    let scores = {};
    if (targetNames.length > 0 && observerNames.length > 0) {
      const { parsedResponse } = await requestModelJson(prompt);
      scores = parsedResponse[targetConfig.key];
    }
    const sourceText = awarenessSourceText({
      scene: sceneContent,
      definitions: `${targetDefinitions}\n\n${formatDefinitions(observerDefinitionEntries)}`,
      priorScenes: `${priorContext}\n\n${truthLedgerSupport}`
    });
    let normalized = normalizeRelationshipMap(
      scores, targetNames, observerNames, contract, sourceText
    );
    normalized = applyCalibrationToRelationshipMap(normalized, metricName);
    writeRelationshipObservations(contract, targetConfig, normalized, observers);
    markEvaluationInput(metricKey, targetConfig.key, inputHash, metricName, targetConfig.target);
    return true;
  }

  async function evaluateTrajectory(metricName, targetName) {
    const targetConfig = getTargetConfig(targetName);
    const contract = trajectoryContractFor(metricName, targetConfig);
    if (!contract) {
      throw new Error(`No trajectory contract permits "${metricName}" for target "${targetName}".`);
    }
    const definitions = getTargetDefinitions(targetConfig, contract.targetSelection);
    const targetNames = definitions.map(definition => definition.name);
    if (targetNames.length === 0) return false;
    const targetDefinitions = formatDefinitions(definitions);
    const priorScenes = contract.priorContext === "chronology"
      ? listPriorChronologyScenes()
      : listPriorScenes();
    const priorContext = contract.priorContext === "chronology"
      ? formatPriorChronologyContext(priorScenes)
      : formatPriorSceneContext(priorScenes);
    const truthLedgerSupport = formatTruthLedgerSupport(
      targetConfig,
      targetNames,
      priorScenes,
      "Previously visible trajectory support"
    );
    const prompt = buildTrajectoryPrompt({
      contract,
      targetConfig,
      targetNames,
      targetDefinitions,
      priorContext,
      truthLedgerSupport,
      linkedTargetsText: formatLinkedTargetEntries(linkedTargetEntries(sceneContent, targetNames)),
      calibrationGuidance: calibrationPromptGuidance(metricName),
      rationaleInstructions: awarenessRationaleInstructions(),
      trajectoryEntryShape: trajectoryEntryJsonShape(),
      sceneContent
    });
    const metricKey = dimensionKey(metricName);
    const dimension = dimensionKey(contract.dimension);
    const inputHash = evaluationInputHash(metricName, targetConfig.target, prompt);
    if (shouldSkipEvaluation(metricKey, targetConfig.key, inputHash, {
      trajectory: true,
      dimension
    })) {
      logSkippedEvaluation(metricName, targetConfig.target);
      return false;
    }
    let scores = {};
    if (targetNames.length > 0) {
      const { parsedResponse } = await requestModelJson(prompt);
      scores = parsedResponse[targetConfig.key];
    }
    const sourceText = awarenessSourceText({
      scene: sceneContent,
      definitions: targetDefinitions,
      priorScenes: `${priorContext}\n\n${truthLedgerSupport}`
    });
    let normalized = normalizeTrajectoryMap(scores, targetNames, sourceText);
    normalized = applyCalibrationToTrajectoryMap(normalized, metricName);
    writeTrajectoryObservations(contract, targetConfig, normalized);
    markEvaluationInput(metricKey, targetConfig.key, inputHash, metricName, targetConfig.target);
    return true;
  }

  return {
    evaluateRelationship,
    evaluateStandardMetric,
    evaluateTrajectory
  };
}
