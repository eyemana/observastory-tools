import matter from "gray-matter";

export class InlineEmbedError extends Error {
  constructor(message) {
    super(message);
    this.name = "InlineEmbedError";
  }
}

export function parseEmbedTarget(rawTarget) {
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

function maskRange(characters, start, end) {
  for (let index = start; index < end; index++) {
    if (characters[index] !== "\n" && characters[index] !== "\r") {
      characters[index] = " ";
    }
  }
}

function protectedSyntaxMask(content) {
  const characters = [...content];
  const frontmatter = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);

  if (frontmatter) {
    maskRange(characters, 0, frontmatter[0].length);
  }

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
  let match;
  const comments = /%%[\s\S]*?(?:%%|$)/g;

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

export function findEmbedOccurrences(content) {
  const mask = protectedSyntaxMask(content);
  const pattern = /!\[\[([^\]\n]+)\]\]/g;

  return [...mask.matchAll(pattern)].map(match => ({
    raw: content.slice(match.index, match.index + match[0].length),
    ...parseEmbedTarget(match[1]),
    start: match.index,
    end: match.index + match[0].length
  }));
}

function headingText(line) {
  const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
  return match ? { level: match[1].length, text: match[2].trim() } : null;
}

function extractHeading(content, selector, sourceLabel) {
  const parts = selector.split("#").map(part => part.trim()).filter(Boolean);
  let selected = content;

  for (const part of parts) {
    const lines = selected.split(/\r?\n/);
    const start = lines.findIndex(line => {
      const heading = headingText(line);
      return heading && heading.text.toLowerCase() === part.toLowerCase();
    });

    if (start === -1) {
      throw new InlineEmbedError(`Heading "${part}" was not found in ${sourceLabel}.`);
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

function extractBlock(content, blockId, sourceLabel) {
  const escapedId = blockId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const marker = new RegExp(`(?:^|\\s)\\^${escapedId}\\s*$`);
  const lines = content.split(/\r?\n/);
  const index = lines.findIndex(line => marker.test(line));

  if (index === -1) {
    throw new InlineEmbedError(`Block "^${blockId}" was not found in ${sourceLabel}.`);
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

export function extractEmbeddedSelection(sourceContent, selector, sourceLabel = "embed source") {
  const body = matter(sourceContent).content.trim();

  if (!selector) {
    return body;
  }

  if (selector.startsWith("^")) {
    return extractBlock(body, selector.slice(1), sourceLabel);
  }

  return extractHeading(body, selector, sourceLabel);
}

function samePath(left, right) {
  return String(left ?? "").replace(/\\/g, "/").toLowerCase() ===
    String(right ?? "").replace(/\\/g, "/").toLowerCase();
}

function applyReplacements(content, replacements) {
  let updated = content;

  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    updated = `${updated.slice(0, replacement.start)}${replacement.content}${updated.slice(replacement.end)}`;
  }

  return updated;
}

export function buildInlineEmbedPlan({
  sourcePath,
  sourceContent,
  notes,
  resolveTarget
}) {
  const changes = [];
  const errors = [];

  for (const note of notes) {
    if (samePath(note.path, sourcePath)) {
      continue;
    }

    const replacements = [];

    for (const occurrence of findEmbedOccurrences(note.content)) {
      const resolvedPath = resolveTarget(occurrence.note, note.path);

      if (!resolvedPath || !samePath(resolvedPath, sourcePath)) {
        continue;
      }

      try {
        replacements.push({
          ...occurrence,
          content: extractEmbeddedSelection(sourceContent, occurrence.selector, sourcePath)
        });
      } catch (error) {
        errors.push({
          path: note.path,
          raw: occurrence.raw,
          message: error.message
        });
      }
    }

    if (replacements.length === 0) {
      continue;
    }

    changes.push({
      path: note.path,
      managed: Boolean(note.managed),
      originalContent: note.content,
      updatedContent: applyReplacements(note.content, replacements),
      occurrences: replacements.map(({ raw, selector, start, end }) => ({
        raw,
        selector,
        start,
        end
      }))
    });
  }

  const managedChanges = changes.filter(change => change.managed);
  const outsideChanges = changes.filter(change => !change.managed);

  return {
    sourcePath,
    managedChanges,
    outsideChanges,
    errors,
    managedOccurrenceCount: managedChanges.reduce(
      (total, change) => total + change.occurrences.length,
      0
    ),
    outsideOccurrenceCount: outsideChanges.reduce(
      (total, change) => total + change.occurrences.length,
      0
    )
  };
}
