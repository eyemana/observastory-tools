import fs from "fs";
import path from "path";
import matter from "gray-matter";

import { fileURLToPath } from "url";
import {
  findAncestorFolder,
  readDefinition,
  readDefinitions,
  formatDefinitions,
  toCamelCase
} from "../vault-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const toolRoot = path.dirname(__filename);
const configPath = path.join(toolRoot, "..", "config.local.json");

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

const filePath = process.argv[2];
const metricName = process.argv[3];

if (!filePath || !metricName) {
  console.error("Usage: node evaluate-scene-metric.mjs <file> <metricName>");
  process.exit(1);
}
const metricKey = toCamelCase(metricName);

const raw = fs.readFileSync(filePath, "utf8");
const parsed = matter(raw);

const pocRoot = findAncestorFolder(filePath, "POC");

const metricDefinition = readDefinition(
  pocRoot,
  "Metrics",
  metricName
);

const characterNames = parsed.data.characters ?? [];

const characterDefinitions = formatDefinitions(
  readDefinitions(
    pocRoot,
    "Characters",
    characterNames
  )
);

const plotThreadNames = parsed.data.plotThreads ?? [];

const plotThreadDefinitions = formatDefinitions(
  readDefinitions(
    pocRoot,
    "Plot Threads",
    plotThreadNames
  )
);

const storyEngineNames = parsed.data.storyEngines ?? [];

const storyEngineDefinitions = formatDefinitions(
  readDefinitions(
    pocRoot,
    "Story Engines",
    storyEngineNames
  )
);

const arcNames = parsed.data.arcs ?? [];

const arcDefinitions = formatDefinitions(
  readDefinitions(
    pocRoot,
    "Arcs",
    arcNames
  )
);

const prompt = `
Return JSON only.
Characters to score:
${JSON.stringify(parsed.data.characters ?? [], null, 2)}

Use EXACTLY these character names as JSON keys.
Do not shorten names.
Do not use first names.
Do not add characters not listed here.

The rationale-related JSON elements are to be supplied by you as a single entence supporting the associated score value you gave.

Use these character definitions
${characterDefinitions}

Use this definition of ${metricName}:
${metricDefinition}

Use these Plot thread definitions:
${plotThreadDefinitions}

Use these Story Engine definitions:
${storyEngineDefinitions}

Use these Arc definitions:
${arcDefinitions}

Scene:

${parsed.content}

Required JSON:
{
  "scene": number,
  "sceneRationale": string,
  "characters": {
    "characterName": {
      "score": number,
      "rationale": string
    }
  },
  "plotThreads": {
    "plotThreadName": {
      "score": number,
      "rationale": string
    }
  },
  "storyEngines": {
    "storyEngineName": {
      "score": number,
      "rationale": string
    }
  },
  "arcs": {
    "arcName": {
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

const normalizedCharacters = {};

for (const characterName of characterNames) {
  const rawValue = scores.characters?.[characterName];

  let score;
  let rationale = "";

  if (typeof rawValue === "number") {
    score = rawValue;
  } else if (
    rawValue &&
    typeof rawValue === "object" &&
    typeof rawValue.score === "number"
  ) {
    score = rawValue.score;
    rationale = typeof rawValue.rationale === "string"
      ? rawValue.rationale
      : "";
  } else {
    throw new Error(
      `Missing or invalid score for character "${characterName}": ${result.response}`
    );
  }

  normalizedCharacters[characterName] = {
    score,
    rationale
  };
}

if (typeof scores.scene !== "number") {
  throw new Error(`Invalid scene ${metricKey} score: ${result.response}`);
}

if (typeof scores.sceneRationale !== "string") {
  throw new Error(`Invalid scene ${metricKey} rationale: ${result.response}`);
}

if (!scores.characters || typeof scores.characters !== "object") {
  throw new Error(`Invalid character ${metricKey} scores: ${result.response}`);
}

if (!scores.plotThreads || typeof scores.plotThreads !== "object") {
  throw new Error(`Invalid plotThreads ${metricKey} scores: ${result.response}`);
}

if (!scores.storyEngines || typeof scores.storyEngines !== "object") {
  throw new Error(`Invalid storyEngine ${metricKey} scores: ${result.response}`);
}

if (!scores.arcs || typeof scores.arcs !== "object") {
  throw new Error(`Invalid arc ${metricKey} scores: ${result.response}`);
}
parsed.data.ai = parsed.data.ai ?? {};
parsed.data.ai.model = config.model;

parsed.data.ai[metricKey] = {
  scene: scores.scene,
  sceneRationale: scores.sceneRationale,
  characters: normalizedCharacters,
  plotThreads: scores.plotThreads,
  storyEngines: scores.storyEngines,
  arcs: scores.arcs,
  updated: new Date().toISOString()
};

const updated = matter.stringify(parsed.content, parsed.data);
fs.writeFileSync(filePath, updated, "utf8");
