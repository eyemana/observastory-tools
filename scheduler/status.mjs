import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { loadConfig } from "../tool-config.mjs";
import {
  getQueuePaths,
  readJob,
  readWorkerStop
} from "./queue.mjs";
import {
  getWorkerRuntime,
  jobIsOwnedByWorker
} from "./runtime.mjs";
import {
  buildFreshnessReport,
  writeFreshnessReport
} from "../status/freshness.mjs";

const __filename = fileURLToPath(import.meta.url);
const schedulerRoot = path.dirname(__filename);
const toolRoot = path.join(schedulerRoot, "..");

async function checkModel(config) {
  const endpoint = config.ollamaUrl;
  const model = config.model;

  if (!endpoint) {
    return {
      status: "not-configured",
      endpoint: null,
      model,
      reason: "No Ollama endpoint is configured."
    };
  }

  try {
    const url = new URL(endpoint);
    url.pathname = "/api/tags";
    url.search = "";
    const response = await fetch(url, {
      signal: AbortSignal.timeout(1500)
    });

    if (!response.ok) {
      return {
        status: "unavailable",
        endpoint,
        model,
        reason: `Ollama returned HTTP ${response.status}.`
      };
    }

    const body = await response.json();
    const names = (body.models ?? []).map(item => item.name);
    const modelAvailable = names.includes(model);
    return {
      status: modelAvailable ? "ready" : "model-missing",
      endpoint,
      model,
      availableModels: names,
      reason: modelAvailable
        ? "Ollama is reachable and the configured model is installed."
        : `Ollama is reachable, but ${model} is not installed.`
    };
  } catch (error) {
    return {
      status: "unavailable",
      endpoint,
      model,
      reason: error.cause?.code === "ECONNREFUSED"
        ? "Ollama is not running."
        : `Ollama could not be reached: ${error.message}`
    };
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

function summarizeJob(jobPath, worker) {
  const job = readJob(jobPath);
  const status = job.status === "running" && !jobIsOwnedByWorker(job, worker)
    ? "orphaned"
    : job.status;

  return {
    id: job.id,
    type: job.type,
    label: job.label,
    status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    updatedAt: job.updatedAt,
    progress: job.progress,
    worker: job.worker ?? null,
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

const config = loadConfig(toolRoot);
const schedulerConfig = config.scheduler;
const paths = getQueuePaths(toolRoot, schedulerConfig);
const worker = getWorkerRuntime(paths);
const stopRequest = readWorkerStop(paths);
const jobs = listJobFiles(paths).map(jobPath => summarizeJob(jobPath, worker));
const activeJobs = jobs.filter(job => ["queued", "running", "orphaned"].includes(job.status));
const recentJobs = jobs
  .filter(job => !["queued", "running", "orphaned"].includes(job.status))
  .slice(-5)
  .reverse();
let processingStatus = null;
let processingStatusError = null;

if (!process.argv.includes("--queue-only")) {
  try {
    const options = { vaultRoot: readOption("--vault-root") };
    const report = process.argv.includes("--write-processing-status")
      ? writeFreshnessReport(toolRoot, options)
      : buildFreshnessReport(toolRoot, options);
    processingStatus = summarizeFreshness(report);
  } catch (error) {
    processingStatusError = error.message;
  }
}

const model = process.argv.includes("--check-model")
  ? await checkModel(config)
  : null;

const result = {
  worker,
  model,
  stopRequest,
  queue: {
    queued: activeJobs.filter(job => job.status === "queued").length,
    running: activeJobs.filter(job => job.status === "running").length,
    orphaned: activeJobs.filter(job => job.status === "orphaned").length,
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

  if (model) {
    console.log(`Model: ${model.status} - ${model.reason}`);
  }

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
