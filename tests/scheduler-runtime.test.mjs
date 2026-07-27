import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  getWorkerRuntime,
  recoverOrphanedJobs
} from "../scheduler/runtime.mjs";

function makePaths(root) {
  return {
    queueRoot: root,
    jobsDir: path.join(root, "jobs"),
    lockFile: path.join(root, "worker.lock"),
    heartbeatFile: path.join(root, "worker.heartbeat.json")
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("worker runtime requires a matching live heartbeat", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "observastory-runtime-"));
  const paths = makePaths(root);
  const identity = {
    pid: process.pid,
    instanceId: "worker-current",
    startedAt: new Date().toISOString()
  };
  writeJson(paths.lockFile, identity);
  writeJson(paths.heartbeatFile, {
    ...identity,
    heartbeatAt: new Date().toISOString()
  });

  assert.equal(getWorkerRuntime(paths).status, "running");

  writeJson(paths.heartbeatFile, {
    ...identity,
    heartbeatAt: new Date(Date.now() - 60000).toISOString()
  });
  assert.equal(getWorkerRuntime(paths).status, "unresponsive");
  fs.rmSync(root, { recursive: true, force: true });
});

test("orphan recovery requeues only work not owned by the current worker", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "observastory-orphan-"));
  const paths = makePaths(root);
  const current = {
    pid: process.pid,
    instanceId: "worker-current",
    startedAt: new Date().toISOString()
  };
  const orphanPath = path.join(paths.jobsDir, "orphan.running.json");
  const ownedPath = path.join(paths.jobsDir, "owned.running.json");
  writeJson(orphanPath, {
    id: "orphan",
    status: "running",
    worker: { pid: 123, instanceId: "worker-old" },
    progress: { total: 10, completed: 4 }
  });
  writeJson(ownedPath, {
    id: "owned",
    status: "running",
    worker: current,
    progress: { total: 10, completed: 2 }
  });

  const recovered = recoverOrphanedJobs(paths, current);
  assert.deepEqual(recovered.map(item => item.id), ["orphan"]);
  assert.equal(fs.existsSync(orphanPath), false);
  const queued = JSON.parse(
    fs.readFileSync(path.join(paths.jobsDir, "orphan.queued.json"), "utf8")
  );
  assert.equal(queued.status, "queued");
  assert.equal(queued.recoveryCount, 1);
  assert.deepEqual(queued.previousProgress, { total: 10, completed: 4 });
  assert.equal(fs.existsSync(ownedPath), true);
  fs.rmSync(root, { recursive: true, force: true });
});
