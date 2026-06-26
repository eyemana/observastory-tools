import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { getSchedulerConfig } from "../tool-config.mjs";
import {
  findJobFile,
  getQueuePaths,
  listActiveJobFiles,
  readJob,
  requestCancelJob,
  writeJob
} from "./queue.mjs";

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

function getLatestActiveJobId(paths) {
  const activeJobs = listActiveJobFiles(paths);

  if (activeJobs.length === 0) {
    return null;
  }

  const latestJobPath = activeJobs[activeJobs.length - 1];
  return readJob(latestJobPath).id;
}

function markStaleRunningJobCanceled(paths, jobId, reason) {
  const jobPath = findJobFile(paths, jobId);

  if (!jobPath?.endsWith(".running.json")) {
    return null;
  }

  const lock = readLock(paths.lockFile);

  if (isProcessRunning(lock?.pid)) {
    return null;
  }

  const now = new Date().toISOString();
  const job = readJob(jobPath);
  job.status = "canceled";
  job.cancelReason = reason;
  job.canceledAt = now;
  job.updatedAt = now;
  writeJob(jobPath, job);

  const canceledPath = jobPath.replace(/\.running\.json$/, ".canceled.json");
  fs.renameSync(jobPath, canceledPath);

  return canceledPath;
}

const schedulerConfig = getSchedulerConfig(toolRoot);
const paths = getQueuePaths(toolRoot, schedulerConfig);
const positional = process.argv.slice(2).filter((arg, index, args) => {
  const previous = args[index - 1];
  return !arg.startsWith("--") && previous !== "--reason";
});
const requestedJobId = positional[0];
const reason = readOption("--reason") ?? "Cancellation requested.";
const jobId = requestedJobId === "--latest" || !requestedJobId
  ? getLatestActiveJobId(paths)
  : requestedJobId;

if (!jobId) {
  console.error("No queued or running jobs found.");
  process.exit(1);
}

const result = requestCancelJob(paths, jobId, reason);
const staleCanceledPath = markStaleRunningJobCanceled(paths, jobId, reason);

console.log(JSON.stringify({
  jobId,
  status: staleCanceledPath ? "canceled" : result.status,
  jobPath: staleCanceledPath ?? result.jobPath,
  markerPath: result.markerPath
}));
