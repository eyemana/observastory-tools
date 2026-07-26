import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig, parseConfigText } from "../tool-config.mjs";

const toolsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ignored = new Set(["node_modules", ".git", ".index", ".queue"]);

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (ignored.has(entry.name)) return [];
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(entryPath) : [entryPath];
  });
}

const scripts = walk(toolsRoot)
  .filter(filePath => /\.(?:mjs|cjs|js)$/.test(filePath));

for (const filePath of scripts) {
  const result = spawnSync(process.execPath, ["--check", filePath], { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
}

for (const name of ["config.example.json", "config.local.json"]) {
  parseConfigText(fs.readFileSync(path.join(toolsRoot, name), "utf8"));
}

const config = loadConfig(toolsRoot);
const vaultRoot = path.resolve(toolsRoot, "..");
const studioRoot = path.resolve(vaultRoot, config.studio?.root ?? "Observastory Studio");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
let studioBlocks = 0;

if (fs.existsSync(studioRoot)) {
  for (const filePath of walk(studioRoot).filter(candidate => candidate.endsWith(".md"))) {
    const markdown = fs.readFileSync(filePath, "utf8");
    const blocks = markdown.matchAll(/```dataviewjs\s*\n([\s\S]*?)```/g);
    for (const match of blocks) {
      try {
        new AsyncFunction("dv", "app", "require", "Notice", "window", match[1]);
      } catch (error) {
        throw new Error(`Invalid DataviewJS in ${filePath}: ${error.message}`);
      }
      studioBlocks++;
    }
  }
}

console.log(`Verified ${scripts.length} JavaScript files, 2 configuration files, and ${studioBlocks} DataviewJS Studio blocks.`);
