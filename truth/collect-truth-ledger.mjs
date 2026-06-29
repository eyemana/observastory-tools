import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { loadConfig } from "../tool-config.mjs";

const __filename = fileURLToPath(import.meta.url);
const scriptRoot = path.dirname(__filename);
const toolRoot = path.resolve(scriptRoot, "..");
const config = loadConfig(toolRoot);

const allowedTruthValues = new Set([
  "true",
  "false",
  "partial",
  "ambiguous",
  "unknown"
]);

const arrayFields = new Set([
  "plotThreads",
  "characters",
  "storyEngines",
  "arcs",
  "locations",
  "subjects",
  "tags"
]);

const fieldAliases = {
  claim: "id",
  claimId: "id",
  claim_id: "id",
  id: "id",
  truth: "truth",
  truthValue: "truth",
  truth_value: "truth",
  subject: "subject",
  statement: "statement",
  text: "statement",
  plotThread: "plotThreads",
  plotThreads: "plotThreads",
  character: "characters",
  characters: "characters",
  storyEngine: "storyEngines",
  storyEngines: "storyEngines",
  arc: "arcs",
  arcs: "arcs",
  location: "locations",
  locations: "locations",
  tag: "tags",
  tags: "tags"
};

function readOption(name) {
  const index = process.argv.indexOf(name);

  if (index === -1) {
    return null;
  }

  return process.argv[index + 1] ?? null;
}

function usage() {
  return [
    "Usage: node truth/collect-truth-ledger.mjs [--vault-root <path>] [--output <path>] [--json]",
    "",
    "Collects author-written [!claim] callouts into the configured truth ledger index."
  ].join("\n");
}

function resolvePath(root, candidate) {
  if (!candidate) {
    return null;
  }

  return path.isAbsolute(candidate)
    ? candidate
    : path.resolve(root, candidate);
}

function walkMarkdownFiles(root) {
  if (!fs.existsSync(root)) {
    return [];
  }

  const files = [];
  const entries = fs.readdirSync(root, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const entryPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...walkMarkdownFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(entryPath);
    }
  }

  return files;
}

function stripCalloutPrefix(line) {
  return line.replace(/^>\s?/, "");
}

function normalizeFieldName(name) {
  return fieldAliases[name.trim()] ?? name.trim();
}

function parseListValue(value) {
  return String(value ?? "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

function assignField(fields, key, value) {
  const normalizedKey = normalizeFieldName(key);

  if (arrayFields.has(normalizedKey)) {
    fields[normalizedKey] = parseListValue(value);
    return normalizedKey;
  }

  fields[normalizedKey] = String(value ?? "").trim();
  return null;
}

function normalizeTruthValue(value) {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  const normalized = String(value ?? "").trim().toLowerCase();
  return allowedTruthValues.has(normalized) ? normalized : "";
}

function parseClaimBlock(block, filePath, relativePath) {
  const fields = {};
  const statementLines = [];
  let currentListKey = null;

  if (block.title) {
    const [maybeId] = block.title.split(/\s+/);

    if (maybeId) {
      fields.id = maybeId;
    }
  }

  for (const line of block.lines) {
    const listMatch = line.match(/^\s*-\s+(.+)$/);

    if (listMatch && currentListKey) {
      fields[currentListKey].push(listMatch[1].trim());
      continue;
    }

    const fieldMatch = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);

    if (fieldMatch) {
      currentListKey = assignField(fields, fieldMatch[1], fieldMatch[2]);
      continue;
    }

    currentListKey = null;

    if (line.trim()) {
      statementLines.push(line.trim());
    }
  }

  const statement = fields.statement || statementLines.join(" ").trim();
  const truth = normalizeTruthValue(fields.truth);

  return {
    id: fields.id ?? "",
    truth,
    subject: fields.subject ?? "",
    statement,
    plotThreads: fields.plotThreads ?? [],
    characters: fields.characters ?? [],
    storyEngines: fields.storyEngines ?? [],
    arcs: fields.arcs ?? [],
    locations: fields.locations ?? [],
    subjects: fields.subjects ?? [],
    tags: fields.tags ?? [],
    source: {
      path: relativePath,
      absolutePath: filePath,
      line: block.line
    }
  };
}

function extractClaimBlocks(filePath, vaultRoot) {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  const relativePath = path.relative(vaultRoot, filePath);
  const blocks = [];

  for (let index = 0; index < lines.length; index++) {
    const header = lines[index].match(/^>\s*\[!claim\][+-]?\s*(.*)$/i);

    if (!header) {
      continue;
    }

    const block = {
      title: header[1].trim(),
      line: index + 1,
      lines: []
    };

    let cursor = index + 1;

    while (cursor < lines.length && /^>\s?/.test(lines[cursor])) {
      block.lines.push(stripCalloutPrefix(lines[cursor]));
      cursor++;
    }

    blocks.push(parseClaimBlock(block, filePath, relativePath));
    index = cursor - 1;
  }

  return blocks;
}

function validateClaims(claims, scannedPaths) {
  const errors = [];
  const warnings = [];
  const seen = new Map();

  for (const scannedPath of scannedPaths) {
    if (!fs.existsSync(scannedPath)) {
      warnings.push(`Configured truth ledger path does not exist: ${scannedPath}`);
    }
  }

  for (const claim of claims) {
    const where = `${claim.source.path}:${claim.source.line}`;

    if (!claim.id) {
      errors.push(`Claim is missing an id at ${where}`);
    } else if (seen.has(claim.id)) {
      errors.push(
        `Duplicate claim id "${claim.id}" at ${where}; first seen at ${seen.get(claim.id)}`
      );
    } else {
      seen.set(claim.id, where);
    }

    if (!claim.truth) {
      errors.push(
        `Claim "${claim.id || "(missing id)"}" has missing or invalid truth value at ${where}. Expected one of: ${[...allowedTruthValues].join(", ")}`
      );
    }

    if (!claim.statement) {
      errors.push(`Claim "${claim.id || "(missing id)"}" is missing statement text at ${where}`);
    }
  }

  return { errors, warnings };
}

function sortClaims(a, b) {
  return (
    a.subject.localeCompare(b.subject) ||
    a.id.localeCompare(b.id) ||
    a.source.path.localeCompare(b.source.path) ||
    a.source.line - b.source.line
  );
}

function writeJsonAtomic(targetPath, value) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  const tempPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`
  );

  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, targetPath);
}

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(usage());
    return;
  }

  const truthConfig = config.truthLedger ?? {};
  const vaultRoot = resolvePath(toolRoot, readOption("--vault-root")) ??
    path.resolve(toolRoot, "..");
  const outputPath = resolvePath(
    toolRoot,
    readOption("--output") ?? truthConfig.outputPath ?? ".index/truth-ledger.json"
  );
  const configuredPaths = Array.isArray(truthConfig.paths)
    ? truthConfig.paths
    : [];
  const scanRoots = configuredPaths.map(scanPath => resolvePath(vaultRoot, scanPath));
  const files = [...new Set(scanRoots.flatMap(walkMarkdownFiles))].sort();
  const claims = files
    .flatMap(filePath => extractClaimBlocks(filePath, vaultRoot))
    .sort(sortClaims);
  const { errors, warnings } = validateClaims(claims, scanRoots);
  const index = {
    generatedAt: new Date().toISOString(),
    vaultRoot,
    outputPath,
    claimCount: claims.length,
    claims,
    warnings,
    errors
  };

  if (errors.length > 0) {
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(index, null, 2));
    } else {
      console.error(`Truth ledger validation failed with ${errors.length} error(s):`);
      for (const error of errors) {
        console.error(`- ${error}`);
      }
    }

    process.exitCode = 1;
    return;
  }

  writeJsonAtomic(outputPath, index);

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(index, null, 2));
  } else {
    for (const warning of warnings) {
      console.warn(`Warning: ${warning}`);
    }

    console.log(`Wrote ${claims.length} claim(s) to ${outputPath}`);
  }
}

main();
