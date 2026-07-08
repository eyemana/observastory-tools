import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import matter from "gray-matter";

import {
  defaultTruthLedgerPaths,
  getStoryConfig,
  loadConfig,
  storyPath,
  storyEntityTypePaths
} from "../tool-config.mjs";
import { listEligibleDefinitionsFromPaths } from "../evaluation-filters.mjs";
import { authorMarkdownFingerprint } from "../fingerprints.mjs";

const __filename = fileURLToPath(import.meta.url);
const scriptRoot = path.dirname(__filename);
const toolRoot = path.resolve(scriptRoot, "..");
const config = loadConfig(toolRoot);
const storyConfig = getStoryConfig(config);

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

function readOptions(name) {
  const values = [];

  for (let index = 0; index < process.argv.length; index++) {
    if (process.argv[index] === name && process.argv[index + 1]) {
      values.push(process.argv[index + 1]);
      index++;
    }
  }

  return values;
}

function usage() {
  return [
    "Usage: node truth/collect-truth-ledger.mjs [--vault-root <path>] [--file <path> ...] [--output <path>] [--json] [--infer|--no-infer]",
    "",
    "Collects author-written [!claim] callouts and optional lower-authority inferred claims into the configured truth ledger index."
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

function clampNumber(value, min, max, fallback = 0) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, number));
}

function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function isExactExcerpt(excerpt, sourceText) {
  if (!excerpt || !sourceText) {
    return false;
  }

  if (sourceText.includes(excerpt)) {
    return true;
  }

  return normalizeWhitespace(sourceText).includes(normalizeWhitespace(excerpt));
}

function normalizeEvidence(rawEvidence, sourceText) {
  const evidence = [];
  const seen = new Set();
  const items = Array.isArray(rawEvidence) ? rawEvidence : [];

  for (const item of items) {
    const text = typeof item === "string"
      ? item.trim()
      : String(item?.text ?? item?.excerpt ?? "").trim();

    if (!text || seen.has(text) || !isExactExcerpt(text, sourceText)) {
      continue;
    }

    seen.add(text);
    evidence.push(text);

    if (evidence.length >= 3) {
      break;
    }
  }

  return evidence;
}

function lineForExcerpt(sourceText, excerpt) {
  if (!excerpt) {
    return 1;
  }

  const index = sourceText.indexOf(excerpt);

  if (index === -1) {
    return 1;
  }

  return sourceText.slice(0, index).split(/\r?\n/).length;
}

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "claim";
}

function hashText(value) {
  return crypto
    .createHash("sha1")
    .update(String(value ?? ""))
    .digest("hex")
    .slice(0, 10);
}

function normalizeEntityName(value) {
  return String(value ?? "")
    .trim()
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "")
    .split("|")[0]
    .split("#")[0]
    .replace(/\.md$/i, "")
    .split(/[\\/]/)
    .pop()
    .trim();
}

function extractWikiLinks(text) {
  const links = [];
  const linkPattern = /\[\[([^\]]+)\]\]/g;
  let match;

  while ((match = linkPattern.exec(text ?? "")) !== null) {
    const rawTarget = match[1].trim();
    const [targetPart, displayPart] = rawTarget.split("|");
    const [pathPart, subpathPart] = targetPart.split("#");
    const target = pathPart.trim();
    const display = displayPart?.trim() || "";
    const subpath = subpathPart?.trim() || "";
    const name = normalizeEntityName(target);

    if (!target || !name) {
      continue;
    }

    links.push({
      raw: match[0],
      target,
      name,
      display,
      subpath
    });
  }

  return links;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const unique = [];

  for (const item of items) {
    const key = keyFn(item);

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(item);
  }

  return unique;
}

function buildEntityCatalog(vaultRoot) {
  const entries = [];
  const byName = new Map();
  const elementFilters = config.evaluation?.elementFilters ?? {};

  for (const [type, entityType] of Object.entries(storyConfig.entityTypes ?? {})) {
    const definitions = listEligibleDefinitionsFromPaths(
      vaultRoot,
      storyEntityTypePaths(config, type).map(configuredPath => storyPath(config, configuredPath)),
      elementFilters
    );

    for (const definition of definitions) {
      const entry = {
        type,
        target: entityType.target ?? type,
        label: entityType.label ?? type,
        name: definition.name,
        path: path.relative(vaultRoot, definition.filePath)
      };

      entries.push(entry);

      const normalized = definition.name.toLowerCase();
      if (!byName.has(normalized)) {
        byName.set(normalized, []);
      }

      byName.get(normalized).push(entry);
    }
  }

  return {
    entries: entries.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name)),
    byName
  };
}

function entityCatalogPromptShape(entityCatalog) {
  const grouped = {};

  for (const entry of entityCatalog.entries) {
    grouped[entry.type] = grouped[entry.type] ?? [];
    grouped[entry.type].push(entry.name);
  }

  return grouped;
}

function resolveEntitiesFromLinks(links, entityCatalog, source = "link") {
  const entities = [];

  for (const link of links) {
    for (const entry of entityCatalog.byName.get(link.name.toLowerCase()) ?? []) {
      entities.push({
        type: entry.type,
        target: entry.target,
        name: entry.name,
        source
      });
    }
  }

  return entities;
}

function resolveEntitiesFromField(values, entityCatalog, source) {
  const entities = [];

  for (const value of Array.isArray(values) ? values : parseListValue(values)) {
    const name = normalizeEntityName(value);

    if (!name) {
      continue;
    }

    for (const entry of entityCatalog.byName.get(name.toLowerCase()) ?? []) {
      entities.push({
        type: entry.type,
        target: entry.target,
        name: entry.name,
        source
      });
    }
  }

  return entities;
}

function uniqueEntities(entities) {
  const byKey = new Map();

  for (const entity of entities) {
    const key = `${entity.type}:${entity.name}`;

    if (!byKey.has(key)) {
      byKey.set(key, {
        type: entity.type,
        target: entity.target,
        name: entity.name,
        source: entity.source,
        sources: [entity.source].filter(Boolean)
      });
      continue;
    }

    const existing = byKey.get(key);
    if (entity.source && !existing.sources.includes(entity.source)) {
      existing.sources.push(entity.source);
      existing.source = existing.sources.join(", ");
    }
  }

  return [...byKey.values()].sort((a, b) =>
    a.type.localeCompare(b.type) ||
    a.name.localeCompare(b.name)
  );
}

function normalizeLinks(links) {
  return uniqueBy(
    links,
    link => `${link.target}:${link.display}:${link.subpath}`
  ).sort((a, b) => a.name.localeCompare(b.name) || a.target.localeCompare(b.target));
}

function supportRecord({ type, filePath, relativePath, line, excerpt }) {
  return {
    type,
    path: relativePath,
    absolutePath: filePath,
    line,
    excerpt: normalizeWhitespace(excerpt)
  };
}

function normalizeRelationships(rawRelationships) {
  const relationships = Array.isArray(rawRelationships) ? rawRelationships : [];

  return relationships
    .map(relationship => ({
      source: String(relationship?.source ?? "").trim(),
      target: String(relationship?.target ?? "").trim(),
      dimension: String(relationship?.dimension ?? "").trim(),
      statement: String(relationship?.statement ?? "").trim()
    }))
    .filter(relationship =>
      relationship.source ||
      relationship.target ||
      relationship.dimension ||
      relationship.statement
    );
}

function parseClaimBlock(block, filePath, relativePath, entityCatalog) {
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
  const textForLinks = [
    statement,
    fields.subject,
    ...Array.from(arrayFields)
      .flatMap(field => fields[field] ?? [])
  ].join("\n");
  const links = normalizeLinks(extractWikiLinks(textForLinks));
  const entities = uniqueEntities([
    ...resolveEntitiesFromLinks(links, entityCatalog),
    ...resolveEntitiesFromField(fields.subject, entityCatalog, "subject"),
    ...resolveEntitiesFromField(fields.plotThreads, entityCatalog, "plotThreads"),
    ...resolveEntitiesFromField(fields.characters, entityCatalog, "characters"),
    ...resolveEntitiesFromField(fields.storyEngines, entityCatalog, "storyEngines"),
    ...resolveEntitiesFromField(fields.arcs, entityCatalog, "arcs")
  ]);

  return {
    id: fields.id ?? "",
    authority: "author",
    truth,
    subject: fields.subject ?? "",
    statement,
    links,
    entities,
    relationships: [],
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
    },
    support: statement
      ? [supportRecord({
        type: "authored-claim",
        filePath,
        relativePath,
        line: block.line,
        excerpt: statement
      })]
      : []
  };
}

function extractClaimBlocks(filePath, vaultRoot, entityCatalog) {
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

    blocks.push(parseClaimBlock(block, filePath, relativePath, entityCatalog));
    index = cursor - 1;
  }

  return blocks;
}

function markdownBody(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return matter(raw).content.trim();
}

async function fetchJsonFromOllama(prompt) {
  const response = await fetch(config.ollamaUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.model,
      format: "json",
      prompt,
      stream: false,
      options: {
        temperature: 0
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama returned HTTP ${response.status}`);
  }

  const result = await response.json();

  try {
    return JSON.parse(result.response);
  } catch {
    throw new Error(`Invalid JSON response: ${result.response}`);
  }
}

function buildInferencePrompt(relativePath, content, inferenceConfig, entityCatalog) {
  return `
Return JSON only.
Return compact valid JSON.
Do not include markdown.
Do not include trailing commas.

You are collecting lower-authority inferred truth claims from an author's note.
These inferred claims are not authorial canon.
Infer only claims a careful average reader could reasonably believe from this exact note.
Use the known story entity names when a claim is clearly about a configured entity.
Do not invent new story ideas.
Do not add creative suggestions.
Do not infer beyond the supplied note.
Prefer fewer claims over speculative claims.

Return at most ${inferenceConfig.maxClaimsPerNote} claims.

Allowed truth values:
${JSON.stringify([...allowedTruthValues])}

Known story entities:
${JSON.stringify(entityCatalogPromptShape(entityCatalog), null, 2)}

Each evidence item must be an exact excerpt copied from the note.

Note path:
${relativePath}

Note:
${content}

Required JSON:
{
  "claims": [
    {
      "statement": "claim text",
      "truth": "true|false|partial|ambiguous|unknown",
      "subject": "short subject",
      "confidence": number,
      "plotThreads": ["name"],
      "characters": ["name"],
      "storyEngines": ["name"],
      "arcs": ["name"],
      "locations": ["name"],
      "relationships": [
        {
          "source": "entity name",
          "target": "entity name",
          "dimension": "knowledge|belief|trust|conflict|ownership|location|cause|other",
          "statement": "short relationship assertion"
        }
      ],
      "evidence": ["exact excerpt"]
    }
  ]
}
`;
}

function normalizeInferredClaim(rawClaim, filePath, relativePath, content, index, entityCatalog) {
  if (!rawClaim || typeof rawClaim !== "object") {
    return null;
  }

  const statement = String(rawClaim.statement ?? "").trim();
  const truth = normalizeTruthValue(rawClaim.truth);
  const confidence = clampNumber(rawClaim.confidence, 0, 10);
  const evidence = normalizeEvidence(rawClaim.evidence, content);

  if (!statement || !truth || evidence.length === 0) {
    return null;
  }

  const subject = String(rawClaim.subject ?? "").trim();
  const line = lineForExcerpt(content, evidence[0]);
  const legacyFields = {
    plotThreads: Array.isArray(rawClaim.plotThreads) ? rawClaim.plotThreads.filter(Boolean) : [],
    characters: Array.isArray(rawClaim.characters) ? rawClaim.characters.filter(Boolean) : [],
    storyEngines: Array.isArray(rawClaim.storyEngines) ? rawClaim.storyEngines.filter(Boolean) : [],
    arcs: Array.isArray(rawClaim.arcs) ? rawClaim.arcs.filter(Boolean) : []
  };
  const textForLinks = [
    statement,
    subject,
    ...evidence,
    ...legacyFields.plotThreads,
    ...legacyFields.characters,
    ...legacyFields.storyEngines,
    ...legacyFields.arcs
  ].join("\n");
  const links = normalizeLinks(extractWikiLinks(textForLinks));
  const entities = uniqueEntities([
    ...resolveEntitiesFromLinks(links, entityCatalog),
    ...resolveEntitiesFromField(subject, entityCatalog, "subject"),
    ...resolveEntitiesFromField(legacyFields.plotThreads, entityCatalog, "plotThreads"),
    ...resolveEntitiesFromField(legacyFields.characters, entityCatalog, "characters"),
    ...resolveEntitiesFromField(legacyFields.storyEngines, entityCatalog, "storyEngines"),
    ...resolveEntitiesFromField(legacyFields.arcs, entityCatalog, "arcs")
  ]);
  const support = evidence.map(excerpt => supportRecord({
    type: "inferred-evidence",
    filePath,
    relativePath,
    line: lineForExcerpt(content, excerpt),
    excerpt
  }));

  return {
    id: `inferred.${slugify(relativePath)}.${hashText(`${statement}:${index}`)}`,
    authority: "inferred",
    truth,
    subject,
    statement,
    confidence,
    links,
    entities,
    relationships: normalizeRelationships(rawClaim.relationships),
    plotThreads: legacyFields.plotThreads,
    characters: legacyFields.characters,
    storyEngines: legacyFields.storyEngines,
    arcs: legacyFields.arcs,
    locations: Array.isArray(rawClaim.locations) ? rawClaim.locations.filter(Boolean) : [],
    subjects: [],
    tags: [],
    evidence,
    support,
    source: {
      path: relativePath,
      absolutePath: filePath,
      line
    }
  };
}

async function inferClaimsFromFile(filePath, vaultRoot, inferenceConfig, entityCatalog) {
  const content = markdownBody(filePath);

  if (!content) {
    return [];
  }

  const relativePath = path.relative(vaultRoot, filePath);
  const response = await fetchJsonFromOllama(
    buildInferencePrompt(relativePath, content, inferenceConfig, entityCatalog)
  );
  const rawClaims = Array.isArray(response.claims) ? response.claims : [];

  return rawClaims
    .map((rawClaim, index) =>
      normalizeInferredClaim(rawClaim, filePath, relativePath, content, index, entityCatalog)
    )
    .filter(Boolean)
    .filter(claim => claim.confidence >= inferenceConfig.minConfidence);
}

async function inferClaims(files, vaultRoot, inferenceConfig, warnings, entityCatalog) {
  const inferredClaims = [];

  for (const filePath of files) {
    try {
      inferredClaims.push(
        ...(await inferClaimsFromFile(filePath, vaultRoot, inferenceConfig, entityCatalog))
      );
    } catch (error) {
      warnings.push(
        `Could not infer claims from ${path.relative(vaultRoot, filePath)}: ${error.message}`
      );
    }
  }

  return inferredClaims.sort(sortClaims);
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

async function main() {
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
  const configuredPaths = defaultTruthLedgerPaths(config);
  const explicitFiles = [...new Set(
    readOptions("--file")
      .map(filePath => resolvePath(vaultRoot, filePath))
      .filter(Boolean)
      .filter(filePath => filePath.endsWith(".md"))
  )].sort();
  const inferenceConfig = {
    enabled: truthConfig.inference?.enabled !== false,
    maxClaimsPerNote: Math.max(0, Number(truthConfig.inference?.maxClaimsPerNote) || 5),
    minConfidence: clampNumber(truthConfig.inference?.minConfidence, 0, 10, 6)
  };

  if (process.argv.includes("--infer")) {
    inferenceConfig.enabled = true;
  }

  if (process.argv.includes("--no-infer")) {
    inferenceConfig.enabled = false;
  }

  const scanRoots = configuredPaths.map(scanPath => resolvePath(vaultRoot, scanPath));
  const entityCatalog = buildEntityCatalog(vaultRoot);
  const files = explicitFiles.length > 0
    ? explicitFiles
    : [...new Set(scanRoots.flatMap(walkMarkdownFiles))].sort();
  const claims = files
    .flatMap(filePath => extractClaimBlocks(filePath, vaultRoot, entityCatalog))
    .sort(sortClaims);
  const { errors, warnings } = validateClaims(
    claims,
    explicitFiles.length > 0 ? explicitFiles : scanRoots
  );
  const inferredClaims = errors.length === 0 && inferenceConfig.enabled
    ? await inferClaims(files, vaultRoot, inferenceConfig, warnings, entityCatalog)
    : [];
  const generatedAt = new Date().toISOString();
  const sourceFingerprints = files.map(filePath => ({
    path: path.relative(vaultRoot, filePath),
    fingerprint: authorMarkdownFingerprint(filePath),
    updatedAt: generatedAt
  }));
  const index = {
    generatedAt,
    vaultRoot,
    outputPath,
    sourceFingerprints,
    entityCount: entityCatalog.entries.length,
    entities: entityCatalog.entries,
    claimCount: claims.length,
    inferredClaimCount: inferredClaims.length,
    claims,
    inferredClaims,
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

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
