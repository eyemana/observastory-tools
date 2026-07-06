import fs from "fs";
import path from "path";
import matter from "gray-matter";

/**
 * Walk upward from a starting file until a folder name is found.
 */
export function findAncestorFolder(startPath, folderName) {
  let current = path.dirname(startPath);

  while (true) {
    if (path.basename(current) === folderName) {
      return current;
    }

    const parent = path.dirname(current);

    if (parent === current) {
      throw new Error(`Could not find ancestor folder: ${folderName}`);
    }

    current = parent;
  }
}

/**
 * Find the story/book root for a note. Prefer the configured story.root when
 * present, and otherwise fall back to obvious story-folder conventions.
 */
export function findStoryRoot(startPath, storyConfig = {}) {
  let current = path.dirname(startPath);
  const configuredRoot = String(storyConfig.root ?? "").trim();
  const configuredRootSegments = configuredRoot
    ? configuredRoot.split(/[\\/]+/).filter(Boolean)
    : [];
  const folders = storyConfig.folders ?? {};
  const scenesFolder = folders.scenes ?? "Scenes";
  const metricsFolder = folders.metrics ?? "Metrics";

  if (configuredRoot && path.isAbsolute(configuredRoot)) {
    return configuredRoot;
  }

  while (true) {
    if (configuredRootSegments.length > 0) {
      const currentSegments = current.split(path.sep).filter(Boolean);
      const currentSuffix = currentSegments.slice(-configuredRootSegments.length);

      if (currentSuffix.join("/") === configuredRootSegments.join("/")) {
        return current;
      }
    }

    if (path.basename(current) === "POC") {
      return current;
    }

    if (path.basename(current) === scenesFolder) {
      return path.dirname(current);
    }

    if (
      fs.existsSync(path.join(current, scenesFolder)) &&
      fs.existsSync(path.join(current, metricsFolder))
    ) {
      return current;
    }

    const parent = path.dirname(current);

    if (parent === current) {
      throw new Error("Could not find story root.");
    }

    current = parent;
  }
}

/**
 * Read and parse a markdown file.
 */
export function readMarkdownFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return matter(raw);
}

/**
 * Read a markdown file and return only the body content.
 */
export function readMarkdownContent(filePath) {
  return readMarkdownFile(filePath).content.trim();
}

/**
 * Read a markdown file and return frontmatter + content.
 */
export function readMarkdown(filePath) {
  return readMarkdownFile(filePath);
}

/**
 * Find a file relative to a project root.
 */
export function projectFile(projectRoot, ...segments) {
  if (segments.length > 0 && path.isAbsolute(segments[0])) {
    return path.join(...segments);
  }

  return path.join(projectRoot, ...segments);
}

export function readDefinition(projectRoot, category, name) {
  const filePath = projectFile(
    projectRoot,
    category,
    `${name}.md`
  );

  if (!fs.existsSync(filePath)) {
    throw new Error(`Definition not found: ${filePath}`);
  }

  return readMarkdownContent(filePath);
}

export function readDefinitions(projectRoot, category, names) {
  return names.map(name => ({
    name,
    content: readDefinition(projectRoot, category, name)
  }));
}

export function formatDefinitions(definitions) {
  return definitions
    .map(def => `${def.name}:\n${def.content}`)
    .join("\n\n");
}


export function toCamelCase(value) {
  return value
    .replace(/(?:^\w|[A-Z]|\b\w)/g, (word, index) =>
      index === 0 ? word.toLowerCase() : word.toUpperCase()
    )
    .replace(/\s+/g, "");
}
