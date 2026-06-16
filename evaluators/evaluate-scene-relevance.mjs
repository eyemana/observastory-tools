import fs from "fs";
import path from "path";
import matter from "gray-matter";

import { fileURLToPath } from "url";

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

const prompt = `
Return JSON only.

Evaluate narrative plot thread relevance on a scale from 1 to 10.

Score:
Evaluate each plot thread listed in frontmatter.

Score 1 - 10:

Scene relevance:
1 = removable; no meaningful story movement
3 = minor support, setup, atmosphere, or reminder
5 = meaningful development of at least one active thread
7 = strong advancement, complication, or new information
9 = major turn, reveal, reversal, or point of no return
10 = structural/pivotal scene; story cannot remain the same after it

Thread Relevance:
1 = thread barely present
5 = thread meaningfully advanced
10 = major revelation, reversal, crisis, or resolution

Only score plot threads listed in frontmatter.

Frontmatter plot threads:
${JSON.stringify(parsed.data.threads ?? [], null, 2)}

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
