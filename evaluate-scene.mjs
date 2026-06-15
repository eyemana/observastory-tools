// evaluate-scene.mjs

import fs from "fs";
import matter from "gray-matter";

const filePath = process.argv[2];

if (!filePath) {
  console.error("Usage: node evaluate-scene.mjs <file>");
  process.exit(1);
}

// Read note
const raw = fs.readFileSync(filePath, "utf8");
const parsed = matter(raw);

// Extract scene text
const sceneText = parsed.content;

// Build prompt
const prompt = `
You are evaluating narrative tension.

Return JSON only.

Rate the overall tension of this scene on a scale from 1 to 10.

Scene:

${sceneText}

Required JSON format:

{
  "tension": number
}
`;

// Call Ollama
const response = await fetch(
  "http://localhost:11434/api/generate",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "qwen2.5:7b",
      format: "json",
      prompt,
      stream: false
    })
  }
);

const result = await response.json();

// Parse returned JSON
const scores = JSON.parse(result.response);

// Update frontmatter
parsed.data.Tension = scores.tension;

// Write file back out
const updated = matter.stringify(
  parsed.content,
  parsed.data
);

fs.writeFileSync(filePath, updated, "utf8");

console.log(
  `Updated ${filePath} with Tension=${scores.tension}`
);