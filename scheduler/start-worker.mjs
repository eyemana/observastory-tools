import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

import { getSchedulerConfig } from "../tool-config.mjs";
import { getQueuePaths } from "./queue.mjs";
import { getWorkerRuntime } from "./runtime.mjs";

const __filename = fileURLToPath(import.meta.url);
const schedulerRoot = path.dirname(__filename);
const toolRoot = path.join(schedulerRoot, "..");

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForVerifiedWorker(paths, pid, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const worker = getWorkerRuntime(paths);
    if (worker.pid === pid && worker.status === "running") {
      return worker;
    }
    if (!worker.processRunning && worker.pid === pid) {
      break;
    }
    await wait(150);
  }
  return getWorkerRuntime(paths);
}

const schedulerConfig = getSchedulerConfig(toolRoot);
const paths = getQueuePaths(toolRoot, schedulerConfig);
const existing = getWorkerRuntime(paths);

if (existing.status === "running") {
  console.log(JSON.stringify({
    status: "already-running",
    worker: existing,
    message: "Background scheduler is already running."
  }));
  process.exit(0);
}

if (existing.processRunning) {
  console.log(JSON.stringify({
    status: existing.status,
    worker: existing,
    message: "A scheduler process exists but did not provide a current verified heartbeat."
  }));
  process.exit(2);
}

const mode = process.argv.includes("--drain")
  ? "--drain"
  : process.argv.includes("--once")
    ? "--once"
    : "--watch";
const workerScript = path.join(schedulerRoot, "worker.mjs");
fs.mkdirSync(paths.queueRoot, { recursive: true });
const workerLogPath = path.join(paths.queueRoot, "worker.log");
const stdout = fs.openSync(workerLogPath, "a");
const stderr = fs.openSync(workerLogPath, "a");
const child = spawn(
  process.execPath,
  [workerScript, mode],
  {
    cwd: toolRoot,
    detached: true,
    stdio: ["ignore", stdout, stderr],
    windowsHide: true
  }
);
fs.closeSync(stdout);
fs.closeSync(stderr);
child.unref();

const worker = await waitForVerifiedWorker(paths, child.pid);
if (worker.status !== "running" || worker.pid !== child.pid) {
  console.log(JSON.stringify({
    status: "failed",
    pid: child.pid,
    worker,
    workerLogPath,
    message: "Scheduler process did not establish a verified heartbeat."
  }));
  process.exit(1);
}

console.log(JSON.stringify({
  status: "started",
  worker,
  workerLogPath,
  message: "Background scheduler started and verified."
}));
