import path from "path";
import { fileURLToPath } from "url";

import { enqueueEvaluateScenesJob } from "./queue.mjs";

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

const positional = process.argv.slice(2).filter((arg, index, args) => {
  const previous = args[index - 1];
  return !arg.startsWith("--") && previous !== "--vault-root" && previous !== "--source";
});

const scenesFolder = positional[0];
const vaultRoot = readOption("--vault-root");
const source = readOption("--source") ?? "manual";

if (!scenesFolder) {
  console.error("Usage: node scheduler/enqueue-batch.mjs <scenes-folder> [--vault-root <vault-root>] [--source <source>]");
  process.exit(1);
}

const result = enqueueEvaluateScenesJob({
  toolRoot,
  scenesFolder,
  vaultRoot,
  source
});

console.log(JSON.stringify({
  jobId: result.id,
  jobPath: result.jobPath,
  logPath: result.logPath
}));
