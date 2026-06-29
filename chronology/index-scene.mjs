import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import matter from "gray-matter";

import { parseChronologyValue } from "./chronology-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const scriptRoot = path.dirname(__filename);
const toolRoot = path.resolve(scriptRoot, "..");

function readOption(name) {
  const index = process.argv.indexOf(name);

  if (index === -1) {
    return null;
  }

  return process.argv[index + 1] ?? null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function usage() {
  return [
    "Usage: node chronology/index-scene.mjs <scene.md> [--vault-root <path>] [--json] [--dry-run]",
    "",
    "Reads chronology_label and chronology_value, then writes generated ai.chronology sort metadata."
  ].join("\n");
}

function writeScene(filePath, parsed) {
  const output = matter.stringify(parsed.content, parsed.data);
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );

  fs.writeFileSync(tempPath, output, "utf8");
  fs.renameSync(tempPath, filePath);
}

function buildResult(filePath, vaultRoot, parsed, dryRun) {
  const relativePath = vaultRoot
    ? path.relative(vaultRoot, filePath)
    : path.relative(toolRoot, filePath);
  const label = String(parsed.data.chronology_label ?? "").trim();
  const rawValue = parsed.data.chronology_value ?? "";
  const parsedValue = parseChronologyValue(rawValue);

  if (!parsedValue.ok) {
    return {
      ok: parsedValue.status === "missing",
      status: parsedValue.status,
      filePath,
      relativePath,
      label,
      value: String(rawValue ?? "").trim(),
      error: parsedValue.error,
      dryRun
    };
  }

  const generated = {
    status: "ok",
    label,
    value: parsedValue.value,
    sort: parsedValue.sort,
    sortUnit: parsedValue.sortUnit,
    precision: parsedValue.precision,
    parser: parsedValue.parser,
    generatedAt: new Date().toISOString(),
    sourceFields: [
      "chronology_label",
      "chronology_value"
    ]
  };

  return {
    ok: true,
    status: "indexed",
    filePath,
    relativePath,
    label,
    value: parsedValue.value,
    sort: parsedValue.sort,
    generated,
    dryRun
  };
}

async function main() {
  if (hasFlag("--help") || hasFlag("-h")) {
    console.log(usage());
    return;
  }

  const filePath = process.argv[2];

  if (!filePath || filePath.startsWith("--")) {
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  const absolutePath = path.resolve(filePath);
  const vaultRoot = readOption("--vault-root");
  const dryRun = hasFlag("--dry-run");
  const raw = fs.readFileSync(absolutePath, "utf8");
  const parsed = matter(raw);
  const result = buildResult(absolutePath, vaultRoot, parsed, dryRun);

  if (result.status === "indexed" && !dryRun) {
    parsed.data.ai = parsed.data.ai ?? {};
    parsed.data.ai.chronology = result.generated;
    writeScene(absolutePath, parsed);
  } else if (result.status === "missing" && parsed.data.ai?.chronology && !dryRun) {
    delete parsed.data.ai.chronology;

    if (Object.keys(parsed.data.ai).length === 0) {
      delete parsed.data.ai;
    }

    result.cleared = true;
    writeScene(absolutePath, parsed);
  }

  if (hasFlag("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.status === "indexed") {
    console.log(`Indexed chronology for ${result.relativePath}: ${result.sort}`);
  } else if (result.status === "missing") {
    console.log(`Skipped ${result.relativePath}: chronology_value is not set.`);
  } else {
    console.error(`Failed ${result.relativePath}: ${result.error}`);
  }

  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
