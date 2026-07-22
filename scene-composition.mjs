import crypto from "crypto";
import fs from "fs";
import path from "path";
import matter from "gray-matter";

const COMPOSITION_FINGERPRINT_VERSION = 1;

export class SceneCompositionError extends Error {
  constructor(message, chain = []) {
    const suffix = chain.length > 0
      ? `\n\nEmbed chain:\n${chain.map((item) => `- ${item}`).join("\n")}`
      : "";
    super(`${message}${suffix}`);
    this.name = "SceneCompositionError";
    this.chain = chain;
  }
}

export function isSceneNoteData(data = {}) {
  return String(data.type ?? "").trim().toLowerCase() === "scene";
}

export function walkSceneMarkdownFiles(rootPath) {
  if (!rootPath || !fs.existsSync(rootPath)) {
    return [];
  }

  if (fs.statSync(rootPath).isFile()) {
    return rootPath.toLowerCase().endsWith(".md") ? [path.resolve(rootPath)] : [];
  }

  const files = [];

  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const entryPath = path.join(rootPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...walkSceneMarkdownFiles(entryPath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(path.resolve(entryPath));
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

export function listSceneFiles(scenesRoot) {
  return walkSceneMarkdownFiles(scenesRoot)
    .filter((filePath) => isSceneNoteData(matter(fs.readFileSync(filePath, "utf8")).data));
}

function normalizeRelativePath(value) {
  return value
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\//, "")
    .replace(/\.md$/i, "")
    .toLowerCase();
}

function displayPath(filePath, scenesRoot) {
  return path.relative(scenesRoot, filePath).replace(/\\/g, "/");
}

function buildNoteIndex(scenesRoot) {
  const files = walkSceneMarkdownFiles(scenesRoot);
  const byRelativePath = new Map();
  const byBasename = new Map();

  for (const filePath of files) {
    const relative = normalizeRelativePath(path.relative(scenesRoot, filePath));
    const basename = path.basename(filePath, path.extname(filePath)).toLowerCase();
    byRelativePath.set(relative, filePath);
    byBasename.set(basename, [...(byBasename.get(basename) ?? []), filePath]);
  }

  return { byRelativePath, byBasename };
}

function parseEmbedTarget(rawTarget) {
  const withoutAlias = String(rawTarget ?? "").split("|")[0].trim();
  const hashIndex = withoutAlias.indexOf("#");

  if (hashIndex === -1) {
    return { note: withoutAlias, selector: null };
  }

  return {
    note: withoutAlias.slice(0, hashIndex).trim(),
    selector: withoutAlias.slice(hashIndex + 1).trim() || null
  };
}

function resolveEmbedPath(noteTarget, currentFilePath, scenesRoot, index, chain) {
  if (!noteTarget) {
    return currentFilePath;
  }

  const normalized = normalizeRelativePath(noteTarget);
  const explicit = index.byRelativePath.get(normalized);

  if (explicit) {
    return explicit;
  }

  if (noteTarget.startsWith("./") || noteTarget.startsWith("../")) {
    const candidate = path.resolve(path.dirname(currentFilePath), `${noteTarget.replace(/\.md$/i, "")}.md`);
    const relative = path.relative(scenesRoot, candidate);

    if (!relative.startsWith("..") && !path.isAbsolute(relative) && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const basename = path.basename(noteTarget, path.extname(noteTarget)).toLowerCase();
  const matches = index.byBasename.get(basename) ?? [];

  if (matches.length === 1) {
    return matches[0];
  }

  if (matches.length > 1) {
    throw new SceneCompositionError(
      `Ambiguous embedded note "${noteTarget}". Use its path from the configured Scenes folder.`,
      chain
    );
  }

  throw new SceneCompositionError(`Embedded note not found: "${noteTarget}".`, chain);
}

function headingText(line) {
  const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
  return match ? { level: match[1].length, text: match[2].trim() } : null;
}

function extractHeading(content, selector, sourceLabel, chain) {
  const parts = selector.split("#").map((part) => part.trim()).filter(Boolean);
  let selected = content;

  for (const part of parts) {
    const lines = selected.split(/\r?\n/);
    const start = lines.findIndex((line) => {
      const heading = headingText(line);
      return heading && heading.text.toLowerCase() === part.toLowerCase();
    });

    if (start === -1) {
      throw new SceneCompositionError(
        `Heading "${part}" was not found in embedded note ${sourceLabel}.`,
        chain
      );
    }

    const level = headingText(lines[start]).level;
    let end = lines.length;

    for (let index = start + 1; index < lines.length; index++) {
      const heading = headingText(lines[index]);
      if (heading && heading.level <= level) {
        end = index;
        break;
      }
    }

    selected = lines.slice(start, end).join("\n");
  }

  return selected;
}

function extractBlock(content, blockId, sourceLabel, chain) {
  const lines = content.split(/\r?\n/);
  const marker = new RegExp(`(?:^|\\s)\\^${blockId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`);
  const index = lines.findIndex((line) => marker.test(line));

  if (index === -1) {
    throw new SceneCompositionError(
      `Block "^${blockId}" was not found in embedded note ${sourceLabel}.`,
      chain
    );
  }

  if (lines[index].trim() !== `^${blockId}`) {
    return lines[index].replace(marker, "").trimEnd();
  }

  let start = index - 1;
  while (start >= 0 && lines[start].trim() !== "") {
    start--;
  }

  return lines.slice(start + 1, index).join("\n");
}

function extractSelection(content, selector, sourceLabel, chain) {
  if (!selector) {
    return content;
  }

  if (selector.startsWith("^")) {
    return extractBlock(content, selector.slice(1), sourceLabel, chain);
  }

  return extractHeading(content, selector, sourceLabel, chain);
}

function maskRange(characters, start, end) {
  for (let index = start; index < end; index++) {
    if (characters[index] !== "\n" && characters[index] !== "\r") {
      characters[index] = " ";
    }
  }
}

function protectedSyntaxMask(content) {
  const characters = [...content];
  const lines = content.match(/.*(?:\r?\n|$)/g) ?? [];
  let offset = 0;
  let fence = null;

  for (const line of lines) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    const inFence = fence !== null;

    if (marker && !fence) {
      fence = marker[1][0];
    } else if (marker && fence === marker[1][0]) {
      fence = null;
    }

    if (inFence || marker) {
      maskRange(characters, offset, offset + line.length);
    }

    offset += line.length;
  }

  let masked = characters.join("");
  const comments = /%%[\s\S]*?(?:%%|$)/g;
  let match;

  while ((match = comments.exec(masked)) !== null) {
    maskRange(characters, match.index, match.index + match[0].length);
  }

  masked = characters.join("");
  const inlineCode = /(`+)[^\n]*?\1/g;

  while ((match = inlineCode.exec(masked)) !== null) {
    maskRange(characters, match.index, match.index + match[0].length);
  }

  return characters.join("");
}

function expandContent({
  content,
  currentFilePath,
  scenesRoot,
  index,
  maxDepth,
  depth,
  stack,
  dependencies
}) {
  const mask = protectedSyntaxMask(content);
  const embedPattern = /!\[\[([^\]\n]+)\]\]/g;
  const matches = [...mask.matchAll(embedPattern)];

  if (matches.length === 0) {
    return content;
  }

  let output = "";
  let cursor = 0;

  for (const match of matches) {
    output += content.slice(cursor, match.index);
    const { note, selector } = parseEmbedTarget(match[1]);
    const chain = [...stack.map((filePath) => displayPath(filePath, scenesRoot)), match[0]];
    const embeddedPath = resolveEmbedPath(note, currentFilePath, scenesRoot, index, chain);

    if (depth + 1 > maxDepth) {
      throw new SceneCompositionError(
        `Scene fragment nesting exceeds the configured maximum depth of ${maxDepth}.`,
        chain
      );
    }

    if (stack.includes(embeddedPath)) {
      throw new SceneCompositionError("Circular or self-referential scene embed detected.", chain);
    }

    const embedded = matter(fs.readFileSync(embeddedPath, "utf8"));

    if (isSceneNoteData(embedded.data)) {
      throw new SceneCompositionError(
        `A scene cannot embed another official scene: ${displayPath(embeddedPath, scenesRoot)}. Remove type: scene from the embedded note to make it a fragment.`,
        chain
      );
    }

    dependencies.add(embeddedPath);
    const selected = extractSelection(
      embedded.content.trim(),
      selector,
      displayPath(embeddedPath, scenesRoot),
      chain
    );
    const expanded = expandContent({
      content: selected,
      currentFilePath: embeddedPath,
      scenesRoot,
      index,
      maxDepth,
      depth: depth + 1,
      stack: [...stack, embeddedPath],
      dependencies
    });

    output += expanded;
    cursor = match.index + match[0].length;
  }

  return `${output}${content.slice(cursor)}`;
}

export function resolveSceneText(scenePath, options = {}) {
  const rootFilePath = path.resolve(scenePath);
  const scenesRoot = path.resolve(options.scenesRoot ?? path.dirname(rootFilePath));
  const maxDepth = Math.max(1, Number(options.maxDepth) || 5);
  const relativeRoot = path.relative(scenesRoot, rootFilePath);

  if (relativeRoot.startsWith("..") || path.isAbsolute(relativeRoot)) {
    throw new SceneCompositionError("The scene must be inside the configured Scenes folder.");
  }

  const parsed = matter(fs.readFileSync(rootFilePath, "utf8"));

  if (options.requireScene !== false && !isSceneNoteData(parsed.data)) {
    throw new SceneCompositionError(
      `${displayPath(rootFilePath, scenesRoot)} is a scene fragment, not an official scene. Add type: scene to evaluate it independently.`
    );
  }

  const dependencies = new Set();
  const content = expandContent({
    content: parsed.content,
    currentFilePath: rootFilePath,
    scenesRoot,
    index: buildNoteIndex(scenesRoot),
    maxDepth,
    depth: 0,
    stack: [rootFilePath],
    dependencies
  });

  return {
    content,
    dependencies: [...dependencies].sort((left, right) => left.localeCompare(right)),
    maxDepth
  };
}

export function sceneCompositionSnapshot(scenePath, options = {}) {
  const raw = fs.readFileSync(scenePath, "utf8");
  const parsed = matter(raw);
  const frontmatter = { ...(parsed.data ?? {}) };
  delete frontmatter.ai;
  const resolved = resolveSceneText(scenePath, options);
  const fingerprint = crypto
    .createHash("sha256")
    .update(JSON.stringify({
      version: COMPOSITION_FINGERPRINT_VERSION,
      frontmatter,
      content: resolved.content,
      maxDepth: resolved.maxDepth
    }))
    .digest("hex");

  return {
    ...resolved,
    fingerprint
  };
}

export function sceneCompositionFingerprint(scenePath, options = {}) {
  return sceneCompositionSnapshot(scenePath, options).fingerprint;
}
