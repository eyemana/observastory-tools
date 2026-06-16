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
Return JSON only.  When creating keys for kvp, always use values from frontmatter, if possible.
The rationale-related JSON elements are to be supplied by you as a sentence supporting the associated score value you gave.

Use this Relevance Rubric:
${relevanceDefinition}

Use these Plot thread definitions:
${threadDefinitions}

Scene:

${parsed.content}

Required JSON:
{
  "scene": number,
  "sceneRationale": string,
  "threads": {
    "threadName": {
      "score": number,
      "rationale": string
    }
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

if (typeof scores.sceneRationale !== "string") {
  throw new Error(`Invalid scene rationale: ${result.response}`);
}

if (!scores.threads || typeof scores.threads !== "object") {
  throw new Error(`Invalid relevance scores: ${result.response}`);
}

parsed.data.ai = parsed.data.ai ?? {};
parsed.data.ai.model = config.model;
parsed.data.ai.relevance = {
  scene: scores.scene,
  sceneRationale: scores.sceneRationale,
  threads: scores.threads,
  updated: new Date().toISOString()
};

const updated = matter.stringify(parsed.content, parsed.data);
fs.writeFileSync(filePath, updated, "utf8");
