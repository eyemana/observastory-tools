import fs from "fs";
import path from "path";
import matter from "gray-matter";
import crypto from "crypto";

import { fileURLToPath } from "url";
import {
  findStoryRoot,
  readDefinition,
  formatDefinitions,
  toCamelCase
} from "../vault-utils.mjs";
import {
  getStoryConfig,
  loadConfig,
  storyEntityTypePaths
} from "../tool-config.mjs";
import { compareChronologySort } from "../chronology/chronology-utils.mjs";
import {
  applyNameFilters,
  getEvaluationProfile,
  listEligibleDefinitionsFromPaths
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
const evaluationCacheConfig = config.evaluationCache ?? {};
const evaluationCacheEnabled = evaluationCacheConfig.enabled !== false;
const configuredProjectMode = typeof config.projectMode === "string"
  ? config.projectMode
  : typeof config.project?.mode === "string"
    ? config.project.mode
    : "draft";
let sceneLifecycleStatus = config.sceneLifecycle?.defaultStatus ?? configuredProjectMode ?? "draft";
let calibrationMode = sceneLifecycleStatus;
let calibrationModeConfig = config.calibration?.modes?.[calibrationMode] ?? {};
const EVALUATION_INPUT_HASH_VERSION = 2;

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

function removeFlag(args, name) {
  return args.filter((arg) => arg !== name);
}

function normalizeConceptName(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function conceptLookupKey(value) {
  return normalizeConceptName(value).replace(/[\s_-]/g, "");
}

function configEntryForName(entries, name) {
  const candidates = [
    name,
    toCamelCase(name),
    normalizeConceptName(name)
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (entries?.[candidate]) {
      return entries[candidate];
    }
  }

  const normalized = conceptLookupKey(name);
  return Object.entries(entries ?? {})
    .find(([key]) => conceptLookupKey(key) === normalized)?.[1];
}

const args = process.argv.slice(2);
const filePath = args[0];
const metricName = normalizeConceptName(args[1]);
const evaluationProfileName = readOption(args, "--profile");
const forceEvaluation = args.includes("--force");
const targetArgs = removeFlag(removeOption(args.slice(2), "--profile"), "--force");
const targetName = normalizeConceptName(targetArgs.join(" "));
const evaluationProfile = getEvaluationProfile(config, evaluationProfileName);

if (!filePath || !metricName || !targetName) {
  console.error("Usage: node evaluate-scene.mjs <file> <metricName> <targetName> [--profile <name>] [--force]");
  process.exit(1);
}

function normalizeSceneLifecycleStatus(value) {
  const status = String(value ?? config.sceneLifecycle?.defaultStatus ?? "draft")
    .trim()
    .toLowerCase();
  const aliases = {
    active: "live",
    current: "live",
    ignore: "scratch",
    inactive: "archived"
  };
  const normalized = aliases[status] ?? status;
  const allowed = new Set(["scratch", "draft", "live", "archived"]);

  return allowed.has(normalized) ? normalized : "draft";
}

function sceneShouldBeSkipped(status) {
  const configured = config.sceneLifecycle?.excludedStatuses;
  const excluded = Array.isArray(configured) && configured.length > 0
    ? new Set(configured.map((item) => String(item).trim().toLowerCase()))
    : new Set(["scratch", "archived"]);

  return excluded.has(status);
}

function buildTargetConfigs() {
  const targets = {};

  for (const [key, entityType] of Object.entries(storyConfig.entityTypes ?? {})) {
    const target = normalizeConceptName(entityType.target ?? entityType.label ?? key);

    if (!target) {
      continue;
    }

    targets[target] = {
      key,
      target,
      entityType: key,
      paths: storyEntityTypePaths(config, key),
      label: entityType.label ?? target,
      pluralLabel: entityType.pluralLabel ?? key
    };
  }

  targets.scene = {
    key: "scene",
    target: "scene",
    entityType: "scene",
    paths: [],
    label: "scene",
    pluralLabel: "scene",
    sceneOnly: true
  };

  return targets;
}

const targetConfigs = buildTargetConfigs();

function getTargetConfig(targetName) {
  const normalized = conceptLookupKey(targetName);
  const match = Object.values(targetConfigs)
    .find(targetConfig => [
      targetConfig.target,
      targetConfig.label,
      targetConfig.pluralLabel,
      targetConfig.key
    ].some(value => conceptLookupKey(value) === normalized));

  if (match) {
    return match;
  }

  throw new Error(
    `Invalid target "${targetName}". Expected one of: ${Object.values(targetConfigs).map(targetConfig => targetConfig.target).join(", ")}`
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
  const metricSettings = configEntryForName(
    standardMetricsConfig.metrics,
    metricName
  ) ?? {};
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
Return ${settings.rationaleType} as one tight sentence supporting the associated numeric value.
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
  const numericValue = typeof rawObject.delta === "number"
    ? rawObject.delta
    : typeof rawObject.score === "number"
      ? rawObject.score
      : 0;
  const normalized = {
    scene: numericValue
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
      (
        typeof rawValue.delta === "number" ||
        typeof rawValue.score === "number"
      )
    ) {
      const normalizedEntry = normalizeStandardMetricEntry(
        rawValue,
        settings,
        sourceText
      );
      normalized.items[name] = normalizedEntry;
      returnedItemScores.push(normalizedEntry.scene);
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

  if (
    typeof bucket.score !== "number" &&
    typeof bucket.delta !== "number"
  ) {
    throw new Error(`Invalid ${label} scene score: ${rawResponse}`);
  }

  return normalizeStandardMetricEntry(bucket, settings, sourceText);
}

function configuredScoreCeiling(metricName) {
  const entry = configEntryForName(calibrationModeConfig?.scoreCeilings, metricName);
  const value = Number(entry);

  return Number.isFinite(value)
    ? clampNumber(value, 0, 10, 10)
    : null;
}

function configuredFieldCeilings(metricName) {
  const entry = configEntryForName(calibrationModeConfig?.fieldCeilings, metricName);

  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return {};
  }

  const ceilings = {};

  for (const [field, value] of Object.entries(entry)) {
    const number = Number(value);

    if (Number.isFinite(number)) {
      ceilings[field] = clampNumber(number, 0, 10, 10);
    }
  }

  return ceilings;
}

function calibrationPromptGuidance(metricName) {
  const ceiling = configuredScoreCeiling(metricName);
  const fieldCeilings = configuredFieldCeilings(metricName);
  const guidance =
    typeof calibrationModeConfig.guidance === "string"
      ? calibrationModeConfig.guidance.trim()
      : "";

  if (!guidance && ceiling === null && Object.keys(fieldCeilings).length === 0) {
    return "";
  }

  const lines = [
    `Scene lifecycle status: ${sceneLifecycleStatus}.`,
    `Calibration mode: ${calibrationMode}.`
  ];

  if (guidance) {
    lines.push(guidance);
  }

  if (ceiling !== null) {
    lines.push(
      `Calibration cap: do not score ${metricName} above ${ceiling} on the 0-10 scale in this mode unless the configured cap is changed.`
    );
  }

  if (Object.keys(fieldCeilings).length > 0) {
    const fields = Object.entries(fieldCeilings)
      .map(([field, value]) => `${field} <= ${value}`)
      .join(", ");
    lines.push(
      `Calibration field caps for ${metricName}: ${fields}. Use these caps unless the configured cap is changed.`
    );
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
    calibration: {
      mode: calibrationMode,
      lifecycleStatus: sceneLifecycleStatus,
      cappedAt: ceiling
    }
  };
}

function applyCalibrationToStandardScores(scores, metricName) {
  const calibrated = applyCalibrationToMetricEntry(scores, metricName);
  const items = {};

  for (const [name, value] of Object.entries(scores.items ?? {})) {
    items[name] = applyCalibrationToMetricEntry(value, metricName);
  }

  return {
    ...calibrated,
    items
  };
}

function applyCalibrationToAwarenessEntry(entry, metricName) {
  const fieldCeilings = configuredFieldCeilings(metricName);
  const raw = {};
  let calibrated = entry;

  for (const [field, ceiling] of Object.entries(fieldCeilings)) {
    if (typeof calibrated?.[field] !== "number" || calibrated[field] <= ceiling) {
      continue;
    }

    raw[field] = calibrated[field];
    calibrated = {
      ...calibrated,
      [field]: ceiling
    };
  }

  if (Object.keys(raw).length === 0) {
    return entry;
  }

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
  const calibrated = {};

  for (const [targetName, entry] of Object.entries(scores ?? {})) {
    calibrated[targetName] = applyCalibrationToAwarenessEntry(entry, metricName);
  }

  return calibrated;
}

function applyCalibrationToCharacterAwarenessMap(scores, metricName) {
  const calibrated = {};

  for (const [plotThreadName, characterScores] of Object.entries(scores ?? {})) {
    calibrated[plotThreadName] = {};

    for (const [characterName, entry] of Object.entries(characterScores ?? {})) {
      calibrated[plotThreadName][characterName] =
        applyCalibrationToAwarenessEntry(entry, metricName);
    }
  }

  return calibrated;
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
const vaultRoot = path.resolve(toolRoot, "..");

sceneLifecycleStatus = normalizeSceneLifecycleStatus(parsed.data.status);
calibrationMode = sceneLifecycleStatus;
calibrationModeConfig = config.calibration?.modes?.[calibrationMode] ??
  config.calibration?.modes?.[configuredProjectMode] ??
  {};

if (sceneShouldBeSkipped(sceneLifecycleStatus)) {
  console.log(`Skipped scene lifecycle status ${sceneLifecycleStatus}: ${path.basename(filePath)}`);
  process.exit(0);
}

parsed.data.ai = parsed.data.ai ?? {};
parsed.data.ai.model = config.model;

function evaluationInputHash(metricName, targetName, prompt) {
  const payload = {
    version: EVALUATION_INPUT_HASH_VERSION,
    model: config.model,
    metricName,
    targetName,
    profile: evaluationProfile.name,
    lifecycleStatus: sceneLifecycleStatus,
    calibrationMode,
    prompt
  };

  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

function hasExistingEvaluation(metricKey, targetKey) {
  const observations = parsed.data.ai?.observations;

  if (!observations || typeof observations !== "object") {
    return false;
  }

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
  if (!evaluationCacheEnabled || forceEvaluation) {
    return false;
  }

  if (!hasExistingEvaluation(metricKey, targetKey)) {
    return false;
  }

  const metadata = parsed.data.ai?.evaluationInputs?.[metricKey]?.[targetKey];

  return metadata?.version === EVALUATION_INPUT_HASH_VERSION &&
    metadata?.inputHash === inputHash;
}

function markEvaluationInput(metricKey, targetKey, inputHash, storedMetricName = metricName, storedTargetName = targetName) {
  parsed.data.ai.evaluationInputs = parsed.data.ai.evaluationInputs ?? {};
  parsed.data.ai.evaluationInputs[metricKey] =
    parsed.data.ai.evaluationInputs[metricKey] ?? {};
  parsed.data.ai.evaluationInputs[metricKey][targetKey] = {
    version: EVALUATION_INPUT_HASH_VERSION,
    inputHash,
    model: config.model,
    profile: evaluationProfile.name,
    lifecycleStatus: sceneLifecycleStatus,
    calibrationMode,
    metric: normalizeConceptName(storedMetricName),
    target: normalizeConceptName(storedTargetName),
    updated: new Date().toISOString()
  };
}

function standardMetricObservationPayload(metricName, entry, settings, targetConfig, entityName) {
  const valueKind = targetConfig.sceneOnly ? "score" : "delta";
  const payload = {
    entity: {
      name: entityName,
      type: targetConfig.entityType,
      target: targetConfig.label
    },
    dimension: toCamelCase(metricName),
    metric: metricName,
    valueKind,
    value: entry.scene,
    values: {
      [valueKind]: entry.scene
    },
    scale: {
      min: 0,
      max: 10
    },
    fieldScales: {
      delta: { min: 0, max: 10 },
      salience: { min: 0, max: 10 },
      confidence: { min: 0, max: 10 },
      alignment: { min: -10, max: 10 },
      evidenceStrength: { min: 0, max: 10 }
    },
    lifecycleStatus: sceneLifecycleStatus,
    calibrationMode,
    profile: evaluationProfile.name,
    model: config.model,
    updated: new Date().toISOString()
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
  const dimension = toCamelCase(metricName);
  parsed.data.ai.observations = parsed.data.ai.observations ?? {};
  parsed.data.ai.observations[targetConfig.key] =
    parsed.data.ai.observations[targetConfig.key] ?? {};

  if (targetConfig.sceneOnly) {
    const sceneName = path.basename(filePath, ".md");
    parsed.data.ai.observations[targetConfig.key][sceneName] =
      parsed.data.ai.observations[targetConfig.key][sceneName] ?? {};
    parsed.data.ai.observations[targetConfig.key][sceneName][dimension] =
      standardMetricObservationPayload(metricName, scores, settings, targetConfig, sceneName);
    return;
  }

  for (const [entityName, entry] of Object.entries(scores.items ?? {})) {
    parsed.data.ai.observations[targetConfig.key][entityName] =
      parsed.data.ai.observations[targetConfig.key][entityName] ?? {};
    parsed.data.ai.observations[targetConfig.key][entityName][dimension] =
      standardMetricObservationPayload(metricName, entry, settings, targetConfig, entityName);
  }
}

function awarenessObservationPayload(metricName, entry, targetConfig, entityName, observer = null) {
  const payload = {
    entity: {
      name: entityName,
      type: targetConfig.entityType,
      target: targetConfig.label
    },
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
    scale: {
      min: 0,
      max: 10
    },
    lifecycleStatus: sceneLifecycleStatus,
    calibrationMode,
    profile: evaluationProfile.name,
    model: config.model,
    updated: new Date().toISOString()
  };

  if (observer) {
    payload.observer = observer;
  }

  if (entry.calibration) {
    payload.calibration = entry.calibration;
  }

  if (awarenessRationaleMode === "paraphrase") {
    payload.rationale = entry.rationale ?? "";
  } else if (awarenessRationaleMode === "extractive") {
    payload.evidence = entry.evidence ?? [];
  }

  return payload;
}

function writeReaderAwarenessObservations(targetConfig, scores) {
  parsed.data.ai.observations = parsed.data.ai.observations ?? {};
  parsed.data.ai.observations[targetConfig.key] =
    parsed.data.ai.observations[targetConfig.key] ?? {};

  for (const [entityName, entry] of Object.entries(scores ?? {})) {
    parsed.data.ai.observations[targetConfig.key][entityName] =
      parsed.data.ai.observations[targetConfig.key][entityName] ?? {};
    parsed.data.ai.observations[targetConfig.key][entityName].awareness =
      parsed.data.ai.observations[targetConfig.key][entityName].awareness ?? {};
    parsed.data.ai.observations[targetConfig.key][entityName].awareness.reader =
      awarenessObservationPayload(
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
  parsed.data.ai.observations[plotThreadConfig.key] =
    parsed.data.ai.observations[plotThreadConfig.key] ?? {};

  for (const [plotThreadName, characterScores] of Object.entries(scores ?? {})) {
    parsed.data.ai.observations[plotThreadConfig.key][plotThreadName] =
      parsed.data.ai.observations[plotThreadConfig.key][plotThreadName] ?? {};
    parsed.data.ai.observations[plotThreadConfig.key][plotThreadName].awareness =
      parsed.data.ai.observations[plotThreadConfig.key][plotThreadName].awareness ?? {};
    parsed.data.ai.observations[plotThreadConfig.key][plotThreadName].awareness.characters =
      parsed.data.ai.observations[plotThreadConfig.key][plotThreadName].awareness.characters ?? {};

    for (const [characterName, entry] of Object.entries(characterScores ?? {})) {
      parsed.data.ai.observations[plotThreadConfig.key][plotThreadName].awareness.characters[characterName] =
        awarenessObservationPayload(
          "character awareness",
          entry,
          plotThreadConfig,
          plotThreadName,
          { type: "characters", name: characterName }
        );
    }
  }
}

function logSkippedEvaluation(metricName, targetName) {
  console.log(`Skipped unchanged evaluation: ${metricName} / ${targetName} / ${path.basename(filePath)}`);
}

function explicitTargetField(prefix, targetConfig) {
  return `${prefix}${targetConfig.key[0].toUpperCase()}${targetConfig.key.slice(1)}`;
}

function getTargetDefinitions(targetConfig) {
  if (targetConfig.sceneOnly) {
    return [];
  }

  const definitions = listEligibleDefinitionsFromPaths(
    pocRoot,
    targetConfig.paths,
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

function normalizeLinkTargetName(value) {
  return String(value ?? "")
    .split("|")[0]
    .split("#")[0]
    .trim()
    .replace(/\.md$/i, "")
    .split(/[\\/]/)
    .pop();
}

function linkedTargetEntries(content, targetNames) {
  const canonicalNames = new Map(
    targetNames.map((name) => [name.toLowerCase(), name])
  );
  const counts = new Map();
  const linkPattern = /\[\[([^\]]+)\]\]/g;
  let match;

  while ((match = linkPattern.exec(content ?? "")) !== null) {
    const linkedName = normalizeLinkTargetName(match[1]);
    const canonicalName = canonicalNames.get(linkedName.toLowerCase());

    if (!canonicalName) {
      continue;
    }

    counts.set(canonicalName, (counts.get(canonicalName) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function formatLinkedTargetEntries(entries) {
  if (entries.length === 0) {
    return "None.";
  }

  return JSON.stringify(entries, null, 2);
}

function normalizePathKey(value) {
  return String(value ?? "").replace(/\\/g, "/").toLowerCase();
}

function relativeVaultPath(absolutePath) {
  return path.relative(vaultRoot, absolutePath);
}

let truthLedgerCache;

function readTruthLedgerIndex() {
  if (truthLedgerCache !== undefined) {
    return truthLedgerCache;
  }

  const outputPath = config.truthLedger?.outputPath ?? ".index/truth-ledger.json";
  const ledgerPath = path.isAbsolute(outputPath)
    ? outputPath
    : path.join(toolRoot, outputPath);

  if (!fs.existsSync(ledgerPath)) {
    truthLedgerCache = null;
    return truthLedgerCache;
  }

  try {
    truthLedgerCache = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
  } catch {
    truthLedgerCache = null;
  }

  return truthLedgerCache;
}

function claimEntities(claim) {
  const entities = Array.isArray(claim?.entities) ? claim.entities : [];

  return entities
    .map(entity => ({
      type: String(entity?.type ?? "").trim(),
      name: String(entity?.name ?? "").trim()
    }))
    .filter(entity => entity.type && entity.name);
}

function claimLegacyNames(claim, entityTypeKey) {
  const values = Array.isArray(claim?.[entityTypeKey]) ? claim[entityTypeKey] : [];

  return values
    .map(value => normalizeLinkTargetName(value))
    .filter(Boolean);
}

function claimMatchesTarget(claim, entityTypeKey, targetName) {
  const normalizedTarget = targetName.toLowerCase();

  if (
    claimEntities(claim)
      .some(entity =>
        entity.type === entityTypeKey &&
        entity.name.toLowerCase() === normalizedTarget
      )
  ) {
    return true;
  }

  return claimLegacyNames(claim, entityTypeKey)
    .some(name => name.toLowerCase() === normalizedTarget);
}

function supportRecordsForClaim(claim) {
  const support = Array.isArray(claim?.support) ? claim.support : [];

  if (support.length > 0) {
    return support;
  }

  if (!claim?.source?.path) {
    return [];
  }

  return [{
    type: claim.authority ?? "claim",
    path: claim.source.path,
    absolutePath: claim.source.absolutePath,
    line: claim.source.line,
    excerpt: claim.statement
  }];
}

function truncateForPrompt(value, maxLength = 260) {
  const text = normalizeWhitespace(value);

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}

function formatSupportList(records) {
  if (!records.length) {
    return "None.";
  }

  return records
    .slice(0, 3)
    .map(record => {
      const location = `${record.path ?? "(unknown)"}:${record.line ?? "?"}`;
      const excerpt = truncateForPrompt(record.excerpt ?? "");
      return excerpt ? `- ${location}: ${excerpt}` : `- ${location}`;
    })
    .join("\n");
}

function relationshipMatchesTarget(relationship, targetName) {
  const normalizedTarget = targetName.toLowerCase();

  return [relationship?.source, relationship?.target, relationship?.statement]
    .some(value => String(value ?? "").toLowerCase().includes(normalizedTarget));
}

function formatRelationshipList(relationships, targetName) {
  const matching = (Array.isArray(relationships) ? relationships : [])
    .filter(relationship => relationshipMatchesTarget(relationship, targetName))
    .slice(0, 3);

  if (!matching.length) {
    return "None.";
  }

  return matching
    .map(relationship => {
      const dimension = relationship.dimension ? ` (${relationship.dimension})` : "";
      const source = relationship.source || "?";
      const target = relationship.target || "?";
      const statement = relationship.statement ? `: ${truncateForPrompt(relationship.statement, 180)}` : "";
      return `- ${source} -> ${target}${dimension}${statement}`;
    })
    .join("\n");
}

function formatTruthLedgerSupport(targetConfig, targetNames, visibleScenes, visibilityLabel) {
  const ledger = readTruthLedgerIndex();

  if (!ledger) {
    return "Truth Ledger index is not available. Run Queue-Truth-Ledger to generate support-map context.";
  }

  const claims = [
    ...(Array.isArray(ledger.claims) ? ledger.claims : []),
    ...(Array.isArray(ledger.inferredClaims) ? ledger.inferredClaims : [])
  ];
  const visiblePaths = new Set(
    visibleScenes.map(scene => normalizePathKey(scene.path))
  );
  const blocks = [];

  for (const targetName of targetNames) {
    const matchingClaims = claims
      .filter(claim => claimMatchesTarget(claim, targetConfig.key, targetName))
      .slice(0, 5);

    if (!matchingClaims.length) {
      continue;
    }

    const authorSupport = [];
    const visibleSupport = [];
    const relationships = [];

    for (const claim of matchingClaims) {
      authorSupport.push(...supportRecordsForClaim(claim));
      visibleSupport.push(
        ...supportRecordsForClaim(claim)
          .filter(record => visiblePaths.has(normalizePathKey(record.path)))
      );
      relationships.push(...(Array.isArray(claim.relationships) ? claim.relationships : []));
    }

    blocks.push([
      `${targetConfig.label}: ${targetName}`,
      `${visibilityLabel}:`,
      formatSupportList(visibleSupport),
      "Author support, not necessarily visible to reader or character yet:",
      formatSupportList(authorSupport),
      "Relationships:",
      formatRelationshipList(relationships, targetName)
    ].join("\n"));
  }

  if (!blocks.length) {
    return "No Truth Ledger support found for the listed targets.";
  }

  return blocks.join("\n\n---\n\n");
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

  return null;
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
  const characterNames = getTargetNames(getTargetConfig("character"));
  const plotThreadNames = getTargetNames(getTargetConfig("plot thread"));
  const arcNames = getTargetNames(getTargetConfig("arc"));

  return fs.readdirSync(scenesFolder, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .filter(entry => entry.name.endsWith(".md"))
    .filter(entry => entry.name !== currentName)
    .map(entry => {
      const scenePath = path.join(scenesFolder, entry.name);
      const scene = matter(fs.readFileSync(scenePath, "utf8"));

      return {
        fileName: entry.name,
        path: relativeVaultPath(scenePath),
        name: path.basename(entry.name, ".md"),
        storyOrder: getStoryOrder(scene),
        chronologyOrder: getChronologyOrder(scene),
        characters: linkedTargetEntries(scene.content, characterNames).map((entry) => entry.name),
        plotThreads: linkedTargetEntries(scene.content, plotThreadNames).map((entry) => entry.name),
        arcs: linkedTargetEntries(scene.content, arcNames).map((entry) => entry.name),
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
  const characterNames = getTargetNames(getTargetConfig("character"));
  const plotThreadNames = getTargetNames(getTargetConfig("plot thread"));
  const arcNames = getTargetNames(getTargetConfig("arc"));

  return fs.readdirSync(scenesFolder, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .filter(entry => entry.name.endsWith(".md"))
    .filter(entry => entry.name !== currentName)
    .map(entry => {
      const scenePath = path.join(scenesFolder, entry.name);
      const scene = matter(fs.readFileSync(scenePath, "utf8"));

      return {
        fileName: entry.name,
        path: relativeVaultPath(scenePath),
        name: path.basename(entry.name, ".md"),
        storyOrder: getStoryOrder(scene),
        chronologyOrder: getChronologyOrder(scene),
        characters: linkedTargetEntries(scene.content, characterNames).map((entry) => entry.name),
        plotThreads: linkedTargetEntries(scene.content, plotThreadNames).map((entry) => entry.name),
        arcs: linkedTargetEntries(scene.content, arcNames).map((entry) => entry.name),
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
  const calibrationGuidance = calibrationPromptGuidance(metricName);
  const linkedTargets = targetConfig.sceneOnly
    ? []
    : linkedTargetEntries(parsed.content, targetNames);

  if (targetConfig.sceneOnly) {
    return `
Return JSON only.
Return compact valid JSON.
Do not include trailing commas.
Every opened object must be closed.
Do not include markdown.

Score only this scene.
Do not use other scenes, truth ledgers, chronology, or external story context.
This is a scene craft score, not a story trajectory delta.

${calibrationGuidance}

${standardMetricRationaleInstructions(settings)}

Use this definition of ${metricName}:
${metricDefinition}

Scene:

${parsed.content}

Required JSON:
{
  "${targetConfig.key}": {
    "score": number${standardMetricRationaleJsonShape(settings, "    ")}
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
${formatLinkedTargetEntries(linkedTargets)}

You must return one delta object for every listed ${targetConfig.label}.
Use EXACTLY the listed names as JSON keys.
Do not omit any listed item.
Do not add unlisted items.
If an item barely changes in this scene, still include it with delta 0 or a low delta and configured rationale output.

Score delta from 0-10.
This is a scene delta/change observation, not an absolute state score.
Measure how much this scene changes, advances, pressures, reveals, complicates, reinforces, or resolves the selected dimension for each listed ${targetConfig.label}.
Do not score general importance, screen time, or static relevance.

${calibrationGuidance}

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
    "delta": number${standardMetricRationaleJsonShape(settings, "    ")},
    "${targetConfig.label}Name": {
      "delta": number${standardMetricRationaleJsonShape(settings, "      ")}
    }
  }
}
`;
}

async function evaluateStandardMetric(metricName, targetName) {
  const metricKey = toCamelCase(metricName);
  const targetConfig = getTargetConfig(targetName);
  const canonicalTargetName = targetConfig.target;
  const settings = standardMetricSettings(metricName);

  const targetDefinitionEntries = getTargetDefinitions(targetConfig);
  const targetNames = targetDefinitionEntries.map((definition) => definition.name);
  const targetDefinitions = targetConfig.sceneOnly
    ? ""
    : formatDefinitions(targetDefinitionEntries);
  const prompt = buildStandardMetricPrompt(
    metricName,
    targetConfig,
    targetNames,
    targetDefinitions,
    settings
  );
  const inputHash = evaluationInputHash(metricName, canonicalTargetName, prompt);

  if (shouldSkipEvaluation(metricKey, targetConfig.key, inputHash)) {
    logSkippedEvaluation(metricName, canonicalTargetName);
    return false;
  }

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

  normalizedScores = applyCalibrationToStandardScores(normalizedScores, metricName);

  writeStandardMetricObservations(metricName, targetConfig, normalizedScores, settings);
  markEvaluationInput(metricKey, targetConfig.key, inputHash, metricName, canonicalTargetName);
  return true;
}

function buildCharacterAwarenessPrompt(
  characterNames,
  plotThreadNames,
  characterDefinitions,
  plotThreadDefinitions,
  priorChronologyContext,
  truthLedgerSupport
) {
  const linkedCharacters = linkedTargetEntries(parsed.content, characterNames);
  const linkedPlotThreads = linkedTargetEntries(parsed.content, plotThreadNames);

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
${formatLinkedTargetEntries(linkedCharacters)}

Plot threads explicitly linked in this scene:
${formatLinkedTargetEntries(linkedPlotThreads)}

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

${calibrationPromptGuidance("character awareness")}

${awarenessRationaleInstructions()}

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
  const characterNames = characterDefinitionEntries.map((definition) => definition.name);
  const plotThreadNames = plotThreadDefinitionEntries.map((definition) => definition.name);
  const characterDefinitions = formatDefinitions(characterDefinitionEntries);
  const plotThreadDefinitions = formatDefinitions(plotThreadDefinitionEntries);
  const priorChronologyScenes = listPriorChronologyScenes(filePath, parsed);
  const priorChronologyContext = formatPriorChronologyContext(priorChronologyScenes);
  const truthLedgerSupport = formatTruthLedgerSupport(
    plotThreadConfig,
    plotThreadNames,
    priorChronologyScenes,
    "Prior chronology support before this scene"
  );
  const prompt = buildCharacterAwarenessPrompt(
    characterNames,
    plotThreadNames,
    characterDefinitions,
    plotThreadDefinitions,
    priorChronologyContext,
    truthLedgerSupport
  );
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
      awarenessSourceText({ scene: parsed.content })
    );
  } else {
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
        priorScenes: `${priorChronologyContext}\n\n${truthLedgerSupport}`
      })
    );
  }

  plotThreads = applyCalibrationToCharacterAwarenessMap(
    plotThreads,
    "character awareness"
  );

  writeCharacterAwarenessObservations(plotThreadConfig, plotThreads);
  markEvaluationInput("characterAwareness", "plotThreads", inputHash, "character awareness", canonicalTargetName);
  return true;
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

function buildReaderAwarenessPrompt(targetConfig, targetNames, targetDefinitions, priorSceneContext, truthLedgerSupport) {
  const guidance = getReaderAwarenessGuidance(targetConfig);
  const linkedTargets = linkedTargetEntries(parsed.content, targetNames);

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
${formatLinkedTargetEntries(linkedTargets)}

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

${calibrationPromptGuidance("reader awareness")}

${awarenessRationaleInstructions()}

Use these ${targetConfig.pluralLabel} definitions:
${targetDefinitions}

Prior scene context available to the reader:
${priorSceneContext}

Truth Ledger support map:
${truthLedgerSupport}

Use reader-visible support as evidence the reader could already have before this scene.
Use author support as grounding for the story's intended truth, but do not treat author support as reader knowledge unless it appears in prior scene context or the current scene.

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
      `reader awareness only supports targets "character", "plot thread", and "arc". Received "${targetName}".`
    );
  }

  const targetDefinitionEntries = getTargetDefinitions(targetConfig);
  const targetNames = targetDefinitionEntries.map((definition) => definition.name);
  const targetDefinitions = formatDefinitions(targetDefinitionEntries);
  const priorScenes = listPriorScenes(filePath, parsed);
  const priorSceneContext = formatPriorSceneContext(priorScenes);
  const truthLedgerSupport = formatTruthLedgerSupport(
    targetConfig,
    targetNames,
    priorScenes,
    "Reader-visible support before this scene"
  );
  const prompt = buildReaderAwarenessPrompt(
    targetConfig,
    targetNames,
    targetDefinitions,
    priorSceneContext,
    truthLedgerSupport
  );
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
      awarenessSourceText({ scene: parsed.content })
    );
  } else {
    const { parsedResponse: scores } = await fetchJsonFromOllama(prompt);

    targetScores = normalizeReaderAwarenessMap(
      scores[targetConfig.key],
      targetNames,
      awarenessSourceText({
        scene: parsed.content,
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
  markEvaluationInput("readerAwareness", targetConfig.key, inputHash, "reader awareness", targetConfig.target);
  return true;
}

let updatedEvaluation;

if (isCharacterAwarenessMetric(metricName)) {
  updatedEvaluation = await evaluateCharacterAwareness(targetName);
} else if (isReaderAwarenessMetric(metricName)) {
  updatedEvaluation = await evaluateReaderAwareness(targetName);
} else {
  updatedEvaluation = await evaluateStandardMetric(metricName, targetName);
}

if (updatedEvaluation) {
  const updated = matter.stringify(parsed.content, parsed.data);
  writeFileAtomic(filePath, updated);
}
