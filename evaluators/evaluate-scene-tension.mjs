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
  console.error("Usage: node evaluate-scene-tension.mjs <file>");
  process.exit(1);
}

const raw = fs.readFileSync(filePath, "utf8");
const parsed = matter(raw);

const pocRoot = findAncestorFolder(filePath, "POC");

const tensionDefinition = readDefinition(
  pocRoot,
  "Metrics",
  "Tension"
);

const characterNames = parsed.data.characterNames ?? [];

const characterDefinitions = formatDefinitions(
  readDefinitions(
    pocRoot,
    "characters",
    characterNames
  )
);
const prompt = `
Return JSON only.

Use these character definitions
${characterDefinitions}

Use this definition of Tension:
${tensionDefinition}

Scene:

${parsed.content}

Required JSON:
{
  "scene": number,
  "characters": {
    "CharacterName": number
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

if (!scores.characters || typeof scores.characters !== "object") {
  throw new Error(`Invalid character scores: ${result.response}`);
}

parsed.data.ai = parsed.data.ai ?? {};
parsed.data.ai.model = config.model;

parsed.data.ai.tension = {
  scene: scores.scene,
  characters: scores.characters,
  updated: new Date().toISOString()
};

const updated = matter.stringify(parsed.content, parsed.data);
fs.writeFileSync(filePath, updated, "utf8");
