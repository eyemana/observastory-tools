import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

import { getSchedulerConfig } from "../tool-config.mjs";
import {
  claimJob,
  ensureQueueDirs,
  finishJob,
  getQueuePaths,
  isCancelRequested,
  listQueuedJobFiles,
  normalizeEvaluations,
  readJob,
  writeJob
} from "./queue.mjs";

const __filename = fileURLToPath(import.meta.url);
const schedulerRoot = path.dirname(__filename);
const toolRoot = path.join(schedulerRoot, "..");
const evaluatorPath = path.join(toolRoot, "evaluators", "evaluate-scene.mjs");

class JobCanceledError extends Error {
  constructor(message = "Job canceled.") {
    super(message);
    this.name = "JobCanceledError";
  }
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sleepWithCancel(ms, paths, jobId) {
  const deadline = Date.now() + ms;

  while (Date.now() < deadline) {
    if (isCancelRequested(paths, jobId)) {
      throw new JobCanceledError();
    }

    await sleep(Math.min(1000, deadline - Date.now()));
  }
}

function appendLog(logPath, message) {
  fs.appendFileSync(logPath, message, "utf8");
}

function logLine(logPath, message = "") {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  appendLog(logPath, line);
  console.log(message);
}

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function readLock(lockFile) {
  try {
    return JSON.parse(fs.readFileSync(lockFile, "utf8"));
  } catch {
    return null;
  }
}

function acquireWorkerLock(paths) {
  fs.mkdirSync(paths.queueRoot, { recursive: true });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = fs.openSync(paths.lockFile, "wx");
      fs.writeFileSync(handle, JSON.stringify({
        pid: process.pid,
        startedAt: new Date().toISOString()
      }, null, 2));
      fs.closeSync(handle);

      return () => {
        const current = readLock(paths.lockFile);

        if (current?.pid === process.pid) {
          fs.rmSync(paths.lockFile, { force: true });
        }
      };
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }

      const current = readLock(paths.lockFile);

      if (isProcessRunning(current?.pid)) {
        return null;
      }

      fs.rmSync(paths.lockFile, { force: true });
    }
  }

  return null;
}

async function runEvaluator(filePath, metric, target, logPath, paths, jobId) {
  return new Promise((resolve) => {
    let canceled = false;
    const child = spawn(
      process.execPath,
      [
        evaluatorPath,
        filePath,
        metric,
        target
      ],
      {
        cwd: toolRoot,
        windowsHide: true
      }
    );

    const cancelTimer = setInterval(() => {
      if (!isCancelRequested(paths, jobId)) {
        return;
      }

      canceled = true;
      child.kill();
    }, 1000);

    child.stdout.on("data", (chunk) => appendLog(logPath, chunk.toString()));
    child.stderr.on("data", (chunk) => appendLog(logPath, chunk.toString()));

    child.on("error", (error) => {
      clearInterval(cancelTimer);
      appendLog(logPath, `${error.stack ?? error.message}\n`);
      resolve({
        ok: false,
        canceled,
        code: null,
        error
      });
    });

    child.on("close", (code) => {
      clearInterval(cancelTimer);
      resolve({
        ok: code === 0,
        canceled,
        code,
        error: null
      });
    });
  });
}

function listSceneFiles(scenesFolder) {
  return fs.readdirSync(scenesFolder, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .filter((entry) => entry.name.endsWith(".md"))
    .map((entry) => path.join(scenesFolder, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

async function processEvaluateScenesJob(jobPath, job, schedulerConfig, paths) {
  const logPath = path.join(paths.logsDir, `${job.id}.log`);
  const throttleMs = Math.max(0, Number(schedulerConfig.throttleMs) || 0);
  const evaluations = normalizeEvaluations(job.evaluations);

  if (evaluations.length === 0) {
    throw new Error(`Job ${job.id} does not contain any evaluations.`);
  }

  const sceneFiles = listSceneFiles(job.scenesFolder);
  const total = sceneFiles.length * evaluations.length;
  let success = 0;
  let failed = 0;
  const failures = [];

  logLine(logPath, `Starting job ${job.id}`);
  logLine(logPath, `Scenes folder: ${job.scenesFolder}`);
  logLine(logPath, `Found ${sceneFiles.length} scene files.`);
  logLine(logPath, `Planned evaluator calls: ${total}`);
  logLine(logPath, `Throttle: ${throttleMs}ms`);

  job.progress = {
    total,
    completed: 0,
    success,
    failed
  };
  job.updatedAt = new Date().toISOString();
  writeJob(jobPath, job);

  for (const [metric, target] of evaluations) {
    if (isCancelRequested(paths, job.id)) {
      throw new JobCanceledError();
    }

    logLine(logPath);
    logLine(logPath, `=== ${metric} / ${target} ===`);

    for (const filePath of sceneFiles) {
      if (isCancelRequested(paths, job.id)) {
        throw new JobCanceledError();
      }

      const sceneName = path.basename(filePath);
      logLine(logPath, `Evaluating ${sceneName}`);

      job.progress = {
        total,
        completed: success + failed,
        success,
        failed,
        currentScene: sceneName,
        currentMetric: metric,
        currentTarget: target
      };
      job.updatedAt = new Date().toISOString();
      writeJob(jobPath, job);

      const result = await runEvaluator(filePath, metric, target, logPath, paths, job.id);

      if (result.canceled) {
        throw new JobCanceledError();
      }

      if (result.ok) {
        success++;
      } else {
        failed++;
        failures.push({
          filePath,
          metric,
          target,
          code: result.code,
          error: result.error?.message
        });
        logLine(logPath, `Failed ${sceneName}: ${metric} / ${target}`);
      }

      job.progress = {
        total,
        completed: success + failed,
        success,
        failed,
        currentScene: sceneName,
        currentMetric: metric,
        currentTarget: target
      };
      job.updatedAt = new Date().toISOString();
      writeJob(jobPath, job);

      if (throttleMs > 0) {
        if (isCancelRequested(paths, job.id)) {
          throw new JobCanceledError();
        }

        await sleepWithCancel(throttleMs, paths, job.id);
      }
    }
  }

  logLine(logPath);
  logLine(logPath, `Job complete. ${success} succeeded, ${failed} failed.`);

  const status = failed === 0 ? "succeeded" : "failed";
  finishJob(jobPath, job, status, {
    progress: {
      total,
      completed: success + failed,
      success,
      failed
    },
    failures,
    logPath
  });
}

async function processJob(claimed, schedulerConfig, paths) {
  const { job, jobPath } = claimed;

  try {
    if (job.type !== "evaluate-scenes") {
      throw new Error(`Unsupported job type: ${job.type}`);
    }

    await processEvaluateScenesJob(jobPath, job, schedulerConfig, paths);
  } catch (error) {
    const logPath = path.join(paths.logsDir, `${job.id}.log`);

    if (error instanceof JobCanceledError) {
      logLine(logPath, `Job canceled: ${error.message}`);
      finishJob(jobPath, job, "canceled", {
        cancelReason: error.message,
        logPath
      });
      return;
    }

    logLine(logPath, `Job failed: ${error.stack ?? error.message}`);
    finishJob(jobPath, job, "failed", {
      error: error.message,
      logPath
    });
  }
}

async function processAvailableJobs({ once, schedulerConfig, paths }) {
  let processed = 0;

  while (true) {
    const queuedJobFiles = listQueuedJobFiles(paths);

    if (queuedJobFiles.length === 0) {
      return processed;
    }

    for (const queuedJobFile of queuedJobFiles) {
      const claimed = claimJob(queuedJobFile);

      if (!claimed) {
        continue;
      }

      const queuedJob = readJob(claimed.jobPath);
      await processJob({ ...claimed, job: queuedJob }, schedulerConfig, paths);
      processed++;

      if (once) {
        return processed;
      }
    }
  }
}

async function main() {
  const schedulerConfig = getSchedulerConfig(toolRoot);
  const paths = getQueuePaths(toolRoot, schedulerConfig);
  ensureQueueDirs(paths);

  const releaseLock = acquireWorkerLock(paths);

  if (!releaseLock) {
    console.log("Scheduler worker is already running.");
    return;
  }

  process.on("exit", releaseLock);
  process.on("SIGINT", () => {
    releaseLock();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    releaseLock();
    process.exit(143);
  });

  const watch = hasFlag("--watch") ||
    (!hasFlag("--drain") && !hasFlag("--once") && schedulerConfig.mode === "background");
  const once = hasFlag("--once");
  const pollIntervalMs = Math.max(1000, Number(schedulerConfig.pollIntervalMs) || 30000);

  if (!watch) {
    await processAvailableJobs({
      once,
      schedulerConfig,
      paths
    });
    return;
  }

  console.log(`Scheduler worker watching ${paths.jobsDir}`);
  console.log(`Polling every ${pollIntervalMs}ms`);

  while (true) {
    await processAvailableJobs({
      once: false,
      schedulerConfig,
      paths
    });
    await sleep(pollIntervalMs);
  }
}

await main();
