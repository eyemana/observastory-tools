import fs from "fs";
import path from "path";
import matter from "gray-matter";

import { fileURLToPath } from "url";
import {
  findAncestorFolder,
  readDefinition,
  readDefinitions,
  formatDefinitions
} from "../vault-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const toolRoot = path.dirname(__filename);
const configPath = path.join(toolRoot, "..", "config.local.json");

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

const filePath = process.argv[2];

if (!filePath) {
  console.error("Usage: node evaluate-scene-relevance.mjs <file>");
  process.exit(1);
}

const raw = fs.readFileSync(filePath, "utf8");
const parsed = matter(raw);

const pocRoot = findAncestorFolder(filePath, "POC");
const relevanceDefinition = readDefinition(
  pocRoot,
  "Metrics",
  "Relevance"
);

const threadNames = parsed.data.threads ?? [];

const threadDefinitions = formatDefinitions(
  readDefinitions(
    pocRoot,
    "Plot Threads",
    threadNames
  )
);

const prompt = `
Return JSON only.

Use this Relevance Rubric:
${relevanceDefinition}

Use these Plot thread definitions:
${threadDefinitions}

Scene:

${parsed.content}

Required JSON:
{
  "scene": number,
  "threads": {
    "Thread Name": number
  }
}
`;

const response = await fetch(config.ollamaUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    model: config.model,
    format: "json",
    prompt,
    stream: false
  })
});

const result = await response.json();
const scores = JSON.parse(result.response);

if (typeof scores.scene !== "number") {
  throw new Error(`Invalid scene score: ${result.response}`);
}

if (!scores.threads || typeof scores.threads !== "object") {
  throw new Error(`Invalid relevance scores: ${result.response}`);
}

parsed.data.ai = parsed.data.ai ?? {};
parsed.data.ai.model = config.model;
parsed.data.ai.relevance = {
  scene: scores.scene,
  threads: scores.threads,
  updated: new Date().toISOString()
};

const updated = matter.stringify(parsed.content, parsed.data);
fs.writeFileSync(filePath, updated, "utf8");
