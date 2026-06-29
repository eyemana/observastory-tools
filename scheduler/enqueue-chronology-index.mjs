import path from "path";
import { fileURLToPath } from "url";

import { enqueueChronologyIndexJob } from "./queue.mjs";

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
      index++;
    }
  }

  return values;
}

const vaultRoot = readOption("--vault-root");
const source = readOption("--source") ?? "manual";
const paths = readOptions("--path");

const result = enqueueChronologyIndexJob({
  toolRoot,
  vaultRoot,
  source,
  paths
});

console.log(JSON.stringify({
  jobId: result.id,
  label: "Chronology Index",
  jobPath: result.jobPath,
  logPath: result.logPath
}));
