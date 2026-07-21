import fs from "fs";
import path from "path";
import matter from "gray-matter";

import { listSceneFiles } from "./scene-composition.mjs";

function normalizeValue(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function normalizeTag(value) {
  return normalizeValue(value).replace(/^#/, "");
}

export function asArray(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => item !== null && item !== undefined);
  }

  if (value instanceof Set) {
    return [...value].filter((item) => item !== null && item !== undefined);
  }

  if (typeof value === "string") {
    return value
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (value === null || value === undefined) {
    return [];
  }

  return [value];
}

export function noteTags(data = {}) {
  return new Set(
    [
      ...asArray(data.tags),
      ...asArray(data.tag)
    ].map(normalizeTag).filter(Boolean)
  );
}

function noteStatus(data = {}) {
  return normalizeValue(data.status);
}

export function normalizeFilterConfig(filters = {}) {
  const includeStatuses = new Set(asArray(filters.includeStatuses).map(normalizeValue).filter(Boolean));
  const excludeStatuses = new Set(asArray(filters.excludeStatuses).map(normalizeValue).filter(Boolean));
  const includeTags = new Set(asArray(filters.includeTags).map(normalizeTag).filter(Boolean));
  const excludeTags = new Set(asArray(filters.excludeTags).map(normalizeTag).filter(Boolean));

  assertNoOverlap(includeStatuses, excludeStatuses, "status");
  assertNoOverlap(includeTags, excludeTags, "tag");

  return {
    includeStatuses,
    excludeStatuses,
    includeTags,
    excludeTags
  };
}

function setToArray(set) {
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function mergeFilterConfigs(base = {}, override = {}) {
  const normalizedBase = normalizeFilterConfig(base);
  const normalizedOverride = normalizeFilterConfig(override);
  const includeStatuses = new Set([
    ...normalizedBase.includeStatuses,
    ...normalizedOverride.includeStatuses
  ]);
  const excludeStatuses = new Set([
    ...normalizedBase.excludeStatuses,
    ...normalizedOverride.excludeStatuses
  ]);
  const includeTags = new Set([
    ...normalizedBase.includeTags,
    ...normalizedOverride.includeTags
  ]);
  const excludeTags = new Set([
    ...normalizedBase.excludeTags,
    ...normalizedOverride.excludeTags
  ]);

  for (const status of normalizedOverride.includeStatuses) {
    excludeStatuses.delete(status);
  }

  for (const status of normalizedOverride.excludeStatuses) {
    includeStatuses.delete(status);
  }

  for (const tag of normalizedOverride.includeTags) {
    excludeTags.delete(tag);
  }

  for (const tag of normalizedOverride.excludeTags) {
    includeTags.delete(tag);
  }

  return {
    includeStatuses: setToArray(includeStatuses),
    excludeStatuses: setToArray(excludeStatuses),
    includeTags: setToArray(includeTags),
    excludeTags: setToArray(excludeTags)
  };
}

function assertNoOverlap(include, exclude, label) {
  const conflicts = [...include].filter((item) => exclude.has(item));

  if (conflicts.length > 0) {
    throw new Error(
      `Evaluation filter conflict: ${label} value(s) cannot be both included and excluded: ${conflicts.join(", ")}.`
    );
  }
}

function intersects(left, right) {
  for (const item of left) {
    if (right.has(item)) {
      return true;
    }
  }

  return false;
}

export function noteMatchesFilters(data = {}, filters = {}) {
  const normalized = normalizeFilterConfig(filters);

  const status = noteStatus(data);

  if (status && normalized.excludeStatuses.has(status)) {
    return false;
  }

  if (normalized.includeStatuses.size > 0 && !normalized.includeStatuses.has(status)) {
    return false;
  }

  const tags = noteTags(data);

  if (intersects(tags, normalized.excludeTags)) {
    return false;
  }

  if (normalized.includeTags.size > 0 && !intersects(tags, normalized.includeTags)) {
    return false;
  }

  return true;
}

export function getEvaluationProfile(config, name) {
  const evaluationConfig = config.evaluation ?? {};
  const profileName = name ?? evaluationConfig.defaultProfile ?? "default";
  const profiles = evaluationConfig.profiles ?? {};

  if (name && !profiles[profileName]) {
    throw new Error(`Unknown evaluation profile "${profileName}".`);
  }

  const profile = profiles[profileName] ?? profiles.default ?? {};

  return {
    name: profileName,
    elementFilters: mergeFilterConfigs(
      evaluationConfig.elementFilters,
      profile.elementFilters
    ),
    sceneFilters: mergeFilterConfigs(
      evaluationConfig.sceneFilters,
      profile.sceneFilters
    )
  };
}

export function readMarkdownData(filePath) {
  return matter(fs.readFileSync(filePath, "utf8"));
}

export function listMarkdownFiles(folderPath) {
  if (!folderPath || !fs.existsSync(folderPath)) {
    return [];
  }

  return fs.readdirSync(folderPath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .filter((entry) => entry.name.endsWith(".md"))
    .map((entry) => path.join(folderPath, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

export function listEligibleMarkdownFiles(folderPath, filters = {}) {
  return listMarkdownFiles(folderPath)
    .filter((filePath) => noteMatchesFilters(readMarkdownData(filePath).data, filters));
}

export function listEligibleDefinitions(projectRoot, category, filters = {}) {
  const folderPath = path.isAbsolute(category)
    ? category
    : path.join(projectRoot, category);

  return listEligibleMarkdownFiles(folderPath, filters).map((filePath) => {
    const parsed = readMarkdownData(filePath);

    return {
      name: path.basename(filePath, ".md"),
      content: parsed.content.trim(),
      filePath
    };
  });
}

export function listEligibleSceneFiles(scenesRoot, filters = {}) {
  return listSceneFiles(scenesRoot)
    .filter((filePath) => noteMatchesFilters(readMarkdownData(filePath).data, filters));
}

export function listEligibleDefinitionsFromPaths(projectRoot, folderPaths, filters = {}) {
  const seen = new Map();

  for (const folderPath of asArray(folderPaths)) {
    const definitions = listEligibleDefinitions(projectRoot, folderPath, filters);

    for (const definition of definitions) {
      if (!seen.has(definition.name)) {
        seen.set(definition.name, definition);
      }
    }
  }

  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function applyNameFilters(names, includeNames = [], excludeNames = []) {
  const include = new Set(asArray(includeNames).map(String));
  const exclude = new Set(asArray(excludeNames).map(String));
  assertNoOverlap(include, exclude, "name");

  return names.filter((name) => {
    if (include.size > 0 && !include.has(name)) {
      return false;
    }

    return !exclude.has(name);
  });
}
