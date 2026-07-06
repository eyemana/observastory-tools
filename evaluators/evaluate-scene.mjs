import fs from "fs";
import path from "path";
import matter from "gray-matter";

import { fileURLToPath } from "url";
import {
  findStoryRoot,
  readDefinition,
  formatDefinitions,
  toCamelCase
} from "../vault-utils.mjs";
import { getStoryConfig, loadConfig } from "../tool-config.mjs";
import { compareChronologySort } from "../chronology/chronology-utils.mjs";
import {
  applyNameFilters,
  getEvaluationProfile,
  listEligibleDefinitions
} from "../evaluation-filters.mjs";

const __filename = fileURLToPath(import.meta.url);
const evaluatorRoot = path.dirname(__filename);
const toolRoot = path.join(evaluatorRoot, "..");
const config = loadConfig(toolRoot);
const storyConfig = getStoryConfig(config);
const storyFolders = storyConfig.folders;
const awarenessConfig = config.awareness ?? {};
const awarenessRationaleMode = ["off", "extractive", "paraphrase"].includes(
  awarenessConfig.rationaleMode
)
  ? awarenessConfig.rationaleMode
  : "paraphrase";
const awarenessRationaleSources = Array.isArray(awarenessConfig.rationaleSources)
  ? new Set(awarenessConfig.rationaleSources)
  : new Set(["scene", "definitions", "priorScenes"]);
const standardMetricsConfig = config.standardMetrics ?? {};

function readOption(args, name) {
  const index = args.indexOf(name);

  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

function removeOption(args, name) {
  const index = args.indexOf(name);

  if (index === -1) {
    return args;
  }

  return [
    ...args.slice(0, index),
    ...args.slice(index + 2)
  ];
}

const args = process.argv.slice(2);
const filePath = args[0];
const metricName = args[1];
const evaluationProfileName = readOption(args, "--profile");
const targetArgs = removeOption(args.slice(2), "--profile");
const targetName = targetArgs.join(" ");
const evaluationProfile = getEvaluationProfile(config, evaluationProfileName);

if (!filePath || !metricName || !targetName) {
  console.error("Usage: node evaluate-scene.mjs <file> <metricName> <targetName>");
  process.exit(1);
}

const targetConfigs = {
  Character: {
    key: "characters",
    folder: storyFolders.characters,
    label: "character",
    pluralLabel: "characters"
  },
  "Plot Thread": {
    key: "plotThreads",
    folder: storyFolders.plotThreads,
    label: "plot thread",
    pluralLabel: "plot threads"
  },
  "Story Engine": {
    key: "storyEngines",
    folder: storyFolders.storyEngines,
    label: "story engine",
    pluralLabel: "story engines"
  },
  Arc: {
    key: "arcs",
    folder: storyFolders.arcs,
    label: "arc",
    pluralLabel: "arcs"
  },
  Scene: {
    key: "scene",
    folder: null,
    label: "scene",
    pluralLabel: "scene",
    sceneOnly: true
  }
};

function getTargetConfig(targetName) {
  const normalized = targetName.trim();

  if (targetConfigs[normalized]) {
    return targetConfigs[normalized];
  }

  throw new Error(
    `Invalid target "${targetName}". Expected one of: ${Object.keys(targetConfigs).join(", ")}`
  );
}

function isCharacterAwarenessMetric(metricName) {
  return toCamelCase(metricName) === "characterAwareness";
}

function isReaderAwarenessMetric(metricName) {
  return toCamelCase(metricName) === "readerAwareness";
}

function standardMetricSettings(metricName) {
  const defaultSettings = standardMetricsConfig.default ?? {};
  const metricSettings =
    standardMetricsConfig.metrics?.[metricName] ??
    standardMetricsConfig.metrics?.[toCamelCase(metricName)] ??
    {};
  const rationaleMode = ["off", "extractive", "paraphrase"].includes(
    metricSettings.rationaleMode ?? defaultSettings.rationaleMode
  )
    ? metricSettings.rationaleMode ?? defaultSettings.rationaleMode
    : "paraphrase";
  const rationaleSources = Array.isArray(
    metricSettings.rationaleSources ?? defaultSettings.rationaleSources
  )
    ? metricSettings.rationaleSources ?? defaultSettings.rationaleSources
    : ["scene", "definitions"];
  const rationaleField =
    typeof (metricSettings.rationaleField ?? defaultSettings.rationaleField) === "string"
      ? metricSettings.rationaleField ?? defaultSettings.rationaleField
      : "sceneRationale";
  const rationaleType =
    typeof metricSettings.rationaleType === "string"
      ? metricSettings.rationaleType
      : `${metricName.toLowerCase()} rationale`;

  return {
    rationaleMode,
    rationaleSources: new Set(rationaleSources),
    rationaleField,
    rationaleType
  };
}

function clampNumber(value, min, max, fallback = 0) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, number));
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function isExactExcerpt(excerpt, sourceText) {
  if (!excerpt || !sourceText) {
    return false;
  }

  if (sourceText.includes(excerpt)) {
    return true;
  }

  return normalizeWhitespace(sourceText).includes(normalizeWhitespace(excerpt));
}

function evidenceTextFromItem(item) {
  if (typeof item === "string") {
    return item;
  }

  if (item && typeof item === "object") {
    return item.text ?? item.excerpt ?? "";
  }

  return "";
}

function normalizeEvidence(rawEvidence, sourceText) {
  const items = Array.isArray(rawEvidence) ? rawEvidence : [];
  const seen = new Set();
  const evidence = [];

  for (const item of items) {
    const text = evidenceTextFromItem(item).trim();

    if (!text || seen.has(text) || !isExactExcerpt(text, sourceText)) {
      continue;
    }

    seen.add(text);
    evidence.push(text);

    if (evidence.length >= 3) {
      break;
    }
  }

  return evidence;
}

function awarenessSourceText(parts) {
  return Object.entries(parts)
    .filter(([name]) => awarenessRationaleSources.has(name))
    .map(([, value]) => value)
    .filter(Boolean)
    .join("\n\n");
}

function awarenessSourceListText() {
  const sourceLabels = {
    scene: "current scene",
    definitions: "supplied definitions",
    priorScenes: "prior scene context"
  };

  return [...awarenessRationaleSources]
    .map(source => sourceLabels[source] ?? source)
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

function standardMetricRationaleInstructions(settings) {
  if (settings.rationaleMode === "off") {
    return "Do not return rationale, evidence, excerpts, or explanatory prose.";
  }

  if (settings.rationaleMode === "extractive") {
    return `
Do not return paraphrased rationale or explanatory prose.
Return evidence as 0-3 exact excerpts copied from the supplied scene or definitions.
Each evidence excerpt must use the author's own words exactly.`;
  }

  return `
Return ${settings.rationaleType} as one tight sentence supporting the associated score value.
Use the JSON field "${settings.rationaleField}" for that rationale.`;
}

function standardMetricRationaleJsonShape(settings, indent = "    ") {
  if (settings.rationaleMode === "off") {
    return "";
  }

  if (settings.rationaleMode === "extractive") {
    return `,
${indent}"evidence": ["exact excerpt"]`;
  }

  return `,
${indent}"${settings.rationaleField}": string`;
}

function readStandardMetricRationale(rawValue, settings) {
  if (!rawValue || typeof rawValue !== "object") {
    return "";
  }

  const configured = rawValue[settings.rationaleField];

  if (typeof configured === "string") {
    return configured;
  }

  if (typeof rawValue.sceneRationale === "string") {
    return rawValue.sceneRationale;
  }

  if (typeof rawValue.rationale === "string") {
    return rawValue.rationale;
  }

  return "";
}

function normalizeStandardMetricEntry(rawValue, settings, sourceText) {
  const rawObject =
    rawValue && typeof rawValue === "object"
      ? rawValue
      : {};
  const normalized = {
    scene: typeof rawObject.scene === "number" ? rawObject.scene : 0
  };

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

function awarenessJsonShape(targetConfig) {
  return `{
  "${targetConfig.key}": {
    "${targetConfig.label}Name": ${awarenessEntryJsonShape()}
  }
}`;
}

function awarenessEntryJsonShape() {
  const rationaleShape =
    awarenessRationaleMode === "paraphrase"
      ? `,
      "rationale": "string"`
      : "";
  const evidenceShape =
    awarenessRationaleMode === "extractive"
      ? `,
      "evidence": ["exact excerpt"]`
      : "";

  return `{
  "delta": number,
  "salience": number,
  "confidence": number,
  "alignment": number,
  "evidenceStrength": number${rationaleShape}${evidenceShape}
}`;
}

function normalizeAwarenessEntry(rawValue, sourceText) {
  let rawObject = {};

  if (typeof rawValue === "number") {
    rawObject = { delta: rawValue };
  } else if (rawValue && typeof rawValue === "object") {
    rawObject = rawValue;
  }

  const normalized = {
    delta: clampNumber(rawObject.delta, 0, 10),
    salience: clampNumber(rawObject.salience, 0, 10),
    confidence: clampNumber(rawObject.confidence, 0, 10),
    alignment: clampNumber(rawObject.alignment, -10, 10),
    evidenceStrength: clampNumber(rawObject.evidenceStrength, 0, 10)
  };

  if (awarenessRationaleMode === "paraphrase") {
    normalized.rationale =
      typeof rawObject.rationale === "string" ? rawObject.rationale : "";
  } else if (awarenessRationaleMode === "extractive") {
    normalized.evidence = normalizeEvidence(
      rawObject.evidence ?? rawObject.excerpts,
      sourceText
    );
  }

  return normalized;
}

async function fetchJsonFromOllama(prompt) {
  const response = await fetch(config.ollamaUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.model,
      format: "json",
      prompt,
      stream: false,
      options: {
        temperature: 0
      }
    })
  });

  const result = await response.json();

  try {
    return {
      rawResponse: result.response,
      parsedResponse: JSON.parse(result.response)
    };
  } catch {
    throw new Error(`Invalid JSON response: ${result.response}`);
  }
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
    const empty = {
      scene: 0,
      items: {}
    };

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

  const normalized = {
    scene: 0,
    items: {}
  };

  const returnedItemScores = [];

  for (const name of expectedNames) {
    const rawValue = bucket[name];

    if (
      rawValue &&
      typeof rawValue === "object" &&
      typeof rawValue.scene === "number"
    ) {
      normalized.items[name] = normalizeStandardMetricEntry(
        rawValue,
        settings,
        sourceText
      );
      returnedItemScores.push(rawValue.scene);
    } else {
      normalized.items[name] = { scene: 0 };

      if (settings.rationaleMode === "paraphrase") {
        normalized.items[name][settings.rationaleField] =
          `${label} was selected for evaluation, but the model did not return a scene score.`;
      } else if (settings.rationaleMode === "extractive") {
        normalized.items[name].evidence = [];
      }
    }
  }

  if (typeof bucket.scene === "number") {
    normalized.scene = bucket.scene;
  } else if (returnedItemScores.length > 0) {
    const sum = returnedItemScores.reduce((total, score) => total + score, 0);
    normalized.scene = Math.round(sum / returnedItemScores.length);
  } else {
    throw new Error(`Invalid ${label} scene score: ${rawResponse}`);
  }

  if (settings.rationaleMode === "paraphrase") {
    const sceneRationale = readStandardMetricRationale(bucket, settings);

    normalized[settings.rationaleField] =
      sceneRationale ||
      (
        returnedItemScores.length > 0
          ? `Aggregate ${label} score derived from returned item scores.`
          : ""
      );
  } else if (settings.rationaleMode === "extractive") {
    normalized.evidence = normalizeEvidence(
      bucket.evidence ?? bucket.excerpts,
      sourceText
    );
  }

  return normalized;
}

function normalizeSceneOnlyScore(bucket, label, rawResponse, settings, sourceText) {
  if (!bucket || typeof bucket !== "object") {
    throw new Error(`Invalid ${label} scene score: ${rawResponse}`);
  }

  if (typeof bucket.scene !== "number") {
    throw new Error(`Invalid ${label} scene score: ${rawResponse}`);
  }

  return normalizeStandardMetricEntry(bucket, settings, sourceText);
}

function normalizeCharacterAwarenessMap(scores, plotThreadNames, characterNames, sourceText) {
  const normalized = {};

  const source =
    scores && typeof scores === "object"
      ? scores
      : {};

  for (const plotThreadName of plotThreadNames) {
    const rawPlotThread = source[plotThreadName];
    const normalizedCharacters = {};

    for (const characterName of characterNames) {
      const rawCharacter =
        rawPlotThread &&
        typeof rawPlotThread === "object"
          ? rawPlotThread[characterName]
          : undefined;

      normalizedCharacters[characterName] =
        normalizeAwarenessEntry(rawCharacter, sourceText);
    }

    normalized[plotThreadName] = normalizedCharacters;
  }

  return normalized;
}

function normalizeReaderAwarenessMap(scores, targetNames, sourceText) {
  const normalized = {};
  const source =
    scores && typeof scores === "object"
      ? scores
      : {};

  for (const targetName of targetNames) {
    const rawTarget = source[targetName];

    normalized[targetName] = normalizeAwarenessEntry(rawTarget, sourceText);
  }

  return normalized;
}

function writeFileAtomic(targetPath, content) {
  const directory = path.dirname(targetPath);
  const basename = path.basename(targetPath);
  const tempPath = path.join(
    directory,
    `.${basename}.${process.pid}.${Date.now()}.tmp`
  );

  fs.writeFileSync(tempPath, content, "utf8");
  fs.renameSync(tempPath, targetPath);
}

const raw = fs.readFileSync(filePath, "utf8");
const parsed = matter(raw);
const pocRoot = findStoryRoot(filePath, storyConfig);

parsed.data.ai = parsed.data.ai ?? {};
parsed.data.ai.model = config.model;

function explicitTargetField(prefix, targetConfig) {
  return `${prefix}${targetConfig.key[0].toUpperCase()}${targetConfig.key.slice(1)}`;
}

function getTargetDefinitions(targetConfig) {
  if (targetConfig.sceneOnly) {
    return [];
  }

  const definitions = listEligibleDefinitions(
    pocRoot,
    targetConfig.folder,
    evaluationProfile.elementFilters
  );
  const names = definitions.map((definition) => definition.name);
  const includeField = explicitTargetField("include", targetConfig);
  const excludeField = explicitTargetField("exclude", targetConfig);
  const filteredNames = new Set(
    applyNameFilters(
      names,
      parsed.data[includeField],
      parsed.data[excludeField]
    )
  );

  return definitions.filter((definition) => filteredNames.has(definition.name));
}

function getTargetNames(targetConfig) {
  return getTargetDefinitions(targetConfig).map((definition) => definition.name);
}

function numericFrontmatter(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getStoryOrder(scene) {
  const chapterOrder = numericFrontmatter(scene.data.chapter_order) ??
    numericFrontmatter(scene.data.chapter);
  const sceneOrder = numericFrontmatter(scene.data.scene_order);

  if (chapterOrder === null || sceneOrder === null) {
    return null;
  }

  return {
    chapterOrder,
    sceneOrder
  };
}

function getChronologyOrder(scene) {
  const generatedSort = scene.data.ai?.chronology?.sort;

  if (generatedSort !== undefined && generatedSort !== null && generatedSort !== "") {
    return String(generatedSort);
  }

  const legacyOrder = numericFrontmatter(scene.data.chronology_order);
  return legacyOrder === null ? null : String(legacyOrder);
}

function compareStoryOrder(a, b) {
  if (a.storyOrder && b.storyOrder) {
    if (a.storyOrder.chapterOrder !== b.storyOrder.chapterOrder) {
      return a.storyOrder.chapterOrder - b.storyOrder.chapterOrder;
    }

    if (a.storyOrder.sceneOrder !== b.storyOrder.sceneOrder) {
      return a.storyOrder.sceneOrder - b.storyOrder.sceneOrder;
    }
  } else if (a.storyOrder) {
    return -1;
  } else if (b.storyOrder) {
    return 1;
  }

  return a.fileName.localeCompare(b.fileName);
}

function compareChronologyOrder(a, b) {
  if (a.chronologyOrder !== null && b.chronologyOrder !== null) {
    const chronology = compareChronologySort(a.chronologyOrder, b.chronologyOrder);
    if (chronology !== 0) return chronology;
  } else if (a.chronologyOrder !== null) {
    return -1;
  } else if (b.chronologyOrder !== null) {
    return 1;
  }

  return compareStoryOrder(a, b);
}

function isPriorStoryScene(scene, currentOrder, currentName) {
  if (currentOrder === null) {
    return scene.fileName.localeCompare(currentName) < 0;
  }

  if (scene.storyOrder === null) {
    return false;
  }

  if (scene.storyOrder.chapterOrder !== currentOrder.chapterOrder) {
    return scene.storyOrder.chapterOrder < currentOrder.chapterOrder;
  }

  return scene.storyOrder.sceneOrder < currentOrder.sceneOrder;
}

function isPriorChronologyScene(scene, currentOrder, currentName) {
  if (currentOrder === null) {
    return false;
  }

  if (scene.chronologyOrder === null) {
    return false;
  }

  if (scene.chronologyOrder !== currentOrder) {
    return compareChronologySort(scene.chronologyOrder, currentOrder) < 0;
  }

  return scene.fileName.localeCompare(currentName) < 0;
}

function listPriorScenes(currentFilePath, currentScene) {
  const scenesFolder = path.dirname(currentFilePath);
  const currentOrder = getStoryOrder(currentScene);
  const currentName = path.basename(currentFilePath);

  return fs.readdirSync(scenesFolder, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .filter(entry => entry.name.endsWith(".md"))
    .filter(entry => entry.name !== currentName)
    .map(entry => {
      const scenePath = path.join(scenesFolder, entry.name);
      const scene = matter(fs.readFileSync(scenePath, "utf8"));

      return {
        fileName: entry.name,
        name: scene.data.name ?? path.basename(entry.name, ".md"),
        storyOrder: getStoryOrder(scene),
        chronologyOrder: getChronologyOrder(scene),
        readerKnowledge: scene.data.reader_knowledge ?? "",
        characters: scene.data.characters ?? [],
        plotThreads: scene.data.plotThreads ?? [],
        arcs: scene.data.arcs ?? [],
        content: scene.content.trim()
      };
    })
    .filter(scene => isPriorStoryScene(scene, currentOrder, currentName))
    .sort(compareStoryOrder);
}

function listPriorChronologyScenes(currentFilePath, currentScene) {
  const scenesFolder = path.dirname(currentFilePath);
  const currentOrder = getChronologyOrder(currentScene);
  const currentName = path.basename(currentFilePath);

  return fs.readdirSync(scenesFolder, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .filter(entry => entry.name.endsWith(".md"))
    .filter(entry => entry.name !== currentName)
    .map(entry => {
      const scenePath = path.join(scenesFolder, entry.name);
      const scene = matter(fs.readFileSync(scenePath, "utf8"));

      return {
        fileName: entry.name,
        name: scene.data.name ?? path.basename(entry.name, ".md"),
        storyOrder: getStoryOrder(scene),
        chronologyOrder: getChronologyOrder(scene),
        readerKnowledge: scene.data.reader_knowledge ?? "",
        characters: scene.data.characters ?? [],
        plotThreads: scene.data.plotThreads ?? [],
        arcs: scene.data.arcs ?? [],
        content: scene.content.trim()
      };
    })
    .filter(scene => isPriorChronologyScene(scene, currentOrder, currentName))
    .sort(compareChronologyOrder);
}

function formatPriorSceneContext(scenes) {
  if (scenes.length === 0) {
    return "No prior scene context is available. Treat all reader-facing information in this scene as newly available to the reader.";
  }

  return scenes.map(scene => {
    return `Scene: ${scene.name}
Story order: ${
  scene.storyOrder
    ? `${scene.storyOrder.chapterOrder}.${scene.storyOrder.sceneOrder}`
    : "unknown"
}
Reader knowledge marker: ${scene.readerKnowledge || "unspecified"}
Characters: ${JSON.stringify(scene.characters)}
Plot threads: ${JSON.stringify(scene.plotThreads)}
Arcs: ${JSON.stringify(scene.arcs)}
Text:
${scene.content}`;
  }).join("\n\n---\n\n");
}

function formatPriorChronologyContext(scenes) {
  if (scenes.length === 0) {
    return "No prior chronology context is available. Treat character-facing information in this scene as newly available only if the character can plausibly learn it in this scene.";
  }

  return scenes.map(scene => {
    return `Scene: ${scene.name}
Generated chronology sort: ${scene.chronologyOrder ?? "unknown"}
Story order: ${
  scene.storyOrder
    ? `${scene.storyOrder.chapterOrder}.${scene.storyOrder.sceneOrder}`
    : "unknown"
}
Characters: ${JSON.stringify(scene.characters)}
Plot threads: ${JSON.stringify(scene.plotThreads)}
Arcs: ${JSON.stringify(scene.arcs)}
Text:
${scene.content}`;
  }).join("\n\n---\n\n");
}

function buildStandardMetricPrompt(
  metricName,
  targetConfig,
  targetNames,
  targetDefinitions,
  settings
) {
  const metricDefinition = readDefinition(
    pocRoot,
    storyFolders.metrics,
    metricName
  );

  if (targetConfig.sceneOnly) {
    return `
Return JSON only.
Return compact valid JSON.
Do not include trailing commas.
Every opened object must be closed.
Do not include markdown.

Score only this scene.
Do not use other scenes, truth ledgers, chronology, or external story context.

${standardMetricRationaleInstructions(settings)}

Use this definition of ${metricName}:
${metricDefinition}

Scene:

${parsed.content}

Required JSON:
{
  "${targetConfig.key}": {
    "scene": number${standardMetricRationaleJsonShape(settings, "    ")}
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

${targetConfig.pluralLabel} to score:
${JSON.stringify(targetNames, null, 2)}

You must return one score object for every listed ${targetConfig.label}.
Use EXACTLY the listed names as JSON keys.
Do not omit any listed item.
Do not add unlisted items.
If an item is barely present, still include it with a low score and configured rationale output.

${standardMetricRationaleInstructions(settings)}

Use this definition of ${metricName}:
${metricDefinition}

Use these ${targetConfig.pluralLabel} definitions:
${targetDefinitions}

Scene:

${parsed.content}

Required JSON:
{
  "${targetConfig.key}": {
    "scene": number${standardMetricRationaleJsonShape(settings, "    ")},
    "${targetConfig.label}Name": {
      "scene": number${standardMetricRationaleJsonShape(settings, "      ")}
    }
  }
}
`;
}

async function evaluateStandardMetric(metricName, targetName) {
  const metricKey = toCamelCase(metricName);
  const targetConfig = getTargetConfig(targetName);
  const settings = standardMetricSettings(metricName);

  const targetDefinitionEntries = getTargetDefinitions(targetConfig);
  const targetNames = targetDefinitionEntries.map((definition) => definition.name);
  const targetDefinitions = targetConfig.sceneOnly
    ? ""
    : formatDefinitions(targetDefinitionEntries);

  let normalizedScores;

  if (!targetConfig.sceneOnly && targetNames.length === 0) {
    normalizedScores = {
      scene: 0,
      items: {}
    };

    if (settings.rationaleMode === "paraphrase") {
      normalizedScores[settings.rationaleField] =
        `No eligible ${targetConfig.pluralLabel} were available for this evaluation.`;
    } else if (settings.rationaleMode === "extractive") {
      normalizedScores.evidence = [];
    }
  } else {
    const prompt = buildStandardMetricPrompt(
      metricName,
      targetConfig,
      targetNames,
      targetDefinitions,
      settings
    );

    const { rawResponse, parsedResponse: scores } = await fetchJsonFromOllama(prompt);

    const sourceText = standardMetricSourceText(settings, {
      scene: parsed.content,
      definitions: `${readDefinition(pocRoot, storyFolders.metrics, metricName)}\n\n${targetDefinitions}`
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

  parsed.data.ai[metricKey] = parsed.data.ai[metricKey] ?? {};

  parsed.data.ai[metricKey][targetConfig.key] = {
    scene: normalizedScores.scene
  };

  if (settings.rationaleMode === "paraphrase") {
    parsed.data.ai[metricKey][targetConfig.key][settings.rationaleField] =
      normalizedScores[settings.rationaleField] ?? "";
  } else if (settings.rationaleMode === "extractive") {
    parsed.data.ai[metricKey][targetConfig.key].evidence =
      normalizedScores.evidence ?? [];
  }

  for (const [name, value] of Object.entries(normalizedScores.items ?? {})) {
    parsed.data.ai[metricKey][targetConfig.key][name] = value;
  }

  parsed.data.ai[metricKey].updated = new Date().toISOString();
}

function buildCharacterAwarenessPrompt(
  characterNames,
  plotThreadNames,
  characterDefinitions,
  plotThreadDefinitions,
  priorChronologyContext
) {
  return `
Return JSON only.
Return compact valid JSON.
Do not include trailing commas.
Every opened object must be closed.
Do not include markdown.

Evaluate character awareness of plot threads for this scene.

Characters:
${JSON.stringify(characterNames, null, 2)}

Plot Threads:
${JSON.stringify(plotThreadNames, null, 2)}

Use EXACTLY the listed plot thread names as JSON keys.
Use EXACTLY the listed character names as JSON keys.
Do not shorten names.
Do not use first names.
Do not add unlisted characters or plot threads.
Do not omit listed characters or plot threads.

Character awareness means how much NEW information a character gains during this scene about a plot thread.

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

${awarenessRationaleInstructions()}

Use these character definitions:
${characterDefinitions}

Use these plot thread definitions:
${plotThreadDefinitions}

Prior chronology context for comparison:
${priorChronologyContext}

Scene:

${parsed.content}

Required JSON:
{
  "plotThreads": {
    "plotThreadName": {
      "characterName": ${awarenessEntryJsonShape()}
    }
  }
}
`;
}

async function evaluateCharacterAwareness(targetName) {
  if (targetName !== "Plot Thread") {
    throw new Error(
      `Character Awareness only supports target "Plot Thread". Received "${targetName}".`
    );
  }

  const characterConfig = getTargetConfig("Character");
  const plotThreadConfig = getTargetConfig("Plot Thread");
  const characterDefinitionEntries = getTargetDefinitions(characterConfig);
  const plotThreadDefinitionEntries = getTargetDefinitions(plotThreadConfig);
  const characterNames = characterDefinitionEntries.map((definition) => definition.name);
  const plotThreadNames = plotThreadDefinitionEntries.map((definition) => definition.name);
  const characterDefinitions = formatDefinitions(characterDefinitionEntries);
  const plotThreadDefinitions = formatDefinitions(plotThreadDefinitionEntries);

  let plotThreads;

  if (characterNames.length === 0 || plotThreadNames.length === 0) {
    plotThreads = normalizeCharacterAwarenessMap(
      {},
      plotThreadNames,
      characterNames,
      awarenessSourceText({ scene: parsed.content })
    );
  } else {
    const priorChronologyContext = formatPriorChronologyContext(
      listPriorChronologyScenes(filePath, parsed)
    );
    const prompt = buildCharacterAwarenessPrompt(
      characterNames,
      plotThreadNames,
      characterDefinitions,
      plotThreadDefinitions,
      priorChronologyContext
    );

    const { parsedResponse: scores } = await fetchJsonFromOllama(prompt);

    plotThreads = normalizeCharacterAwarenessMap(
      scores.plotThreads,
      plotThreadNames,
      characterNames,
      awarenessSourceText({
        scene: parsed.content,
        definitions: [
          characterDefinitions,
          plotThreadDefinitions
        ].join("\n\n"),
        priorScenes: priorChronologyContext
      })
    );
  }

  parsed.data.ai.characterAwareness = parsed.data.ai.characterAwareness ?? {};
  parsed.data.ai.characterAwareness.plotThreads = plotThreads;
  parsed.data.ai.characterAwareness.updated = new Date().toISOString();
}

function getReaderAwarenessGuidance(targetConfig) {
  if (targetConfig.key === "characters") {
    return {
      subject: "characters",
      meaning:
        "Reader awareness means how much this scene increases, refreshes, or reinforces reader-facing awareness of a character, including explicit mention, first introduction, existence, role, relationship to the setting or cast, behavior, habits, traits, goals, stakes, choices, or reputation.",
      low:
        "1-3 = the reader receives minor, indirect, confirmatory, first-contact, or salience-building awareness of the character.",
      medium:
        "4-6 = the reader gains meaningful new information about the character's role, traits, relationships, goals, history, choices, or stakes.",
      high:
        "7-9 = the reader gains major new understanding of the character.",
      decisive:
        "10 = the reader receives a decisive revelation about the character.",
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
      meaning:
        "Reader awareness means how much NEW evidence the reader receives during this scene that an arc is progressing, changing direction, deepening, or resolving.",
      low:
        "1-3 = the reader receives minor, indirect, or confirmatory evidence of arc movement.",
      medium:
        "4-6 = the reader receives meaningful evidence of progress, regression, complication, or change in the arc.",
      high:
        "7-9 = the reader receives major evidence of arc movement or a significant turning point.",
      decisive:
        "10 = the reader receives decisive evidence of a major arc breakthrough, reversal, or resolution.",
      cautions: [
        "Score evidence shown to the reader, not author intent that remains invisible on the page.",
        "Do not score whether the arc is important in the story.",
        "If the scene only repeats already-established arc movement, use delta 0 or a low confirmatory score."
      ]
    };
  }

  return {
    subject: "plot threads",
    meaning:
      "Reader awareness means how much NEW information the reader gains during this scene about a plot thread.",
    low:
      "1-3 = the reader gains minor, indirect, or confirmatory information about the plot thread.",
    medium:
      "4-6 = the reader gains meaningful new information or a clearer connection.",
    high:
      "7-9 = the reader gains major new understanding.",
    decisive:
      "10 = the reader receives a decisive revelation about the plot thread.",
    cautions: [
      "Do not score plot importance.",
      "If the scene repeats information the reader already had, use delta 0 or a low confirmatory score."
    ]
  };
}

function buildReaderAwarenessPrompt(targetConfig, targetNames, targetDefinitions, priorSceneContext) {
  const guidance = getReaderAwarenessGuidance(targetConfig);

  return `
Return JSON only.
Return compact valid JSON.
Do not include trailing commas.
Every opened object must be closed.
Do not include markdown.

Evaluate reader awareness of ${guidance.subject} for this scene.

${targetConfig.pluralLabel}:
${JSON.stringify(targetNames, null, 2)}

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

${awarenessRationaleInstructions()}

Use these ${targetConfig.pluralLabel} definitions:
${targetDefinitions}

Prior scene context available to the reader:
${priorSceneContext}

Current scene reader knowledge marker:
${parsed.data.reader_knowledge ?? "unspecified"}

Current scene:

${parsed.content}

Required JSON:
${awarenessJsonShape(targetConfig)}
`;
}

async function evaluateReaderAwareness(targetName) {
  const targetConfig = getTargetConfig(targetName);

  if (!["characters", "plotThreads", "arcs"].includes(targetConfig.key)) {
    throw new Error(
      `Reader Awareness only supports targets "Character", "Plot Thread", and "Arc". Received "${targetName}".`
    );
  }

  const targetDefinitionEntries = getTargetDefinitions(targetConfig);
  const targetNames = targetDefinitionEntries.map((definition) => definition.name);
  const targetDefinitions = formatDefinitions(targetDefinitionEntries);

  let targetScores;

  if (targetNames.length === 0) {
    targetScores = normalizeReaderAwarenessMap(
      {},
      targetNames,
      awarenessSourceText({ scene: parsed.content })
    );
  } else {
    const priorSceneContext = formatPriorSceneContext(
      listPriorScenes(filePath, parsed)
    );
    const prompt = buildReaderAwarenessPrompt(
      targetConfig,
      targetNames,
      targetDefinitions,
      priorSceneContext
    );

    const { parsedResponse: scores } = await fetchJsonFromOllama(prompt);

    targetScores = normalizeReaderAwarenessMap(
      scores[targetConfig.key],
      targetNames,
      awarenessSourceText({
        scene: parsed.content,
        definitions: targetDefinitions,
        priorScenes: priorSceneContext
      })
    );
  }

  parsed.data.ai.readerAwareness = parsed.data.ai.readerAwareness ?? {};
  parsed.data.ai.readerAwareness[targetConfig.key] = targetScores;
  parsed.data.ai.readerAwareness.updated = new Date().toISOString();
}

if (isCharacterAwarenessMetric(metricName)) {
  await evaluateCharacterAwareness(targetName);
} else if (isReaderAwarenessMetric(metricName)) {
  await evaluateReaderAwareness(targetName);
} else {
  await evaluateStandardMetric(metricName, targetName);
}

const updated = matter.stringify(parsed.content, parsed.data);
writeFileAtomic(filePath, updated);
