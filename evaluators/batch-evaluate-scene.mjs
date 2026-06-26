import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const toolRoot = path.dirname(__filename);

const scenesFolder = process.argv[2];

if (!scenesFolder) {
  console.error("Usage: node batch-evaluate-scene.mjs <scenes-folder>");
  process.exit(1);
}

const evaluations = [
  ["Relevance", "Character"],
  ["Relevance", "Plot Thread"],
  ["Relevance", "Story Engine"],
  ["Relevance", "Arc"],

  ["Tension", "Character"],
  ["Tension", "Plot Thread"],
  ["Tension", "Story Engine"],
  ["Tension", "Arc"],

  ["Resolution", "Character"],
  ["Resolution", "Plot Thread"],
  ["Resolution", "Story Engine"],
  ["Resolution", "Arc"],

  ["Character Awareness", "Plot Thread"]
];

const evaluatorScript = path.join(
  toolRoot,
  "..",
  "scripts",
  "evaluate-scene.sh"
);

const markdownFiles = fs.readdirSync(scenesFolder, { withFileTypes: true })
  .filter(entry => entry.isFile())
  .filter(entry => entry.name.endsWith(".md"))
  .map(entry => path.join(scenesFolder, entry.name))
  .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));

console.log(`Checking directory: ${scenesFolder}`);
console.log(`Found ${markdownFiles.length} scene files.`);

let success = 0;
let failed = 0;

for (const filePath of markdownFiles) {
  console.log(`\nEvaluating scene: ${path.basename(filePath)}`);

  for (const [metric, target] of evaluations) {
    try {
      console.log(`  ${metric} / ${target}`);

      execFileSync(
        evaluatorScript,
        [
          filePath,
          metric,
          target
        ],
        {
          encoding: "utf8"
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
