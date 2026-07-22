import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { requestJsonFromOllama } from "../model/ollama-json-client.mjs";
import { createTruthLedgerContext } from "./truth-ledger-context.mjs";
import { createEvaluatorRegistry } from "./evaluator-registry.mjs";
import { createResponsePolicy } from "./response-policy.mjs";
import { createEvaluationStore } from "./evaluation-store.mjs";
import { createEvaluatorFamilies } from "./evaluator-families.mjs";
import {
  relationshipContractFor,
  relationshipContracts,
  trajectoryContractFor,
  trajectoryContracts
} from "./evaluation-contracts.mjs";

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
import { resolveSceneText } from "../scene-composition.mjs";
import {
  compareChronologyOrder,
  compareStoryOrder,
  formatPriorChronologyContext,
  formatPriorSceneContext,
  getChronologyOrder,
  getStoryOrder,
  isPriorChronologyScene,
  isPriorStoryScene
} from "./scene-order-context.mjs";
import {
  applyNameFilters,
  getEvaluationProfile,
  listEligibleDefinitionsFromPaths,
  listEligibleSceneFiles
} from "../evaluation-filters.mjs";

const __filename = fileURLToPath(import.meta.url);
const evaluatorRoot = path.dirname(__filename);
const toolRoot = path.join(evaluatorRoot, "..");
const config = loadConfig(toolRoot);
const truthLedgerContext = createTruthLedgerContext({
  config,
  toolRoot,
  normalizeTargetName: normalizeLinkTargetName
});
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
      pluralLabel: entityType.pluralLabel ?? key,
      readerAwareness: entityType.readerAwareness,
      definitionConfig: entityType
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
  const valueKind = ["score", "delta"].includes(metricSettings.valueKind)
    ? metricSettings.valueKind
    : null;
  const contextFields = Array.isArray(metricSettings.contextFields)
    ? metricSettings.contextFields.filter((field) => typeof field === "string" && field.trim())
    : [];
  const targetSelection =
    metricSettings.targetSelection && typeof metricSettings.targetSelection === "object"
      ? metricSettings.targetSelection
      : null;
  const priorContext = ["readerOrder", "chronology"].includes(metricSettings.priorContext)
    ? metricSettings.priorContext
    : null;

  return {
    rationaleMode,
    rationaleSources: new Set(rationaleSources),
    rationaleField,
    rationaleType,
    valueKind,
    contextFields,
    targetSelection,
    priorContext
  };
}

function standardMetricValueKind(settings, targetConfig) {
  return settings.valueKind ?? (targetConfig.sceneOnly ? "score" : "delta");
}

async function fetchJsonFromOllama(prompt) {
  return requestJsonFromOllama({
    url: config.ollamaUrl,
    model: config.model,
    prompt
  });
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
const scenesRoot = path.isAbsolute(storyFolders.scenes)
  ? storyFolders.scenes
  : path.resolve(pocRoot, storyFolders.scenes);
let sceneContent;

sceneLifecycleStatus = normalizeSceneLifecycleStatus(parsed.data.status);
calibrationMode = sceneLifecycleStatus;
calibrationModeConfig = config.calibration?.modes?.[calibrationMode] ??
  config.calibration?.modes?.[configuredProjectMode] ??
  {};
const responsePolicy = createResponsePolicy({
  awarenessRationaleMode,
  awarenessRationaleSources,
  calibrationMode,
  calibrationModeConfig,
  sceneLifecycleStatus,
  configEntryForName
});

if (sceneShouldBeSkipped(sceneLifecycleStatus)) {
  console.log(`Skipped scene lifecycle status ${sceneLifecycleStatus}: ${path.basename(filePath)}`);
  process.exit(0);
}

parsed.data.ai = parsed.data.ai ?? {};
parsed.data.ai.model = config.model;
const evaluationStore = createEvaluationStore({
  parsed,
  filePath,
  model: config.model,
  profileName: evaluationProfile.name,
  lifecycleStatus: sceneLifecycleStatus,
  calibrationMode,
  cacheEnabled: evaluationCacheEnabled,
  forceEvaluation,
  awarenessRationaleMode,
  normalizeName: normalizeConceptName,
  dimensionKey: toCamelCase,
  standardMetricValueKind
});

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

sceneContent = resolveSceneText(filePath, {
  scenesRoot,
  maxDepth: config.sceneComposition?.maxDepth
}).content;

function valuesFromSceneFields(fieldNames) {
  return fieldNames.flatMap((fieldName) => {
    const value = parsed.data[fieldName];

    if (Array.isArray(value)) {
      return value;
    }

    return value === null || value === undefined || value === "" ? [] : [value];
  });
}

function selectStandardMetricDefinitions(definitions, settings) {
  const selection = settings.targetSelection;

  if (!selection || selection.mode !== "sceneFields") {
    return definitions;
  }

  const canonicalNames = new Map(
    definitions.map((definition) => [definition.name.toLowerCase(), definition.name])
  );
  const selectedNames = new Set(
    valuesFromSceneFields(Array.isArray(selection.fields) ? selection.fields : [])
      .map((value) => canonicalNames.get(normalizeLinkTargetName(value).toLowerCase()))
      .filter(Boolean)
  );

  if (selection.includeLinked === true) {
    for (const linked of linkedTargetEntries(sceneContent, definitions.map((definition) => definition.name))) {
      selectedNames.add(linked.name);
    }
  }

  if (selectedNames.size === 0 && selection.fallback === "all") {
    return definitions;
  }

  return definitions.filter((definition) => selectedNames.has(definition.name));
}

function standardMetricSceneContext(settings) {
  const context = {};

  for (const fieldName of settings.contextFields) {
    if (parsed.data[fieldName] !== undefined) {
      context[fieldName] = parsed.data[fieldName];
    }
  }

  return Object.keys(context).length > 0
    ? `Configured scene context:\n${JSON.stringify(context, null, 2)}`
    : "";
}

function standardMetricPriorContext(settings) {
  if (settings.priorContext === "readerOrder") {
    return `Prior reader-order scene context:\n${formatPriorSceneContext(listPriorScenes(filePath, parsed))}`;
  }

  if (settings.priorContext === "chronology") {
    return `Prior story-chronology context:\n${formatPriorChronologyContext(listPriorChronologyScenes(filePath, parsed))}`;
  }

  return "";
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

function relativeVaultPath(absolutePath) {
  return path.relative(vaultRoot, absolutePath);
}

function formatTruthLedgerSupport(targetConfig, targetNames, visibleScenes, visibilityLabel) {
  return truthLedgerContext.formatSupport(
    targetConfig,
    targetNames,
    visibleScenes,
    visibilityLabel
  );
}

function listPriorScenes(currentFilePath, currentScene) {
  const currentOrder = getStoryOrder(currentScene);
  const currentName = path.basename(currentFilePath);
  const characterNames = getTargetNames(getTargetConfig("character"));
  const plotThreadNames = getTargetNames(getTargetConfig("plot thread"));
  const arcNames = getTargetNames(getTargetConfig("arc"));

  return listEligibleSceneFiles(scenesRoot, evaluationProfile.sceneFilters)
    .filter((scenePath) => path.resolve(scenePath) !== path.resolve(currentFilePath))
    .map(scenePath => {
      const scene = matter(fs.readFileSync(scenePath, "utf8"));
      const content = resolveSceneText(scenePath, {
        scenesRoot,
        maxDepth: config.sceneComposition?.maxDepth
      }).content;

      return {
        fileName: path.basename(scenePath),
        path: relativeVaultPath(scenePath),
        name: path.basename(scenePath, ".md"),
        storyOrder: getStoryOrder(scene),
        chronologyOrder: getChronologyOrder(scene),
        characters: linkedTargetEntries(content, characterNames).map((entry) => entry.name),
        plotThreads: linkedTargetEntries(content, plotThreadNames).map((entry) => entry.name),
        arcs: linkedTargetEntries(content, arcNames).map((entry) => entry.name),
        content: content.trim()
      };
    })
    .filter(scene => isPriorStoryScene(scene, currentOrder, currentName))
    .sort(compareStoryOrder);
}

function listPriorChronologyScenes(currentFilePath, currentScene) {
  const currentOrder = getChronologyOrder(currentScene);
  const currentName = path.basename(currentFilePath);
  const characterNames = getTargetNames(getTargetConfig("character"));
  const plotThreadNames = getTargetNames(getTargetConfig("plot thread"));
  const arcNames = getTargetNames(getTargetConfig("arc"));

  return listEligibleSceneFiles(scenesRoot, evaluationProfile.sceneFilters)
    .filter((scenePath) => path.resolve(scenePath) !== path.resolve(currentFilePath))
    .map(scenePath => {
      const scene = matter(fs.readFileSync(scenePath, "utf8"));
      const content = resolveSceneText(scenePath, {
        scenesRoot,
        maxDepth: config.sceneComposition?.maxDepth
      }).content;

      return {
        fileName: path.basename(scenePath),
        path: relativeVaultPath(scenePath),
        name: path.basename(scenePath, ".md"),
        storyOrder: getStoryOrder(scene),
        chronologyOrder: getChronologyOrder(scene),
        characters: linkedTargetEntries(content, characterNames).map((entry) => entry.name),
        plotThreads: linkedTargetEntries(content, plotThreadNames).map((entry) => entry.name),
        arcs: linkedTargetEntries(content, arcNames).map((entry) => entry.name),
        content: content.trim()
      };
    })
    .filter(scene => isPriorChronologyScene(scene, currentOrder, currentName))
    .sort(compareChronologyOrder);
}

const evaluatorFamilies = createEvaluatorFamilies({
  sceneContent,
  getTargetConfig,
  getTargetDefinitions,
  selectStandardMetricDefinitions,
  standardMetricSettings,
  standardMetricValueKind,
  standardMetricSceneContext,
  standardMetricPriorContext,
  metricDefinition: requestedMetric =>
    readDefinition(pocRoot, storyFolders.metrics, requestedMetric),
  formatDefinitions,
  linkedTargetEntries,
  formatLinkedTargetEntries,
  listPriorScenes: () => listPriorScenes(filePath, parsed),
  listPriorChronologyScenes: () => listPriorChronologyScenes(filePath, parsed),
  formatPriorSceneContext,
  formatPriorChronologyContext,
  formatTruthLedgerSupport,
  responsePolicy,
  evaluationStore,
  requestModelJson: fetchJsonFromOllama,
  dimensionKey: toCamelCase,
  logSkippedEvaluation,
  relationshipContractFor: (requestedMetric, targetConfig) =>
    relationshipContractFor(config, requestedMetric, targetConfig),
  trajectoryContractFor: (requestedMetric, targetConfig) =>
    trajectoryContractFor(config, requestedMetric, targetConfig)
});
const specializedEvaluators = {};
const contractedMetricNames = new Set([
  ...relationshipContracts(config).map(contract => contract.metric),
  ...trajectoryContracts(config).map(contract => contract.metric)
]);
for (const contractedMetricName of contractedMetricNames) {
  specializedEvaluators[toCamelCase(contractedMetricName)] = (requestedMetric, requestedTarget) => {
    const requestedTargetConfig = getTargetConfig(requestedTarget);
    if (relationshipContractFor(config, requestedMetric, requestedTargetConfig)) {
      return evaluatorFamilies.evaluateRelationship(requestedMetric, requestedTarget);
    }
    if (trajectoryContractFor(config, requestedMetric, requestedTargetConfig)) {
      return evaluatorFamilies.evaluateTrajectory(requestedMetric, requestedTarget);
    }
    return evaluatorFamilies.evaluateStandardMetric(requestedMetric, requestedTarget);
  };
}
const evaluatorRegistry = createEvaluatorRegistry({
  normalizeName: toCamelCase,
  specialized: specializedEvaluators,
  fallback: evaluatorFamilies.evaluateStandardMetric
});
const updatedEvaluation = await evaluatorRegistry.resolve(metricName)(
  metricName,
  targetName
);

if (updatedEvaluation) {
  const updated = matter.stringify(parsed.content, parsed.data);
  writeFileAtomic(filePath, updated);
}
