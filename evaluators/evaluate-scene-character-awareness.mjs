import fs from "fs";
import path from "path";
import matter from "gray-matter";

import { fileURLToPath } from "url";
import {
  findAncestorFolder,
  readDefinitions,
  formatDefinitions
} from "../vault-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const toolRoot = path.dirname(__filename);
const configPath = path.join(toolRoot, "..", "config.local.json");

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

const filePath = process.argv[2];

if (!filePath) {
  console.error("Usage: node evaluate-scene-character-awareness.mjs <file>");
  process.exit(1);
}

function normalizeAwarenessMap(scores, plotThreadNames, characterNames, rawResponse) {
  const normalized = {};

  const source =
    scores && typeof scores === "object"
      ? scores
      : {};

  for (const plotThreadName of plotThreadNames) {
    const rawPlotThread = source[plotThreadName];

    const normalizedCharacters = {};

    for (const characterName of characterNames) {
      const rawCharacter =
        rawPlotThread &&
        typeof rawPlotThread === "object"
          ? rawPlotThread[characterName]
          : undefined;

      let delta = 0;
      let rationale =
        "No new character awareness was returned for this plot thread in this scene.";

      if (typeof rawCharacter === "number") {
        delta = rawCharacter;
        rationale = "";
      } else if (
        rawCharacter &&
        typeof rawCharacter === "object" &&
        typeof rawCharacter.delta === "number"
      ) {
        delta = rawCharacter.delta;
        rationale =
          typeof rawCharacter.rationale === "string"
            ? rawCharacter.rationale
            : "";
      }

      normalizedCharacters[characterName] = {
        delta,
        rationale
      };
    }

    normalized[plotThreadName] = normalizedCharacters;
  }

  return normalized;
}

const raw = fs.readFileSync(filePath, "utf8");
const parsed = matter(raw);

const pocRoot = findAncestorFolder(filePath, "POC");

const characterNames = parsed.data.characters ?? [];
const plotThreadNames = parsed.data.plotThreads ?? [];

const characterDefinitions = formatDefinitions(
  readDefinitions(
    pocRoot,
    "Characters",
    characterNames
  )
);

const plotThreadDefinitions = formatDefinitions(
  readDefinitions(
    pocRoot,
    "Plot Threads",
    plotThreadNames
  )
);

const prompt = `
Return JSON only.

Evaluate character awareness of plot threads for this scene.

Characters:
${JSON.stringify(characterNames, null, 2)}

Plot Threads:
${JSON.stringify(plotThreadNames, null, 2)}

Use EXACTLY the listed plot thread names as JSON keys.
Use EXACTLY the listed character names as JSON keys.
Do not shorten names.
Do not use first names.
Do not add unlisted characters or plot threads.
Do not omit listed characters or plot threads.

Character awareness means how much NEW information a character gains during this scene about a plot thread.

Score delta from 0-10.

0 = the character gains no new information about the plot thread in this scene.
1-3 = the character gains minor or indirect information.
4-6 = the character gains meaningful new information.
7-9 = the character gains major new understanding.
10 = the character receives a decisive revelation.

This is a delta, not cumulative awareness.
Do not score scene relevance.
Do not score reader awareness.
Do not score plot importance.
Only score what each character plausibly learns during this scene.
If a character is not present or cannot plausibly learn the information, use delta 0.

Each rationale must be a single sentence supporting the delta.

Use these character definitions:
${characterDefinitions}

Use these plot thread definitions:
${plotThreadDefinitions}

Scene:

${parsed.content}

Required JSON:
{
  "plotThreads": {
    "plotThreadName": {
      "characterName": {
        "delta": number,
        "rationale": "string"
      }
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

let scores;

try {
  scores = JSON.parse(result.response);
} catch (error) {
  throw new Error(`Invalid JSON response: ${result.response}`);
}

const plotThreads = normalizeAwarenessMap(
  scores.plotThreads,
  plotThreadNames,
  characterNames,
  result.response
);

parsed.data.ai = parsed.data.ai ?? {};
parsed.data.ai.model = config.model;

parsed.data.ai.characterAwareness = parsed.data.ai.characterAwareness ?? {};
parsed.data.ai.characterAwareness.plotThreads = plotThreads;
parsed.data.ai.characterAwareness.updated = new Date().toISOString();

const updated = matter.stringify(parsed.content, parsed.data);
fs.writeFileSync(filePath, updated, "utf8");
