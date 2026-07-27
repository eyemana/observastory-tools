import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { getSchedulerConfig } from "../tool-config.mjs";
import {
  getQueuePaths,
  listActiveJobFiles,
  readJob,
  requestWorkerStop
} from "./queue.mjs";
import {
  getWorkerRuntime,
  isProcessRunning
} from "./runtime.mjs";

const __filename = fileURLToPath(import.meta.url);
const schedulerRoot = path.dirname(__filename);
const toolRoot = path.join(schedulerRoot, "..");

function hasFlag(name) {
  return process.argv.includes(name);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForStop(pid, lockFile, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!isProcessRunning(pid) || !fs.existsSync(lockFile)) {
      return true;
    }

    await wait(250);
  }

  return !isProcessRunning(pid);
}

const schedulerConfig = getSchedulerConfig(toolRoot);
const paths = getQueuePaths(toolRoot, schedulerConfig);
const worker = getWorkerRuntime(paths);
const pid = worker.pid;
const afterCurrent = hasFlag("--after-current") || hasFlag("--graceful");

if (!worker.processRunning || !Number.isInteger(pid)) {
  fs.rmSync(paths.lockFile, { force: true });
  fs.rmSync(paths.heartbeatFile, { force: true });
  console.log(JSON.stringify({
    status: "not-running",
    mode: afterCurrent ? "after-current" : "immediate",
    message: "Background scheduler is not running; no stop request was left behind."
  }));
  process.exit(0);
}

if (afterCurrent) {
  const stopFile = requestWorkerStop(paths);
  const activeJobs = listActiveJobFiles(paths).map(jobPath => readJob(jobPath));
  const runningJobs = activeJobs.filter(job => job.status === "running");

  console.log(JSON.stringify({
    status: "stop-requested",
    mode: "after-current",
    pid,
    runningJobs: runningJobs.map(job => ({
      id: job.id,
      type: job.type,
      label: job.label,
      progress: job.progress
    })),
    stopFile
  }));
  process.exit(0);
}

try {
  process.kill(pid, "SIGTERM");
} catch (error) {
  if (error.code !== "ESRCH") {
    throw error;
  }
}

const stopped = await waitForStop(pid, paths.lockFile);

console.log(JSON.stringify({
  status: stopped ? "stopped" : "stop-requested",
  pid,
  lockFile: paths.lockFile
}));
