import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import crypto from "crypto";
import matter from "gray-matter";

import {
  defaultScenesPath,
  defaultChronologyPaths,
  defaultTruthLedgerPaths,
  getSchedulerConfig,
  loadConfig
} from "../tool-config.mjs";
import {
  getEvaluationProfile,
  listEligibleMarkdownFiles,
  mergeFilterConfigs
} from "../evaluation-filters.mjs";
import {
  claimJob,
  clearWorkerStop,
  enqueueEvaluateScenesJob,
  ensureQueueDirs,
  finishJob,
  getQueuePaths,
  isCancelRequested,
  isWorkerStopRequested,
  listActiveJobFiles,
  listQueuedJobFiles,
  normalizeEvaluations,
  readJob,
  writeJob
} from "./queue.mjs";

const __filename = fileURLToPath(import.meta.url);
const schedulerRoot = path.dirname(__filename);
const toolRoot = path.join(schedulerRoot, "..");
const evaluatorPath = path.join(toolRoot, "evaluators", "evaluate-scene.mjs");
const truthCollectorPath = path.join(toolRoot, "truth", "collect-truth-ledger.mjs");
const chronologyIndexerPath = path.join(toolRoot, "chronology", "index-scene.mjs");

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

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonFileAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(3).toString("hex")}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function configuredPathFromToolRoot(configuredPath) {
  if (path.isAbsolute(configuredPath)) {
    return configuredPath;
  }

  return path.join(toolRoot, configuredPath);
}

function backgroundFingerprintPath(schedulerConfig) {
  const configured = schedulerConfig.backgroundSceneScan?.fingerprintPath ??
    ".queue/background-scene-fingerprints.json";
  return configuredPathFromToolRoot(configured);
}

function authorSceneFingerprint(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = matter(raw);
  const frontmatter = { ...(parsed.data ?? {}) };
  delete frontmatter.ai;

  return crypto
    .createHash("sha256")
    .update(JSON.stringify({
      frontmatter,
      content: parsed.content
    }))
    .digest("hex");
}

function sceneAlreadyQueued(paths, filePath) {
  const resolved = path.resolve(filePath);

  for (const activeJobFile of listActiveJobFiles(paths)) {
    const job = readJob(activeJobFile);

    if (job?.type !== "evaluate-scenes") {
      continue;
    }

    if (!Array.isArray(job.sceneFiles) || job.sceneFiles.length === 0) {
      const scenesFolder = job.scenesFolder ? path.resolve(job.scenesFolder) : null;
      if (scenesFolder && resolved.startsWith(`${scenesFolder}${path.sep}`)) {
        return true;
      }
    }

    const sceneFiles = Array.isArray(job.sceneFiles)
      ? job.sceneFiles.map((sceneFile) => path.resolve(sceneFile))
      : [];

    if (sceneFiles.includes(resolved)) {
      return true;
    }
  }

  return false;
}

function scanBackgroundSceneChanges(schedulerConfig, paths) {
  const scanConfig = schedulerConfig.backgroundSceneScan ?? {};

  if (scanConfig.enabled === false) {
    return;
  }

  const config = loadConfig(toolRoot);
  const evaluationProfileName = config.evaluation?.defaultProfile ?? "default";
  const profile = getEvaluationProfile(config, evaluationProfileName);
  const vaultRoot = path.resolve(toolRoot, "..");
  const scenesFolder = path.resolve(vaultRoot, defaultScenesPath(config));
  const fingerprintPath = backgroundFingerprintPath(schedulerConfig);
  const state = readJsonFile(fingerprintPath, {
    version: 1,
    files: {},
    pending: {}
  });
  const files = listEligibleMarkdownFiles(scenesFolder, profile.sceneFilters);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const debounceMs = Math.max(1000, Number(scanConfig.debounceMs) || 5000);
  const knownFiles = state.files ?? {};
  const pending = state.pending ?? {};

  if (Object.keys(knownFiles).length === 0 && scanConfig.baselineOnFirstRun !== false) {
    for (const filePath of files) {
      knownFiles[path.resolve(filePath)] = {
        fingerprint: authorSceneFingerprint(filePath),
        updatedAt: nowIso
      };
    }

    state.files = knownFiles;
    state.pending = {};
    state.baselinedAt = nowIso;
    writeJsonFileAtomic(fingerprintPath, state);
    return;
  }

  const changed = [];
  const activePaths = new Set(files.map((filePath) => path.resolve(filePath)));

  for (const filePath of files) {
    const resolved = path.resolve(filePath);
    const fingerprint = authorSceneFingerprint(filePath);
    const known = knownFiles[resolved]?.fingerprint;

    if (known === fingerprint) {
      delete pending[resolved];
      continue;
    }

    if (pending[resolved]?.fingerprint !== fingerprint) {
      pending[resolved] = {
        fingerprint,
        firstSeenAt: nowIso
      };
      continue;
    }

    const firstSeenMs = Date.parse(pending[resolved].firstSeenAt);

    if (!Number.isFinite(firstSeenMs) || now - firstSeenMs < debounceMs) {
      continue;
    }

    if (!sceneAlreadyQueued(paths, resolved)) {
      changed.push(resolved);
    }

    knownFiles[resolved] = {
      fingerprint,
      updatedAt: nowIso
    };
    delete pending[resolved];
  }

  for (const knownPath of Object.keys(knownFiles)) {
    if (!activePaths.has(knownPath)) {
      delete knownFiles[knownPath];
      delete pending[knownPath];
    }
  }

  state.files = knownFiles;
  state.pending = pending;
  state.updatedAt = nowIso;
  writeJsonFileAtomic(fingerprintPath, state);

  if (changed.length === 0) {
    return;
  }

  const result = enqueueEvaluateScenesJob({
    toolRoot,
    scenesFolder,
    sceneFiles: changed,
    vaultRoot,
    source: "background-scene-scan",
    evaluationProfile: profile.name,
    sceneFilters: {},
    force: false,
    label: `Background Changed Scene Evaluation (${changed.length})`,
    evaluations: schedulerConfig.evaluations
  });

  console.log(`Queued ${changed.length} changed scene(s) from background scan: ${result.id}`);
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

async function runEvaluator(filePath, metric, target, profileName, logPath, paths, jobId, force = false) {
  const args = [
    evaluatorPath,
    filePath,
    metric,
    target
  ];

  if (profileName) {
    args.push("--profile", profileName);
  }

  if (force) {
    args.push("--force");
  }

  return new Promise((resolve) => {
    let canceled = false;
    const child = spawn(
      process.execPath,
      args,
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

async function runTruthCollector(args, logPath, paths, jobId) {
  return new Promise((resolve) => {
    let canceled = false;
    let stdout = "";
    let stderr = "";
    const child = spawn(
      process.execPath,
      [
        truthCollectorPath,
        ...args
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

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearInterval(cancelTimer);
      appendLog(logPath, `${error.stack ?? error.message}\n`);
      resolve({
        ok: false,
        canceled,
        code: null,
        stdout,
        stderr,
        error
      });
    });

    child.on("close", (code) => {
      clearInterval(cancelTimer);

      if (stderr.trim()) {
        appendLog(logPath, stderr);
        if (!stderr.endsWith("\n")) {
          appendLog(logPath, "\n");
        }
      }

      resolve({
        ok: code === 0,
        canceled,
        code,
        stdout,
        stderr,
        error: null
      });
    });
  });
}

async function runChronologyIndexer(args, logPath, paths, jobId) {
  return new Promise((resolve) => {
    let canceled = false;
    let stdout = "";
    let stderr = "";
    const child = spawn(
      process.execPath,
      [
        chronologyIndexerPath,
        ...args
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

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearInterval(cancelTimer);
      appendLog(logPath, `${error.stack ?? error.message}\n`);
      resolve({
        ok: false,
        canceled,
        code: null,
        stdout,
        stderr,
        error
      });
    });

    child.on("close", (code) => {
      clearInterval(cancelTimer);

      if (stderr.trim()) {
        appendLog(logPath, stderr);
        if (!stderr.endsWith("\n")) {
          appendLog(logPath, "\n");
        }
      }

      resolve({
        ok: code === 0,
        canceled,
        code,
        stdout,
        stderr,
        error: null
      });
    });
  });
}

function getJobSceneFiles(job, fullConfig) {
  if (Array.isArray(job.sceneFiles) && job.sceneFiles.length > 0) {
    return job.sceneFiles
      .filter((filePath) => typeof filePath === "string")
      .map((filePath) => path.resolve(filePath))
      .filter((filePath) => filePath.endsWith(".md"))
      .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
  }

  const profile = getEvaluationProfile(fullConfig, job.evaluationProfile);
  const sceneFilters = mergeFilterConfigs(profile.sceneFilters, job.sceneFilters);

  return listEligibleMarkdownFiles(job.scenesFolder, sceneFilters);
}

function resolvePath(root, candidate) {
  if (!candidate) {
    return null;
  }

  return path.isAbsolute(candidate)
    ? candidate
    : path.resolve(root, candidate);
}

function walkMarkdownFiles(root) {
  if (!root || !fs.existsSync(root)) {
    return [];
  }

  if (fs.statSync(root).isFile()) {
    return root.endsWith(".md") ? [root] : [];
  }

  const files = [];
  const entries = fs.readdirSync(root, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const entryPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...walkMarkdownFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(entryPath);
    }
  }

  return files;
}

function writeJsonAtomic(targetPath, value) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  const tempPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`
  );

  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, targetPath);
}

function sortClaims(a, b) {
  return (
    String(a.subject ?? "").localeCompare(String(b.subject ?? "")) ||
    String(a.id ?? "").localeCompare(String(b.id ?? "")) ||
    String(a.source?.path ?? "").localeCompare(String(b.source?.path ?? "")) ||
    (Number(a.source?.line) || 0) - (Number(b.source?.line) || 0)
  );
}

function findDuplicateClaimErrors(claims) {
  const errors = [];
  const seen = new Map();

  for (const claim of claims) {
    const where = `${claim.source?.path ?? "(unknown)"}:${claim.source?.line ?? "?"}`;

    if (!claim.id) {
      errors.push(`Claim is missing an id at ${where}`);
      continue;
    }

    if (seen.has(claim.id)) {
      errors.push(
        `Duplicate claim id "${claim.id}" at ${where}; first seen at ${seen.get(claim.id)}`
      );
    } else {
      seen.set(claim.id, where);
    }
  }

  return errors;
}

async function processEvaluateScenesJob(jobPath, job, schedulerConfig, paths) {
  const logPath = path.join(paths.logsDir, `${job.id}.log`);
  const throttleMs = Math.max(0, Number(schedulerConfig.throttleMs) || 0);
  const evaluations = normalizeEvaluations(job.evaluations);
  const fullConfig = loadConfig(toolRoot);

  if (evaluations.length === 0) {
    throw new Error(`Job ${job.id} does not contain any evaluations.`);
  }

  const sceneFiles = getJobSceneFiles(job, fullConfig);
  const profile = getEvaluationProfile(fullConfig, job.evaluationProfile);
  const total = sceneFiles.length * evaluations.length;
  let success = 0;
  let failed = 0;
  const failures = [];

  logLine(logPath, `Starting job ${job.id}`);
  logLine(logPath, `Evaluation profile: ${profile.name}`);
  logLine(logPath, `Scenes folder: ${job.scenesFolder}`);
  if (job.sceneFiles?.length) {
    logLine(logPath, `Explicit scene files: ${job.sceneFiles.length}`);
  }
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

      const result = await runEvaluator(
        filePath,
        metric,
        target,
        profile.name,
        logPath,
        paths,
        job.id,
        job.force === true
      );

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

async function processTruthLedgerJob(jobPath, job, schedulerConfig, paths) {
  const logPath = path.join(paths.logsDir, `${job.id}.log`);
  const throttleMs = Math.max(0, Number(schedulerConfig.throttleMs) || 0);
  const fullConfig = loadConfig(toolRoot);
  const truthConfig = fullConfig.truthLedger ?? {};
  const vaultRoot = job.vaultRoot
    ? path.resolve(job.vaultRoot)
    : path.resolve(toolRoot, "..");
  const configuredPaths = defaultTruthLedgerPaths(fullConfig);
  const scanRoots = configuredPaths.map(scanPath => resolvePath(vaultRoot, scanPath));
  const files = [...new Set(scanRoots.flatMap(walkMarkdownFiles))].sort();
  const outputPath = resolvePath(
    toolRoot,
    truthConfig.outputPath ?? ".index/truth-ledger.json"
  );
  const partialsDir = path.join(paths.queueRoot, "partials", job.id);
  const entities = new Map();
  const claims = [];
  const inferredClaims = [];
  const warnings = [];
  const failures = [];
  let success = 0;
  let failed = 0;

  fs.mkdirSync(partialsDir, { recursive: true });

  logLine(logPath, `Starting truth ledger job ${job.id}`);
  logLine(logPath, `Vault root: ${vaultRoot}`);
  logLine(logPath, `Found ${files.length} note files.`);
  logLine(logPath, `Inference: ${job.infer === false ? "off" : "on"}`);
  logLine(logPath, `Throttle: ${throttleMs}ms`);

  job.progress = {
    total: files.length,
    completed: 0,
    success,
    failed
  };
  job.updatedAt = new Date().toISOString();
  writeJob(jobPath, job);

  for (const [index, filePath] of files.entries()) {
    if (isCancelRequested(paths, job.id)) {
      throw new JobCanceledError();
    }

    const relativePath = path.relative(vaultRoot, filePath);
    const partialPath = path.join(partialsDir, `${String(index + 1).padStart(5, "0")}.json`);

    logLine(logPath, `Collecting ${relativePath}`);

    job.progress = {
      total: files.length,
      completed: success + failed,
      success,
      failed,
      currentNote: relativePath
    };
    job.updatedAt = new Date().toISOString();
    writeJob(jobPath, job);

    const result = await runTruthCollector(
      [
        "--vault-root",
        vaultRoot,
        "--file",
        filePath,
        "--output",
        partialPath,
        "--json",
        job.infer === false ? "--no-infer" : "--infer"
      ],
      logPath,
      paths,
      job.id
    );

    if (result.canceled) {
      throw new JobCanceledError();
    }

    let partial = null;
    try {
      partial = JSON.parse(result.stdout);
    } catch {
      // Leave partial as null; the failure record below captures the process output.
    }

    if (result.ok && partial) {
      success++;
      for (const entity of Array.isArray(partial.entities) ? partial.entities : []) {
        const key = `${entity.type}:${entity.name}`;

        if (!entities.has(key)) {
          entities.set(key, entity);
        }
      }

      claims.push(...(Array.isArray(partial.claims) ? partial.claims : []));
      inferredClaims.push(
        ...(Array.isArray(partial.inferredClaims) ? partial.inferredClaims : [])
      );
      warnings.push(...(Array.isArray(partial.warnings) ? partial.warnings : []));
    } else {
      failed++;
      failures.push({
        filePath,
        code: result.code,
        errors: Array.isArray(partial?.errors) ? partial.errors : undefined,
        stderr: result.stderr.trim() || undefined,
        stdout: partial ? undefined : result.stdout.trim() || undefined,
        error: result.error?.message
      });
      logLine(logPath, `Failed ${relativePath}`);
    }

    job.progress = {
      total: files.length,
      completed: success + failed,
      success,
      failed,
      currentNote: relativePath
    };
    job.updatedAt = new Date().toISOString();
    writeJob(jobPath, job);

    if (throttleMs > 0 && index < files.length - 1) {
      if (isCancelRequested(paths, job.id)) {
        throw new JobCanceledError();
      }

      await sleepWithCancel(throttleMs, paths, job.id);
    }
  }

  const errors = findDuplicateClaimErrors(claims);
  const index = {
    generatedAt: new Date().toISOString(),
    vaultRoot,
    outputPath,
    entityCount: entities.size,
    entities: [...entities.values()].sort((a, b) =>
      String(a.type ?? "").localeCompare(String(b.type ?? "")) ||
      String(a.name ?? "").localeCompare(String(b.name ?? ""))
    ),
    claimCount: claims.length,
    inferredClaimCount: inferredClaims.length,
    claims: claims.sort(sortClaims),
    inferredClaims: inferredClaims.sort(sortClaims),
    warnings: [...new Set(warnings)].sort(),
    errors
  };
  const status = failed === 0 && errors.length === 0 ? "succeeded" : "failed";

  if (status === "succeeded") {
    writeJsonAtomic(outputPath, index);
    logLine(logPath, `Wrote truth ledger index to ${outputPath}`);
  } else {
    logLine(logPath, `Truth ledger crawl finished without writing index.`);
  }

  logLine(logPath);
  logLine(
    logPath,
    `Truth ledger job complete. ${success} succeeded, ${failed} failed, ${errors.length} validation error(s).`
  );

  finishJob(jobPath, job, status, {
    progress: {
      total: files.length,
      completed: success + failed,
      success,
      failed
    },
    outputPath,
    claimCount: claims.length,
    inferredClaimCount: inferredClaims.length,
    warnings: index.warnings,
    errors,
    failures,
    logPath
  });
}

async function processChronologyIndexJob(jobPath, job, schedulerConfig, paths) {
  const logPath = path.join(paths.logsDir, `${job.id}.log`);
  const throttleMs = Math.max(0, Number(schedulerConfig.throttleMs) || 0);
  const fullConfig = loadConfig(toolRoot);
  const vaultRoot = job.vaultRoot
    ? path.resolve(job.vaultRoot)
    : path.resolve(toolRoot, "..");
  const configuredPaths = Array.isArray(job.paths) && job.paths.length > 0
    ? job.paths
    : defaultChronologyPaths(fullConfig);
  const scanRoots = configuredPaths.map(scanPath => resolvePath(vaultRoot, scanPath));
  const files = [...new Set(scanRoots.flatMap(walkMarkdownFiles))].sort();
  let indexed = 0;
  let skipped = 0;
  let failed = 0;
  const failures = [];
  const skippedFiles = [];

  logLine(logPath, `Starting chronology index job ${job.id}`);
  logLine(logPath, `Vault root: ${vaultRoot}`);
  logLine(logPath, `Found ${files.length} scene files.`);
  logLine(logPath, `Throttle: ${throttleMs}ms`);

  job.progress = {
    total: files.length,
    completed: 0,
    success: 0,
    failed
  };
  job.updatedAt = new Date().toISOString();
  writeJob(jobPath, job);

  for (const [index, filePath] of files.entries()) {
    if (isCancelRequested(paths, job.id)) {
      throw new JobCanceledError();
    }

    const relativePath = path.relative(vaultRoot, filePath);
    logLine(logPath, `Indexing ${relativePath}`);

    job.progress = {
      total: files.length,
      completed: indexed + skipped + failed,
      success: indexed + skipped,
      failed,
      currentScene: relativePath
    };
    job.updatedAt = new Date().toISOString();
    writeJob(jobPath, job);

    const result = await runChronologyIndexer(
      [
        filePath,
        "--vault-root",
        vaultRoot,
        "--json"
      ],
      logPath,
      paths,
      job.id
    );

    if (result.canceled) {
      throw new JobCanceledError();
    }

    let payload = null;
    try {
      payload = JSON.parse(result.stdout);
    } catch {
      // Leave payload as null; the failure record below captures process output.
    }

    if (result.ok && payload?.status === "indexed") {
      indexed++;
    } else if (result.ok && payload?.status === "missing") {
      skipped++;
      skippedFiles.push(filePath);
    } else {
      failed++;
      failures.push({
        filePath,
        code: result.code,
        status: payload?.status,
        error: payload?.error ?? result.error?.message,
        stderr: result.stderr.trim() || undefined,
        stdout: payload ? undefined : result.stdout.trim() || undefined
      });
      logLine(logPath, `Failed ${relativePath}`);
    }

    job.progress = {
      total: files.length,
      completed: indexed + skipped + failed,
      success: indexed + skipped,
      failed,
      currentScene: relativePath
    };
    job.updatedAt = new Date().toISOString();
    writeJob(jobPath, job);

    if (throttleMs > 0 && index < files.length - 1) {
      if (isCancelRequested(paths, job.id)) {
        throw new JobCanceledError();
      }

      await sleepWithCancel(throttleMs, paths, job.id);
    }
  }

  logLine(logPath);
  logLine(
    logPath,
    `Chronology index complete. ${indexed} indexed, ${skipped} skipped, ${failed} failed.`
  );

  finishJob(jobPath, job, failed === 0 ? "succeeded" : "failed", {
    progress: {
      total: files.length,
      completed: indexed + skipped + failed,
      success: indexed + skipped,
      failed
    },
    indexed,
    skipped,
    skippedFiles,
    failures,
    logPath
  });
}

async function processJob(claimed, schedulerConfig, paths) {
  const { job, jobPath } = claimed;

  try {
    if (job.type === "evaluate-scenes") {
      await processEvaluateScenesJob(jobPath, job, schedulerConfig, paths);
      return;
    }

    if (job.type === "truth-ledger") {
      await processTruthLedgerJob(jobPath, job, schedulerConfig, paths);
      return;
    }

    if (job.type === "chronology-index") {
      await processChronologyIndexJob(jobPath, job, schedulerConfig, paths);
      return;
    }

    throw new Error(`Unsupported job type: ${job.type}`);
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
    if (isWorkerStopRequested(paths)) {
      console.log("Scheduler stop requested; not claiming more jobs.");
      return processed;
    }

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
    try {
      scanBackgroundSceneChanges(schedulerConfig, paths);
    } catch (error) {
      console.error(`Background scene scan failed: ${error.message}`);
    }

    await processAvailableJobs({
      once: false,
      schedulerConfig,
      paths
    });

    if (isWorkerStopRequested(paths)) {
      console.log("Scheduler stop requested; exiting after current work.");
      clearWorkerStop(paths);
      return;
    }

    await sleep(pollIntervalMs);
  }
}

await main();
