import fs from "fs";
import path from "path";
import matter from "gray-matter";

const toolRoot = path.dirname(new URL(import.meta.url).pathname);
const configPath = path.join(toolRoot, "config.local.json");

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

const filePath = process.argv[2];

if (!filePath) {
  console.error("Usage: node evaluate-scene.mjs <file>");
  process.exit(1);
}

const raw = fs.readFileSync(filePath, "utf8");
const parsed = matter(raw);

const prompt = `
Return JSON only.

Evaluate the overall narrative tension of this scene on a scale from 1 to 10.

Scene:

${parsed.content}

Required JSON:
{
  "tension": number
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

parsed.data.Tension = scores.tension;

const updated = matter.stringify(parsed.content, parsed.data);
fs.writeFileSync(filePath, updated, "utf8");

console.log(`Updated ${filePath} with Tension=${scores.tension}`);
