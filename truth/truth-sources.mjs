import fs from "fs";
import path from "path";
import matter from "gray-matter";

import {
  defaultScenesPath,
  defaultTruthLedgerPaths
} from "../tool-config.mjs";
import {
  noteMatchesFilters
} from "../evaluation-filters.mjs";
import {
  isSceneNoteData,
  resolveSceneText,
  sceneCompositionSnapshot
} from "../scene-composition.mjs";
import { authorMarkdownFingerprint } from "../fingerprints.mjs";

const AUTHORED_CLAIM_PATTERN = /^>\s*\[!claim\][+-]?\s*/im;

function walkMarkdownFiles(root) {
  if (!root || !fs.existsSync(root)) {
    return [];
  }

  if (fs.statSync(root).isFile()) {
    return root.toLowerCase().endsWith(".md") ? [path.resolve(root)] : [];
  }

  const files = [];

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const entryPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...walkMarkdownFiles(entryPath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(path.resolve(entryPath));
    }
  }

  return files;
}

function isInside(candidatePath, rootPath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function sourceKind(filePath, scenesRoot, parsed) {
  if (!isInside(filePath, scenesRoot)) {
    return "note";
  }

  return isSceneNoteData(parsed.data) ? "scene" : "fragment";
}

function sourceFilters(config, kind) {
  return kind === "note"
    ? config.evaluation?.elementFilters ?? {}
    : config.evaluation?.sceneFilters ?? {};
}

export function describeTruthLedgerSource(filePath, { config, vaultRoot }) {
  const absolutePath = path.resolve(filePath);
  const scenesRoot = path.resolve(vaultRoot, defaultScenesPath(config));
  const raw = fs.readFileSync(absolutePath, "utf8");
  const parsed = matter(raw);
  const kind = sourceKind(absolutePath, scenesRoot, parsed);
  const hasAuthoredClaims = AUTHORED_CLAIM_PATTERN.test(raw);

  return {
    path: absolutePath,
    relativePath: path.relative(vaultRoot, absolutePath),
    kind,
    scenesRoot,
    hasAuthoredClaims,
    eligible: noteMatchesFilters(parsed.data, sourceFilters(config, kind)),
    infer: kind !== "fragment",
    dependencies: []
  };
}

export function listTruthLedgerSources({ config, vaultRoot }) {
  const files = truthLedgerScanRoots({ config, vaultRoot })
    .flatMap(walkMarkdownFiles);
  const byPath = new Map();

  for (const filePath of files) {
    const source = describeTruthLedgerSource(filePath, { config, vaultRoot });

    if (!source.eligible) {
      continue;
    }

    // Fragments are composition dependencies, not independent manuscript
    // evidence. Their only independent contribution is an explicit author
    // assertion, which must be indexed once at its physical source.
    if (source.kind === "fragment" && !source.hasAuthoredClaims) {
      continue;
    }

    byPath.set(source.path, source);
  }

  return [...byPath.values()].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );
}

export function truthLedgerScanRoots({ config, vaultRoot }) {
  return defaultTruthLedgerPaths(config).map(configuredPath =>
    path.isAbsolute(configuredPath)
      ? configuredPath
      : path.resolve(vaultRoot, configuredPath)
  );
}

export function truthLedgerInferenceInput(source, config) {
  if (!source.infer) {
    return null;
  }

  if (source.kind !== "scene") {
    return matter(fs.readFileSync(source.path, "utf8")).content.trim();
  }

  const resolved = resolveSceneText(source.path, {
    scenesRoot: source.scenesRoot,
    maxDepth: config.sceneComposition?.maxDepth
  });

  source.dependencies = resolved.dependencies;
  return resolved.content.trim();
}

export function truthLedgerSourceFingerprint(source, config) {
  if (source.kind === "scene") {
    const snapshot = sceneCompositionSnapshot(source.path, {
      scenesRoot: source.scenesRoot,
      maxDepth: config.sceneComposition?.maxDepth
    });
    source.dependencies = snapshot.dependencies;
    return snapshot.fingerprint;
  }

  return authorMarkdownFingerprint(source.path);
}

export function truthLedgerSourceMetadata(source, vaultRoot) {
  return {
    path: source.relativePath,
    kind: source.kind,
    dependencies: (source.dependencies ?? []).map(dependency =>
      path.relative(vaultRoot, dependency)
    )
  };
}
