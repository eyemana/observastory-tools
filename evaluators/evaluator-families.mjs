import {
  buildCharacterAwarenessPrompt,
  buildReaderAwarenessPrompt,
  buildStandardMetricPrompt,
  readerAwarenessGuidance
} from "./prompt-builders.mjs";

export function createEvaluatorFamilies({
  sceneContent,
  getTargetConfig,
  getTargetDefinitions,
  selectStandardMetricDefinitions,
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
  logSkippedEvaluation
}) {
  const {
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
  } = responsePolicy;
  const {
    evaluationInputHash,
    markEvaluationInput,
    shouldSkipEvaluation,
    writeCharacterAwarenessObservations,
    writeReaderAwarenessObservations,
    writeStandardMetricObservations
  } = evaluationStore;

  async function evaluateStandardMetric(metricName, targetName) {
    const metricKey = dimensionKey(metricName);
    const targetConfig = getTargetConfig(targetName);
    const canonicalTargetName = targetConfig.target;
    const settings = standardMetricSettings(metricName);
    const targetDefinitionEntries = selectStandardMetricDefinitions(
      getTargetDefinitions(targetConfig),
      settings
    );
    const targetNames = targetDefinitionEntries.map(definition => definition.name);
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

    let normalizedScores;

    if (!targetConfig.sceneOnly && targetNames.length === 0) {
      normalizedScores = { scene: 0, items: {} };
      if (settings.rationaleMode === "paraphrase") {
        normalizedScores[settings.rationaleField] =
          `No eligible ${targetConfig.pluralLabel} were available for this evaluation.`;
      } else if (settings.rationaleMode === "extractive") {
        normalizedScores.evidence = [];
      }
    } else {
      const { rawResponse, parsedResponse: scores } = await requestModelJson(prompt);
      const sourceText = standardMetricSourceText(settings, {
        scene: sceneContent,
        definitions: `${definition}\n\n${targetDefinitions}`,
        sceneContext,
        priorScenes: priorContext
      });
      normalizedScores = targetConfig.sceneOnly
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
    }

    normalizedScores = applyCalibrationToStandardScores(normalizedScores, metricName);
    writeStandardMetricObservations(metricName, targetConfig, normalizedScores, settings);
    markEvaluationInput(metricKey, targetConfig.key, inputHash, metricName, canonicalTargetName);
    return true;
  }

  async function evaluateCharacterAwareness(targetName) {
    const requestedTargetConfig = getTargetConfig(targetName);
    if (requestedTargetConfig.key !== "plotThreads") {
      throw new Error(
        `character awareness only supports target "plot thread". Received "${targetName}".`
      );
    }

    const characterConfig = getTargetConfig("character");
    const plotThreadConfig = getTargetConfig("plot thread");
    const canonicalTargetName = plotThreadConfig.target;
    const characterDefinitionEntries = getTargetDefinitions(characterConfig);
    const plotThreadDefinitionEntries = getTargetDefinitions(plotThreadConfig);
    const characterNames = characterDefinitionEntries.map(definition => definition.name);
    const plotThreadNames = plotThreadDefinitionEntries.map(definition => definition.name);
    const characterDefinitions = formatDefinitions(characterDefinitionEntries);
    const plotThreadDefinitions = formatDefinitions(plotThreadDefinitionEntries);
    const priorChronologyScenes = listPriorChronologyScenes();
    const priorChronologyContext = formatPriorChronologyContext(priorChronologyScenes);
    const truthLedgerSupport = formatTruthLedgerSupport(
      plotThreadConfig,
      plotThreadNames,
      priorChronologyScenes,
      "Prior chronology support before this scene"
    );
    const prompt = buildCharacterAwarenessPrompt({
      characterNames,
      plotThreadNames,
      characterDefinitions,
      plotThreadDefinitions,
      priorChronologyContext,
      truthLedgerSupport,
      linkedCharactersText: formatLinkedTargetEntries(
        linkedTargetEntries(sceneContent, characterNames)
      ),
      linkedPlotThreadsText: formatLinkedTargetEntries(
        linkedTargetEntries(sceneContent, plotThreadNames)
      ),
      calibrationGuidance: calibrationPromptGuidance("character awareness"),
      rationaleInstructions: awarenessRationaleInstructions(),
      awarenessEntryShape: awarenessEntryJsonShape(),
      sceneContent
    });
    const inputHash = evaluationInputHash(
      "character awareness",
      canonicalTargetName,
      prompt
    );

    if (shouldSkipEvaluation("characterAwareness", "plotThreads", inputHash)) {
      logSkippedEvaluation("character awareness", canonicalTargetName);
      return false;
    }

    let plotThreads;
    if (characterNames.length === 0 || plotThreadNames.length === 0) {
      plotThreads = normalizeCharacterAwarenessMap(
        {},
        plotThreadNames,
        characterNames,
        awarenessSourceText({ scene: sceneContent })
      );
    } else {
      const { parsedResponse: scores } = await requestModelJson(prompt);
      plotThreads = normalizeCharacterAwarenessMap(
        scores.plotThreads,
        plotThreadNames,
        characterNames,
        awarenessSourceText({
          scene: sceneContent,
          definitions: [characterDefinitions, plotThreadDefinitions].join("\n\n"),
          priorScenes: `${priorChronologyContext}\n\n${truthLedgerSupport}`
        })
      );
    }

    plotThreads = applyCalibrationToCharacterAwarenessMap(
      plotThreads,
      "character awareness"
    );
    writeCharacterAwarenessObservations(plotThreadConfig, plotThreads);
    markEvaluationInput(
      "characterAwareness",
      "plotThreads",
      inputHash,
      "character awareness",
      canonicalTargetName
    );
    return true;
  }

  async function evaluateReaderAwareness(targetName) {
    const targetConfig = getTargetConfig(targetName);
    const targetDefinitionEntries = getTargetDefinitions(targetConfig);
    const targetNames = targetDefinitionEntries.map(definition => definition.name);
    const targetDefinitions = formatDefinitions(targetDefinitionEntries);
    const priorScenes = listPriorScenes();
    const priorSceneContext = formatPriorSceneContext(priorScenes);
    const truthLedgerSupport = formatTruthLedgerSupport(
      targetConfig,
      targetNames,
      priorScenes,
      "Reader-visible support before this scene"
    );
    const prompt = buildReaderAwarenessPrompt({
      targetConfig,
      targetNames,
      targetDefinitions,
      priorSceneContext,
      truthLedgerSupport,
      linkedTargetsText: formatLinkedTargetEntries(
        linkedTargetEntries(sceneContent, targetNames)
      ),
      guidance: readerAwarenessGuidance(targetConfig),
      calibrationGuidance: calibrationPromptGuidance("reader awareness"),
      rationaleInstructions: awarenessRationaleInstructions(),
      awarenessShape: awarenessJsonShape(targetConfig),
      sceneContent
    });
    const inputHash = evaluationInputHash("reader awareness", targetConfig.target, prompt);

    if (shouldSkipEvaluation("readerAwareness", targetConfig.key, inputHash)) {
      logSkippedEvaluation("reader awareness", targetConfig.target);
      return false;
    }

    let targetScores;
    if (targetNames.length === 0) {
      targetScores = normalizeReaderAwarenessMap(
        {},
        targetNames,
        awarenessSourceText({ scene: sceneContent })
      );
    } else {
      const { parsedResponse: scores } = await requestModelJson(prompt);
      targetScores = normalizeReaderAwarenessMap(
        scores[targetConfig.key],
        targetNames,
        awarenessSourceText({
          scene: sceneContent,
          definitions: targetDefinitions,
          priorScenes: `${priorSceneContext}\n\n${truthLedgerSupport}`
        })
      );
    }

    targetScores = applyCalibrationToReaderAwarenessMap(
      targetScores,
      "reader awareness"
    );
    writeReaderAwarenessObservations(targetConfig, targetScores);
    markEvaluationInput(
      "readerAwareness",
      targetConfig.key,
      inputHash,
      "reader awareness",
      targetConfig.target
    );
    return true;
  }

  return {
    evaluateCharacterAwareness,
    evaluateReaderAwareness,
    evaluateStandardMetric
  };
}
