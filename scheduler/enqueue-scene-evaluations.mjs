import path from "path";
import { fileURLToPath } from "url";

import { enqueueEvaluateScenesJob } from "./queue.mjs";
import { defaultScenesPath, getSchedulerConfig, loadConfig } from "../tool-config.mjs";
import { getEvaluationProfile, normalizeFilterConfig } from "../evaluation-filters.mjs";

const __filename = fileURLToPath(import.meta.url);
const schedulerRoot = path.dirname(__filename);
const toolRoot = path.join(schedulerRoot, "..");

function readOption(name) {
  const index = process.argv.indexOf(name);

  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
}

function readOptions(name) {
  const values = [];

  for (let index = 0; index < process.argv.length; index++) {
    if (process.argv[index] === name && process.argv[index + 1]) {
      values.push(process.argv[index + 1]);
    }
  }

  return values;
}

const positional = process.argv.slice(2).filter((arg, index, args) => {
  const previous = args[index - 1];
  return !arg.startsWith("--") &&
    previous !== "--vault-root" &&
    previous !== "--source" &&
    previous !== "--preset" &&
    previous !== "--profile" &&
    previous !== "--scene-status" &&
    previous !== "--exclude-scene-status" &&
    previous !== "--scene-tag" &&
    previous !== "--exclude-scene-tag" &&
    previous !== "--scene";
});

const explicitScenesFolder = positional[0];
const vaultRoot = readOption("--vault-root");
const source = readOption("--source") ?? "manual";
const preset = readOption("--preset") ?? "full";
const evaluationProfile = readOption("--profile");
const sceneFiles = readOptions("--scene");
const sceneFilters = {
  includeStatuses: readOptions("--scene-status"),
  excludeStatuses: readOptions("--exclude-scene-status"),
  includeTags: readOptions("--scene-tag"),
  excludeTags: readOptions("--exclude-scene-tag")
};

function mergeFilterConfig(base = {}, override = {}) {
  return {
    includeStatuses: [
      ...(Array.isArray(base.includeStatuses) ? base.includeStatuses : []),
      ...(Array.isArray(override.includeStatuses) ? override.includeStatuses : [])
    ],
    excludeStatuses: [
      ...(Array.isArray(base.excludeStatuses) ? base.excludeStatuses : []),
      ...(Array.isArray(override.excludeStatuses) ? override.excludeStatuses : [])
    ],
    includeTags: [
      ...(Array.isArray(base.includeTags) ? base.includeTags : []),
      ...(Array.isArray(override.includeTags) ? override.includeTags : [])
    ],
    excludeTags: [
      ...(Array.isArray(base.excludeTags) ? base.excludeTags : []),
      ...(Array.isArray(override.excludeTags) ? override.excludeTags : [])
    ]
  };
}

function getPresetConfig(name) {
  const scheduler = getSchedulerConfig(toolRoot);

  if (name === "full") {
    return {
      label: "Full Scene Evaluation",
      evaluations: scheduler.evaluations
    };
  }

  if (name === "reader-awareness") {
    return {
      label: "Reader Awareness",
      evaluations: scheduler.readerAwarenessEvaluations
    };
  }

  throw new Error(`Unknown evaluation preset "${name}". Expected "full" or "reader-awareness".`);
}

let presetConfig;
let profile;
let config;

try {
  config = loadConfig(toolRoot);
  presetConfig = getPresetConfig(preset);
  profile = getEvaluationProfile(config, evaluationProfile);
  normalizeFilterConfig(profile.elementFilters);
  normalizeFilterConfig(mergeFilterConfig(profile.sceneFilters, sceneFilters));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const resolvedVaultRoot = vaultRoot ? path.resolve(vaultRoot) : path.resolve(toolRoot, "..");
const scenesFolder = explicitScenesFolder
  ? path.resolve(explicitScenesFolder)
  : path.resolve(resolvedVaultRoot, defaultScenesPath(config));

const result = enqueueEvaluateScenesJob({
  toolRoot,
  scenesFolder,
  sceneFiles,
  vaultRoot,
  source,
  evaluationProfile: profile.name,
  sceneFilters,
  label: presetConfig.label,
  evaluations: presetConfig.evaluations
});

console.log(JSON.stringify({
  jobId: result.id,
  preset,
  evaluationProfile: profile.name,
  label: presetConfig.label,
  sceneCount: sceneFiles.length || undefined,
  jobPath: result.jobPath,
  logPath: result.logPath
}));
