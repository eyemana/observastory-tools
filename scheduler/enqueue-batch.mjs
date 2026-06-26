import path from "path";
import { fileURLToPath } from "url";

import { enqueueEvaluateScenesJob } from "./queue.mjs";
import { getSchedulerConfig } from "../tool-config.mjs";

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
    previous !== "--scene";
});

const scenesFolder = positional[0];
const vaultRoot = readOption("--vault-root");
const source = readOption("--source") ?? "manual";
const preset = readOption("--preset") ?? "full";
const sceneFiles = readOptions("--scene");

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

if (!scenesFolder) {
  console.error("Usage: node scheduler/enqueue-batch.mjs <scenes-folder> [--vault-root <vault-root>] [--source <source>] [--preset <full|reader-awareness>]");
  process.exit(1);
}

const presetConfig = getPresetConfig(preset);

const result = enqueueEvaluateScenesJob({
  toolRoot,
  scenesFolder,
  sceneFiles,
  vaultRoot,
  source,
  label: presetConfig.label,
  evaluations: presetConfig.evaluations
});

console.log(JSON.stringify({
  jobId: result.id,
  preset,
  label: presetConfig.label,
  sceneCount: sceneFiles.length || undefined,
  jobPath: result.jobPath,
  logPath: result.logPath
}));
