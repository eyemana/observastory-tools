import crypto from "crypto";
import fs from "fs";
import matter from "gray-matter";

const AUTHOR_INPUT_HASH_VERSION = 1;
const CHRONOLOGY_INPUT_HASH_VERSION = 1;

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }

  if (!isPlainObject(value)) {
    return value;
  }

  return Object.keys(value)
    .sort((a, b) => a.localeCompare(b))
    .reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
}

function hashValue(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

export function authorMarkdownFingerprint(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = matter(raw);
  const frontmatter = { ...(parsed.data ?? {}) };
  delete frontmatter.ai;

  return hashValue({
    version: AUTHOR_INPUT_HASH_VERSION,
    frontmatter,
    content: parsed.content
  });
}

export function chronologyInputHash(data = {}) {
  return hashValue({
    version: CHRONOLOGY_INPUT_HASH_VERSION,
    chronology_label: data.chronology_label ?? null,
    chronology_value: data.chronology_value ?? null
  });
}
