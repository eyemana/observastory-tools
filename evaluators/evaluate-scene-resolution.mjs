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
  console.error("Usage: node evaluate-scene-resolution.mjs <file>");
  process.exit(1);
}

const raw = fs.readFileSync(filePath, "utf8");
const parsed = matter(raw);

const pocRoot = findAncestorFolder(filePath, "POC");
const resolutionDefinition = readDefinition(
  pocRoot,
  "Metrics",
  "Resolution"
);

const characterNames = parsed.data.characters ?? [];

const characterDefinitions = formatDefinitions(
  readDefinitions(
    pocRoot,
    "Characters",
    characterNames
  )
);

const threadNames = parsed.data.threads ?? [];

const threadDefinitions = formatDefinitions(
  readDefinitions(
    pocRoot,
    "Plot Threads",
    threadNames
  )
);

const engineNames = parsed.data.engines ?? [];

const engineDefinitions = formatDefinitions(
  readDefinitions(
    pocRoot,
    "Story Engines",
    engineNames
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
Return JSON only.  When creating keys for kvp, always use values from frontmatter, if possible.
The rationale-related JSON elements are to be supplied by you as a sentence supporting the associated score value you gave.

Use this Resolution Rubric:
${resolutionDefinition}

Use these Plot thread definitions:
${threadDefinitions}

Use these character definitions
${characterDefinitions}

Use these Story Engine definitions:
${engineDefinitions}

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
  "threads": {
    "threadName": {
      "score": number,
      "rationale": string
    }
  },
  "engines": {
    "engineName": {
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
  throw new Error(`Invalid scene score: ${result.response}`);
}

if (typeof scores.sceneRationale !== "string") {
  throw new Error(`Invalid scene rationale: ${result.response}`);
}

if (!scores.characters || typeof scores.characters !== "object") {
  throw new Error(`Invalid character scores: ${result.response}`);
}

if (!scores.threads || typeof scores.threads !== "object") {
  throw new Error(`Invalid thread resolution scores: ${result.response}`);
}

if (!scores.engines || typeof scores.engines !== "object") {
  throw new Error(`Invalid engine resolution scores: ${result.response}`);
}

if (!scores.arcs || typeof scores.arcs !== "object") {
  throw new Error(`Invalid arc resolution scores: ${result.response}`);
}

parsed.data.ai = parsed.data.ai ?? {};
parsed.data.ai.model = config.model;
parsed.data.ai.relevance = {
  scene: scores.scene,
  sceneRationale: scores.sceneRationale,
  characters: normalizedCharacters,
  threads: scores.threads,
  engines: scores.engines,
  arcs: scores.arcs,
  updated: new Date().toISOString()
};

const updated = matter.stringify(parsed.content, parsed.data);
fs.writeFileSync(filePath, updated, "utf8");
