import fs from "fs";
import path from "path";

export const defaultConfig = {
  ollamaUrl: "http://localhost:11434/api/generate",
  model: "qwen2.5:7b",
  scheduler: {
    mode: "manual",
    queueDir: ".queue",
    throttleMs: 5000,
    pollIntervalMs: 30000,
    launchWorkerFromTemplater: true,
    monitorFromTemplater: true,
    statusNoticeIntervalMs: 5000,
    statusNoticeMaxMinutes: 240,
    nodePath: "node",
    evaluations: [
      ["Relevance", "Character"],
      ["Relevance", "Plot Thread"],
      ["Relevance", "Story Engine"],
      ["Relevance", "Arc"],
      ["Tension", "Character"],
      ["Tension", "Plot Thread"],
      ["Tension", "Story Engine"],
      ["Tension", "Arc"],
      ["Resolution", "Character"],
      ["Resolution", "Plot Thread"],
      ["Resolution", "Story Engine"],
      ["Resolution", "Arc"],
      ["Character Awareness", "Plot Thread"]
    ]
  }
};

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function mergeConfig(base, override) {
  const merged = { ...base };

  for (const [key, value] of Object.entries(override ?? {})) {
    if (isPlainObject(value) && isPlainObject(merged[key])) {
      merged[key] = mergeConfig(merged[key], value);
    } else {
      merged[key] = value;
    }
  }

  return merged;
}

export function loadConfig(toolRoot) {
  const localPath = path.join(toolRoot, "config.local.json");
  const examplePath = path.join(toolRoot, "config.example.json");
  const configPath = fs.existsSync(localPath) ? localPath : examplePath;

  if (!fs.existsSync(configPath)) {
    return defaultConfig;
  }

  const fileConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  return mergeConfig(defaultConfig, fileConfig);
}

export function getSchedulerConfig(toolRoot) {
  return loadConfig(toolRoot).scheduler;
}
