import path from "path";
import { fileURLToPath } from "url";

import {
  buildFreshnessReport,
  writeFreshnessReport
} from "../status/freshness.mjs";
import { defaultScenesPath, getSchedulerConfig, loadConfig } from "../tool-config.mjs";
import {
  enqueueChronologyIndexJob,
  enqueueEvaluateScenesJob,
  enqueueTruthLedgerJob
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

function hasFlag(name) {
  return process.argv.includes(name);
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map(value => path.resolve(value)))];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const vaultRoot = readOption("--vault-root")
    ? path.resolve(readOption("--vault-root"))
    : path.resolve(toolRoot, "..");
  const source = readOption("--source") ?? "manual-stale-work";
  const includePending = hasFlag("--include-pending");
  const dryRun = hasFlag("--dry-run");
  const skipSceneEvaluation = hasFlag("--no-scene-evaluation");
  const skipTruthLedger = hasFlag("--no-truth-ledger");
  const skipChronology = hasFlag("--no-chronology");
  const config = loadConfig(toolRoot);
  const scheduler = getSchedulerConfig(toolRoot);
  const report = dryRun
    ? buildFreshnessReport(toolRoot, { vaultRoot })
    : writeFreshnessReport(toolRoot, { vaultRoot });
  const jobs = [];

  if (!skipTruthLedger && report.recommendations.queueTruthLedger) {
    if (dryRun) {
      jobs.push({
        type: "truth-ledger",
        planned: true
      });
      await sleep(5);
    } else {
      const result = enqueueTruthLedgerJob({
        toolRoot,
        vaultRoot,
        source,
        label: "Stale Truth Ledger Crawl"
      });
      jobs.push({
        type: "truth-ledger",
        jobId: result.id,
        jobPath: result.jobPath,
        logPath: result.logPath
      });
      await sleep(5);
    }
  }

  if (!skipChronology && report.recommendations.queueChronologyIndex) {
    if (dryRun) {
      jobs.push({
        type: "chronology-index",
        planned: true
      });
      await sleep(5);
    } else {
      const result = enqueueChronologyIndexJob({
        toolRoot,
        vaultRoot,
        source,
        label: "Stale Chronology Index"
      });
      jobs.push({
        type: "chronology-index",
        jobId: result.id,
        jobPath: result.jobPath,
        logPath: result.logPath
      });
      await sleep(5);
    }
  }

  if (!skipSceneEvaluation) {
    const sceneFiles = unique([
      ...report.recommendations.staleSceneFiles,
      ...(includePending ? report.recommendations.pendingSceneFiles : [])
    ]);

    if (sceneFiles.length > 0) {
      if (dryRun) {
        jobs.push({
          type: "evaluate-scenes",
          planned: true,
          sceneCount: sceneFiles.length
        });
      } else {
        const scenesFolder = path.resolve(vaultRoot, defaultScenesPath(config));
        const result = enqueueEvaluateScenesJob({
          toolRoot,
          scenesFolder,
          sceneFiles,
          vaultRoot,
          source,
          evaluationProfile: report.scenes.evaluationProfile,
          sceneFilters: {},
          force: false,
          label: `Stale Scene Evaluation (${sceneFiles.length})`,
          evaluations: scheduler.evaluations
        });
        jobs.push({
          type: "evaluate-scenes",
          jobId: result.id,
          jobPath: result.jobPath,
          logPath: result.logPath,
          sceneCount: sceneFiles.length
        });
      }
    }
  }

  console.log(JSON.stringify({
    dryRun,
    jobs,
    jobCount: jobs.length,
    processingStatusPath: report.outputPath,
    sceneCount: report.scenes.total,
    staleSceneCount: report.scenes.staleSceneFiles.length,
    pendingSceneCount: report.scenes.pendingSceneFiles.length,
    sceneAxisCounts: report.scenes.axisCounts,
    truthLedgerNeedsUpdate: report.truthLedger.needsUpdate,
    chronologyNeedsUpdate: report.chronology.needsUpdate
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
