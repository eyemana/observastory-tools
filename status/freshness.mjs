import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import matter from "gray-matter";

import { parseChronologyValue } from "../chronology/chronology-utils.mjs";
import {
  defaultChronologyPaths,
  defaultScenesPath,
  defaultTruthLedgerPaths,
  getSchedulerConfig,
  getStoryConfig,
  loadConfig
} from "../tool-config.mjs";
import {
  getEvaluationProfile,
  listEligibleMarkdownFiles
} from "../evaluation-filters.mjs";
import {
  authorMarkdownFingerprint,
  chronologyInputHash
} from "../fingerprints.mjs";
import { toCamelCase } from "../vault-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const statusRoot = path.dirname(__filename);
const defaultToolRoot = path.resolve(statusRoot, "..");

function readOption(name) {
  const index = process.argv.indexOf(name);

  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function resolveFromRoot(root, configuredPath) {
  if (!configuredPath) {
    return null;
  }

  return path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(root, configuredPath);
}

function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(3).toString("hex")}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function readMarkdown(filePath) {
  return matter(fs.readFileSync(filePath, "utf8"));
}

function walkMarkdownFiles(root) {
  if (!root || !fs.existsSync(root)) {
    return [];
  }

  if (fs.statSync(root).isFile()) {
    return root.endsWith(".md") ? [root] : [];
  }

  const files = [];

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
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

  return files.sort((a, b) => a.localeCompare(b));
}

function configuredPathFromToolRoot(toolRoot, configuredPath) {
  return path.isAbsolute(configuredPath)
    ? configuredPath
    : path.join(toolRoot, configuredPath);
}

function backgroundFingerprintPath(toolRoot, schedulerConfig) {
  const configured = schedulerConfig.backgroundSceneScan?.fingerprintPath ??
    ".queue/background-scene-fingerprints.json";
  return configuredPathFromToolRoot(toolRoot, configured);
}

function truthLedgerIndexPath(toolRoot, config) {
  return configuredPathFromToolRoot(
    toolRoot,
    config.truthLedger?.outputPath ?? ".index/truth-ledger.json"
  );
}

function processingStatusPath(toolRoot) {
  return path.join(toolRoot, ".index", "processing-status.json");
}

function normalizeEvaluations(evaluations) {
  if (!Array.isArray(evaluations)) {
    return [];
  }

  return evaluations
    .filter((entry) =>
      Array.isArray(entry) &&
      entry.length === 2 &&
      typeof entry[0] === "string" &&
      typeof entry[1] === "string"
    )
    .map(([metric, target]) => [metric, target]);
}

function normalizeConceptName(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function conceptLookupKey(value) {
  return normalizeConceptName(value).replace(/[\s_-]/g, "");
}

function targetKeyFor(config, targetName) {
  if (conceptLookupKey(targetName) === "scene") {
    return "scene";
  }

  const story = getStoryConfig(config);
  const normalized = conceptLookupKey(targetName);
  const match = Object.entries(story.entityTypes ?? {})
    .find(([key, entityType]) => [
      key,
      entityType?.target,
      entityType?.label,
      entityType?.pluralLabel
    ].some(value => conceptLookupKey(value) === normalized));

  return match?.[0] ?? toCamelCase(targetName);
}

function hasExistingEvaluation(parsed, filePath, metricKey, targetKey) {
  const observations = parsed.data.ai?.observations;

  if (!observations || typeof observations !== "object") {
    return false;
  }

  if (targetKey === "scene") {
    const sceneName = path.basename(filePath, ".md");
    return Boolean(observations.scene?.[sceneName]?.[metricKey]);
  }

  if (metricKey === "readerAwareness") {
    return Object.values(observations[targetKey] ?? {})
      .some(entry => Boolean(entry?.awareness?.reader));
  }

  if (metricKey === "characterAwareness") {
    return Object.values(observations[targetKey] ?? {})
      .some(entry => Object.keys(entry?.awareness?.characters ?? {}).length > 0);
  }

  return Object.values(observations[targetKey] ?? {})
    .some(entry => Boolean(entry?.[metricKey]));
}

function awarenessUsesTruthLedger(metricKey) {
  return metricKey === "readerAwareness" || metricKey === "characterAwareness";
}

function compareIso(left, right) {
  const leftMs = Date.parse(left ?? "");
  const rightMs = Date.parse(right ?? "");

  if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) {
    return 0;
  }

  return leftMs - rightMs;
}

function emptyCounts(keys) {
  return keys.reduce((result, key) => {
    result[key] = 0;
    return result;
  }, {});
}

function increment(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1;
}

function sceneFingerprintStatus(filePath, fingerprint, state) {
  const resolved = path.resolve(filePath);
  const known = state?.files?.[resolved];
  const pending = state?.pending?.[resolved];

  if (!state) {
    return {
      status: "never-baselined",
      reason: "No background scene fingerprint baseline exists."
    };
  }

  if (pending?.fingerprint === fingerprint) {
    return {
      status: "pending-debounce",
      firstSeenAt: pending.firstSeenAt,
      reason: "Scene input changed and is waiting for debounce before background queueing."
    };
  }

  if (!known) {
    return {
      status: "new",
      reason: "Scene is not present in the background fingerprint baseline."
    };
  }

  if (known.fingerprint !== fingerprint) {
    return {
      status: "changed",
      updatedAt: known.updatedAt,
      reason: "Author-owned scene input differs from the background fingerprint baseline."
    };
  }

  return {
    status: "fresh",
    updatedAt: known.updatedAt,
    reason: "Author-owned scene input matches the background fingerprint baseline."
  };
}

function evaluationAxisStatus({
  parsed,
  filePath,
  metric,
  target,
  metricKey,
  targetKey,
  sceneStatus,
  truthLedgerGeneratedAt
}) {
  const metadata = parsed.data.ai?.evaluationInputs?.[metricKey]?.[targetKey];
  const hasObservation = hasExistingEvaluation(parsed, filePath, metricKey, targetKey);
  const base = {
    metric,
    target,
    metricKey,
    targetKey,
    updated: metadata?.updated ?? null
  };

  if (!metadata || !hasObservation) {
    return {
      ...base,
      status: "never-run",
      reason: "No completed evaluator output is recorded for this axis."
    };
  }

  if (metadata.version !== 1 || !metadata.inputHash) {
    return {
      ...base,
      status: "legacy",
      reason: "Evaluator metadata predates input hashes or uses an unknown cache version."
    };
  }

  if (sceneStatus.status === "pending-debounce") {
    return {
      ...base,
      status: "pending",
      reason: "Scene input changed and background mode is waiting for debounce."
    };
  }

  if (sceneStatus.status === "never-baselined") {
    return {
      ...base,
      status: "unknown",
      reason: "No background scene fingerprint baseline exists yet."
    };
  }

  if (["changed", "new"].includes(sceneStatus.status)) {
    return {
      ...base,
      status: "stale",
      reason: "Author-owned scene input changed since the last background baseline."
    };
  }

  if (
    awarenessUsesTruthLedger(metricKey) &&
    truthLedgerGeneratedAt &&
    metadata.updated &&
    compareIso(metadata.updated, truthLedgerGeneratedAt) < 0
  ) {
    return {
      ...base,
      status: "stale",
      reason: "Truth Ledger support was regenerated after this awareness evaluation."
    };
  }

  return {
    ...base,
    status: "fresh",
    reason: "Evaluator output has current cache metadata and no newer dependency was detected."
  };
}

function buildSceneFreshness({ toolRoot, vaultRoot, config, schedulerConfig, truthLedgerGeneratedAt }) {
  const evaluationProfileName = config.evaluation?.defaultProfile ?? "default";
  const profile = getEvaluationProfile(config, evaluationProfileName);
  const scenesFolder = path.resolve(vaultRoot, defaultScenesPath(config));
  const sceneFiles = listEligibleMarkdownFiles(scenesFolder, profile.sceneFilters);
  const fingerprintFile = backgroundFingerprintPath(toolRoot, schedulerConfig);
  const fingerprintState = readJsonFile(fingerprintFile, null);
  const evaluations = normalizeEvaluations(schedulerConfig.evaluations);
  const fingerprintCounts = emptyCounts([
    "fresh",
    "changed",
    "pending-debounce",
    "new",
    "never-baselined"
  ]);
  const axisCounts = emptyCounts([
    "fresh",
    "stale",
    "pending",
    "unknown",
    "never-run",
    "legacy"
  ]);
  const items = sceneFiles.map((filePath) => {
    const relativePath = path.relative(vaultRoot, filePath);
    const parsed = readMarkdown(filePath);
    const fingerprint = authorMarkdownFingerprint(filePath);
    const sceneStatus = sceneFingerprintStatus(filePath, fingerprint, fingerprintState);
    increment(fingerprintCounts, sceneStatus.status);

    const axes = evaluations.map(([metric, target]) => {
      const metricKey = toCamelCase(metric);
      const targetKey = targetKeyFor(config, target);
      const axis = evaluationAxisStatus({
        parsed,
        filePath,
        metric,
        target,
        metricKey,
        targetKey,
        sceneStatus,
        truthLedgerGeneratedAt
      });
      increment(axisCounts, axis.status);
      return axis;
    });

    return {
      name: path.basename(filePath, ".md"),
      path: relativePath,
      absolutePath: path.resolve(filePath),
      fingerprintStatus: sceneStatus.status,
      fingerprintReason: sceneStatus.reason,
      fingerprintUpdatedAt: sceneStatus.updatedAt ?? null,
      pendingSince: sceneStatus.firstSeenAt ?? null,
      axisCounts: axes.reduce((counts, axis) => {
        increment(counts, axis.status);
        return counts;
      }, emptyCounts(["fresh", "stale", "pending", "unknown", "never-run", "legacy"])),
      axes
    };
  });

  return {
    total: sceneFiles.length,
    scenesFolder,
    evaluationProfile: profile.name,
    fingerprintPath: fingerprintFile,
    fingerprintBaselineAt: fingerprintState?.baselinedAt ?? null,
    fingerprintUpdatedAt: fingerprintState?.updatedAt ?? null,
    fingerprintCounts,
    axisCounts,
    staleSceneFiles: items
      .filter(item =>
        ["changed", "new"].includes(item.fingerprintStatus) ||
        item.axes.some(axis => ["stale", "never-run", "legacy"].includes(axis.status))
      )
      .map(item => item.absolutePath),
    pendingSceneFiles: items
      .filter(item => item.fingerprintStatus === "pending-debounce" ||
        item.axes.some(axis => axis.status === "pending"))
      .map(item => item.absolutePath),
    items
  };
}

function sourceFingerprintsFromIndex(index) {
  const entries = Array.isArray(index?.sourceFingerprints)
    ? index.sourceFingerprints
    : [];
  const byPath = new Map();

  for (const entry of entries) {
    if (entry?.path) {
      byPath.set(entry.path, entry);
    }
  }

  return byPath;
}

function buildTruthLedgerFreshness({ toolRoot, vaultRoot, config }) {
  const outputPath = truthLedgerIndexPath(toolRoot, config);
  const index = readJsonFile(outputPath, null);
  const scanRoots = defaultTruthLedgerPaths(config)
    .map(scanPath => resolveFromRoot(vaultRoot, scanPath));
  const files = [...new Set(scanRoots.flatMap(walkMarkdownFiles))].sort();
  const sourceFingerprints = sourceFingerprintsFromIndex(index);
  const counts = emptyCounts(["fresh", "stale", "never-run", "legacy", "deleted"]);
  const items = [];

  for (const filePath of files) {
    const relativePath = path.relative(vaultRoot, filePath);
    const fingerprint = authorMarkdownFingerprint(filePath);
    const recorded = sourceFingerprints.get(relativePath);
    let status = "fresh";
    let reason = "Source note fingerprint matches the Truth Ledger index.";

    if (!index) {
      status = "never-run";
      reason = "Truth Ledger index has not been generated.";
    } else if (!Array.isArray(index.sourceFingerprints)) {
      status = "legacy";
      reason = "Truth Ledger index predates source fingerprints.";
    } else if (!recorded) {
      status = "stale";
      reason = "Source note is not represented in the current Truth Ledger index.";
    } else if (recorded.fingerprint !== fingerprint) {
      status = "stale";
      reason = "Source note input changed since the Truth Ledger index was generated.";
    }

    increment(counts, status);
    items.push({
      path: relativePath,
      absolutePath: path.resolve(filePath),
      status,
      reason,
      updatedAt: recorded?.updatedAt ?? null
    });
  }

  const currentPaths = new Set(items.map(item => item.path));
  for (const recorded of sourceFingerprints.values()) {
    if (!currentPaths.has(recorded.path)) {
      increment(counts, "deleted");
      items.push({
        path: recorded.path,
        absolutePath: null,
        status: "deleted",
        reason: "Source note was present in the Truth Ledger index but is no longer in configured scan paths.",
        updatedAt: recorded.updatedAt ?? null
      });
    }
  }

  return {
    outputPath,
    generatedAt: index?.generatedAt ?? null,
    total: items.length,
    counts,
    needsUpdate: items.some(item => ["stale", "never-run", "legacy", "deleted"].includes(item.status)),
    scanRoots,
    items
  };
}

function buildChronologyFreshness({ vaultRoot, config }) {
  const scanRoots = defaultChronologyPaths(config)
    .map(scanPath => resolveFromRoot(vaultRoot, scanPath));
  const files = [...new Set(scanRoots.flatMap(walkMarkdownFiles))].sort();
  const counts = emptyCounts([
    "fresh",
    "stale",
    "never-run",
    "legacy",
    "not-applicable",
    "invalid"
  ]);
  const items = files.map((filePath) => {
    const parsed = readMarkdown(filePath);
    const chronology = parsed.data.ai?.chronology;
    const rawValue = parsed.data.chronology_value ?? "";
    const parsedValue = parseChronologyValue(rawValue);
    const currentHash = chronologyInputHash(parsed.data);
    let status = "fresh";
    let reason = "Chronology metadata input hash matches author-owned chronology fields.";

    if (parsedValue.status === "missing") {
      if (chronology) {
        status = "stale";
        reason = "chronology_value was removed; generated chronology metadata should be cleared.";
      } else {
        status = "not-applicable";
        reason = "chronology_value is not set.";
      }
    } else if (!parsedValue.ok) {
      status = "invalid";
      reason = parsedValue.error ?? "chronology_value could not be parsed.";
    } else if (!chronology) {
      status = "never-run";
      reason = "No generated chronology metadata is recorded.";
    } else if (!chronology.inputHash) {
      status = "legacy";
      reason = "Generated chronology metadata predates input hashes.";
    } else if (chronology.inputHash !== currentHash) {
      status = "stale";
      reason = "Author-owned chronology fields changed since chronology metadata was generated.";
    }

    increment(counts, status);

    return {
      path: path.relative(vaultRoot, filePath),
      absolutePath: path.resolve(filePath),
      status,
      reason,
      generatedAt: chronology?.generatedAt ?? null,
      label: String(parsed.data.chronology_label ?? "").trim(),
      value: String(rawValue ?? "").trim()
    };
  });

  return {
    total: items.length,
    counts,
    needsUpdate: items.some(item => ["stale", "never-run", "legacy", "invalid"].includes(item.status)),
    scanRoots,
    items
  };
}

export function buildFreshnessReport(toolRoot = defaultToolRoot, options = {}) {
  const resolvedToolRoot = path.resolve(toolRoot);
  const config = loadConfig(resolvedToolRoot);
  const schedulerConfig = getSchedulerConfig(resolvedToolRoot);
  const vaultRoot = options.vaultRoot
    ? path.resolve(options.vaultRoot)
    : path.resolve(resolvedToolRoot, "..");
  const truthLedger = buildTruthLedgerFreshness({
    toolRoot: resolvedToolRoot,
    vaultRoot,
    config
  });
  const scenes = buildSceneFreshness({
    toolRoot: resolvedToolRoot,
    vaultRoot,
    config,
    schedulerConfig,
    truthLedgerGeneratedAt: truthLedger.generatedAt
  });
  const chronology = buildChronologyFreshness({
    vaultRoot,
    config
  });

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    vaultRoot,
    toolRoot: resolvedToolRoot,
    outputPath: processingStatusPath(resolvedToolRoot),
    scenes,
    truthLedger,
    chronology,
    recommendations: {
      staleSceneFiles: scenes.staleSceneFiles,
      pendingSceneFiles: scenes.pendingSceneFiles,
      queueSceneEvaluation: scenes.staleSceneFiles.length > 0,
      queueTruthLedger: truthLedger.needsUpdate,
      queueChronologyIndex: chronology.needsUpdate
    }
  };
}

export function writeFreshnessReport(toolRoot = defaultToolRoot, options = {}) {
  const report = buildFreshnessReport(toolRoot, options);
  const outputPath = options.outputPath
    ? resolveFromRoot(process.cwd(), options.outputPath)
    : processingStatusPath(path.resolve(toolRoot));

  writeJsonAtomic(outputPath, report);
  return {
    ...report,
    outputPath
  };
}

function formatSummary(report) {
  const sceneAxes = report.scenes.axisCounts;
  const truth = report.truthLedger.counts;
  const chronology = report.chronology.counts;

  return [
    `Processing status generated at ${report.generatedAt}`,
    `Scene evaluator axes: ${sceneAxes.fresh} fresh, ${sceneAxes.stale} stale, ${sceneAxes.pending} pending, ${sceneAxes.unknown} unknown, ${sceneAxes["never-run"]} never run, ${sceneAxes.legacy} legacy.`,
    `Truth Ledger sources: ${truth.fresh} fresh, ${truth.stale} stale, ${truth["never-run"]} never run, ${truth.legacy} legacy, ${truth.deleted} deleted.`,
    `Chronology sources: ${chronology.fresh} fresh, ${chronology.stale} stale, ${chronology["never-run"]} never run, ${chronology.legacy} legacy, ${chronology.invalid} invalid.`
  ].join("\n");
}

async function main() {
  const toolRoot = path.resolve(readOption("--tool-root") ?? defaultToolRoot);
  const vaultRoot = readOption("--vault-root");
  const outputPath = readOption("--output");
  const write = hasFlag("--write");
  const report = write
    ? writeFreshnessReport(toolRoot, { vaultRoot, outputPath })
    : buildFreshnessReport(toolRoot, { vaultRoot });

  if (hasFlag("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatSummary(report));
    if (write) {
      console.log(`Output: ${report.outputPath}`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
