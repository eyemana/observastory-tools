import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { getSchedulerConfig } from "../tool-config.mjs";
import {
  getQueuePaths,
  readJob,
  readWorkerStop
} from "./queue.mjs";
import {
  buildFreshnessReport,
  writeFreshnessReport
} from "../status/freshness.mjs";

const __filename = fileURLToPath(import.meta.url);
const schedulerRoot = path.dirname(__filename);
const toolRoot = path.join(schedulerRoot, "..");

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

function readOption(name) {
  const index = process.argv.indexOf(name);

  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
}

function listJobFiles(paths) {
  if (!fs.existsSync(paths.jobsDir)) {
    return [];
  }

  return fs.readdirSync(paths.jobsDir)
    .filter(name => name.endsWith(".json"))
    .filter(name => !name.endsWith(".cancel.json"))
    .sort((a, b) => a.localeCompare(b))
    .map(name => path.join(paths.jobsDir, name));
}

function summarizeJob(jobPath) {
  const job = readJob(jobPath);

  return {
    id: job.id,
    type: job.type,
    label: job.label,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    updatedAt: job.updatedAt,
    progress: job.progress,
    error: job.error,
    logPath: job.logPath ?? path.join(path.dirname(path.dirname(jobPath)), "logs", `${job.id}.log`)
  };
}

function formatJob(job) {
  const progress = job.progress ?? {};
  const completed = Number(progress.completed) || 0;
  const total = Number(progress.total) || 0;
  const count = total > 0 ? `${completed}/${total}` : `${completed}`;
  const current = progress.currentScene ??
    progress.currentNote ??
    [progress.currentMetric, progress.currentTarget].filter(Boolean).join(" / ");
  const currentText = current ? ` - ${current}` : "";

  return `${job.status.padEnd(9)} ${job.label ?? job.type} ${count}${currentText}`;
}

function summarizeFreshness(report) {
  return {
    generatedAt: report.generatedAt,
    outputPath: report.outputPath,
    scenes: {
      total: report.scenes.total,
      fingerprintCounts: report.scenes.fingerprintCounts,
      axisCounts: report.scenes.axisCounts,
      staleSceneCount: report.scenes.staleSceneFiles.length,
      pendingSceneCount: report.scenes.pendingSceneFiles.length
    },
    truthLedger: {
      total: report.truthLedger.total,
      generatedAt: report.truthLedger.generatedAt,
      counts: report.truthLedger.counts,
      needsUpdate: report.truthLedger.needsUpdate
    },
    chronology: {
      total: report.chronology.total,
      counts: report.chronology.counts,
      needsUpdate: report.chronology.needsUpdate
    },
    recommendations: {
      queueSceneEvaluation: report.recommendations.queueSceneEvaluation,
      queueTruthLedger: report.recommendations.queueTruthLedger,
      queueChronologyIndex: report.recommendations.queueChronologyIndex
    }
  };
}

const schedulerConfig = getSchedulerConfig(toolRoot);
const paths = getQueuePaths(toolRoot, schedulerConfig);
const lock = readLock(paths.lockFile);
const pid = Number(lock?.pid);
const running = isProcessRunning(pid);
const stopRequest = readWorkerStop(paths);
const jobs = listJobFiles(paths).map(summarizeJob);
const activeJobs = jobs.filter(job => ["queued", "running"].includes(job.status));
const recentJobs = jobs
  .filter(job => !["queued", "running"].includes(job.status))
  .slice(-5)
  .reverse();
let processingStatus = null;
let processingStatusError = null;

try {
  const options = { vaultRoot: readOption("--vault-root") };
  const report = process.argv.includes("--write-processing-status")
    ? writeFreshnessReport(toolRoot, options)
    : buildFreshnessReport(toolRoot, options);
  processingStatus = summarizeFreshness(report);
} catch (error) {
  processingStatusError = error.message;
}

const result = {
  worker: {
    status: running ? "running" : lock ? "stale-lock" : "not-running",
    pid: Number.isInteger(pid) ? pid : null,
    startedAt: lock?.startedAt ?? null,
    lockFile: paths.lockFile
  },
  stopRequest,
  queue: {
    queued: activeJobs.filter(job => job.status === "queued").length,
    running: activeJobs.filter(job => job.status === "running").length,
    active: activeJobs,
    recent: recentJobs
  },
  processingStatus,
  processingStatusError
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`Worker: ${result.worker.status}${result.worker.pid ? ` pid ${result.worker.pid}` : ""}`);

  if (stopRequest) {
    console.log(`Stop after current: requested at ${stopRequest.requestedAt}`);
  }

  if (activeJobs.length === 0) {
    console.log("Active jobs: none");
  } else {
    console.log("Active jobs:");
    for (const job of activeJobs) {
      console.log(`- ${formatJob(job)}`);
    }
  }

  if (recentJobs.length > 0) {
    console.log("Recent jobs:");
    for (const job of recentJobs) {
      console.log(`- ${formatJob(job)}`);
    }
  }

  if (processingStatus) {
    const axes = processingStatus.scenes.axisCounts;
    const truth = processingStatus.truthLedger.counts;
    const chronology = processingStatus.chronology.counts;

    console.log("Processing status:");
    console.log(
      `- Scene axes: ${axes.fresh} fresh, ${axes.stale} stale, ${axes.pending} pending, ${axes.unknown ?? 0} unknown, ${axes["never-run"]} never run, ${axes.legacy} legacy`
    );
    console.log(
      `- Truth Ledger: ${truth.fresh} fresh, ${truth.stale} stale, ${truth["never-run"]} never run, ${truth.legacy} legacy, ${truth.deleted} deleted`
    );
    console.log(
      `- Chronology: ${chronology.fresh} fresh, ${chronology.stale} stale, ${chronology["never-run"]} never run, ${chronology.legacy} legacy, ${chronology.invalid} invalid`
    );

    if (process.argv.includes("--write-processing-status")) {
      console.log(`- Report data: ${processingStatus.outputPath}`);
    }
  } else if (processingStatusError) {
    console.log(`Processing status unavailable: ${processingStatusError}`);
  }
}
