import crypto from "crypto";
import fs from "fs";
import path from "path";

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(3).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, filePath);
}

export function isProcessRunning(pid) {
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

export function readWorkerLease(paths) {
  return {
    lock: readJson(paths.lockFile),
    heartbeat: readJson(paths.heartbeatFile)
  };
}

export function getWorkerRuntime(paths, options = {}) {
  const heartbeatTimeoutMs = Math.max(3000, Number(options.heartbeatTimeoutMs) || 15000);
  const { lock, heartbeat } = readWorkerLease(paths);
  const pid = Number(lock?.pid);
  const processRunning = isProcessRunning(pid);
  const heartbeatAt = heartbeat?.heartbeatAt ?? null;
  const heartbeatMs = Date.parse(heartbeatAt);
  const heartbeatAgeMs = Number.isFinite(heartbeatMs)
    ? Math.max(0, Date.now() - heartbeatMs)
    : null;
  const identityMatches = Boolean(
    lock?.instanceId &&
    heartbeat?.instanceId === lock.instanceId &&
    Number(heartbeat?.pid) === pid
  );

  let status = "not-running";
  if (lock && !processRunning) {
    status = "stale-lock";
  } else if (processRunning && !identityMatches) {
    status = "unverified";
  } else if (processRunning && heartbeatAgeMs > heartbeatTimeoutMs) {
    status = "unresponsive";
  } else if (processRunning) {
    status = "running";
  }

  return {
    status,
    pid: Number.isInteger(pid) ? pid : null,
    instanceId: lock?.instanceId ?? null,
    startedAt: lock?.startedAt ?? null,
    heartbeatAt,
    heartbeatAgeMs,
    processRunning,
    verified: status === "running",
    lockPresent: Boolean(lock),
    lockFile: paths.lockFile,
    heartbeatFile: paths.heartbeatFile
  };
}

export function acquireWorkerLease(paths) {
  fs.mkdirSync(paths.queueRoot, { recursive: true });

  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = getWorkerRuntime(paths);
    if (existing.processRunning) {
      return null;
    }

    if (existing.lockPresent) {
      fs.rmSync(paths.lockFile, { force: true });
      fs.rmSync(paths.heartbeatFile, { force: true });
    }

    const identity = {
      pid: process.pid,
      instanceId: crypto.randomUUID(),
      startedAt: new Date().toISOString()
    };

    try {
      const handle = fs.openSync(paths.lockFile, "wx");
      fs.writeFileSync(handle, `${JSON.stringify(identity, null, 2)}\n`);
      fs.closeSync(handle);

      const touch = () => {
        writeJsonAtomic(paths.heartbeatFile, {
          ...identity,
          heartbeatAt: new Date().toISOString()
        });
      };
      touch();

      const release = () => {
        const current = readJson(paths.lockFile);
        if (current?.instanceId === identity.instanceId) {
          fs.rmSync(paths.lockFile, { force: true });
          fs.rmSync(paths.heartbeatFile, { force: true });
        }
      };

      return {
        identity,
        touch,
        release
      };
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
    }
  }

  return null;
}

export function jobIsOwnedByWorker(job, worker) {
  return Boolean(
    job?.status === "running" &&
    job.worker?.instanceId &&
    worker?.instanceId &&
    job.worker.instanceId === worker.instanceId &&
    Number(job.worker.pid) === Number(worker.pid) &&
    worker.processRunning
  );
}

export function recoverOrphanedJobs(paths, workerIdentity) {
  if (!fs.existsSync(paths.jobsDir)) {
    return [];
  }

  const recovered = [];
  const runningFiles = fs.readdirSync(paths.jobsDir)
    .filter(name => name.endsWith(".running.json"))
    .sort((a, b) => a.localeCompare(b));

  for (const name of runningFiles) {
    const runningPath = path.join(paths.jobsDir, name);
    const job = readJson(runningPath);
    const owned = Boolean(
      job?.worker?.instanceId &&
      workerIdentity?.instanceId &&
      job.worker.instanceId === workerIdentity.instanceId &&
      Number(job.worker.pid) === Number(workerIdentity.pid)
    );

    if (!job || owned) {
      continue;
    }

    const now = new Date().toISOString();
    const queuedPath = runningPath.replace(/\.running\.json$/, ".queued.json");
    const recoveredJob = {
      ...job,
      status: "queued",
      updatedAt: now,
      recoveredAt: now,
      recoveryCount: (Number(job.recoveryCount) || 0) + 1,
      previousWorker: job.worker ?? null,
      previousProgress: job.progress ?? null,
      worker: null,
      startedAt: null,
      progress: null
    };
    writeJsonAtomic(runningPath, recoveredJob);
    fs.renameSync(runningPath, queuedPath);
    recovered.push({
      id: job.id,
      from: runningPath,
      to: queuedPath
    });
  }

  return recovered;
}
