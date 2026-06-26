import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

import { loadConfig } from "../tool-config.mjs";

const __filename = fileURLToPath(import.meta.url);
const evaluatorRoot = path.dirname(__filename);
const toolRoot = path.join(evaluatorRoot, "..");
const config = loadConfig(toolRoot);

const scenesFolder = process.argv[2];

if (!scenesFolder) {
  console.error("Usage: node batch-evaluate-scene.mjs <scenes-folder>");
  process.exit(1);
}

const evaluations = config.scheduler.evaluations;
const evaluatorScript = path.join(evaluatorRoot, "evaluate-scene.mjs");

const markdownFiles = fs.readdirSync(scenesFolder, { withFileTypes: true })
  .filter(entry => entry.isFile())
  .filter(entry => entry.name.endsWith(".md"))
  .map(entry => path.join(scenesFolder, entry.name))
  .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));

console.log(`Checking directory: ${scenesFolder}`);
console.log(`Found ${markdownFiles.length} scene files.`);

let success = 0;
let failed = 0;

for (const [metric, target] of evaluations) {
  console.log(`\n=== ${metric} / ${target} ===`);

  for (const filePath of markdownFiles) {
    console.log(`\nEvaluating scene: ${path.basename(filePath)}`);
    try {

      execFileSync(
        process.execPath,
        [
          evaluatorScript,
          filePath,
          metric,
          target
        ],
        {
          encoding: "utf8",
          cwd: toolRoot
        }
      );

      success++;
    } catch (error) {
      failed++;

      console.error(`Failed: ${filePath} / ${metric} / ${target}`);
      console.error(error.stdout?.toString() || "");
      console.error(error.stderr?.toString() || error.message);
    }
  }
}

console.log(`\nBatch complete. ${success} succeeded, ${failed} failed.`);
