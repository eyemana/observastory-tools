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


