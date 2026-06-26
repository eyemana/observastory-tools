module.exports = async (tp) => {
  const path = await tp.system.prompt("Frontmatter path to delete", "");

  if (!path) {
    new Notice("Cancelled.");
    return "";
  }

  const file = app.workspace.getActiveFile();

  if (!file) {
    new Notice("No active file.");
    return "";
  }

  const parts = path.split(".").filter(Boolean);

  const original = await app.vault.read(file);
  const result = deleteFrontmatterPath(original, parts);

  if (result.deleted) {
    await app.vault.modify(file, result.text);
    new Notice(`Deleted "${path}" from ${file.path}.`);
  } else {
    new Notice(`Path "${path}" not found in ${file.path}.`);
  }

  return "";
};

function deleteFrontmatterPath(text, parts) {
  const match = text.match(/^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/);

  if (!match || parts.length === 0) {
    return { deleted: false, text };
  }

  const [fullMatch, openFence, frontmatter, closeFence] = match;
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = frontmatter.length > 0 ? frontmatter.split(/\r?\n/) : [];
  const target = findPathBlock(lines, parts);

  if (!target) {
    return { deleted: false, text };
  }

  lines.splice(target.start, target.end - target.start);

  const updatedFrontmatter = lines.join(newline);
  const updated = `${openFence}${updatedFrontmatter}${closeFence}`;

  return {
    deleted: true,
    text: updated + text.slice(fullMatch.length)
  };
}

function findPathBlock(lines, parts) {
  let start = 0;
  let end = lines.length;
  let indent = 0;
  let found = null;

  for (let index = 0; index < parts.length; index++) {
    found = findKey(lines, start, end, parts[index], indent);

    if (found === -1) {
      return null;
    }

    if (index === parts.length - 1) {
      return {
        start: found,
        end: findBlockEnd(lines, found, indent)
      };
    }

    start = found + 1;
    end = findBlockEnd(lines, found, indent);
    indent = childIndent(lines, start, end, indent);

    if (indent === null) {
      return null;
    }
  }

  return null;
}

function findKey(lines, start, end, key, indent) {
  for (let index = start; index < end; index++) {
    const parsed = parseKeyLine(lines[index]);

    if (parsed && parsed.indent === indent && parsed.key === key) {
      return index;
    }
  }

  return -1;
}

function findBlockEnd(lines, start, indent) {
  for (let index = start + 1; index < lines.length; index++) {
    if (isBlank(lines[index])) {
      const next = nextNonBlankIndent(lines, index + 1);

      if (next === null || next <= indent) {
        return index;
      }

      continue;
    }

    const lineIndent = countIndent(lines[index]);

    if (lineIndent <= indent) {
      return index;
    }
  }

  return lines.length;
}

function childIndent(lines, start, end, parentIndent) {
  let smallest = null;

  for (let index = start; index < end; index++) {
    if (isBlank(lines[index])) {
      continue;
    }

    const indent = countIndent(lines[index]);

    if (indent > parentIndent && (smallest === null || indent < smallest)) {
      smallest = indent;
    }
  }

  return smallest;
}

function nextNonBlankIndent(lines, start) {
  for (let index = start; index < lines.length; index++) {
    if (!isBlank(lines[index])) {
      return countIndent(lines[index]);
    }
  }

  return null;
}

function parseKeyLine(line) {
  const match = line.match(/^(\s*)(?:"([^"]+)"|'([^']+)'|([^:#][^:]*?))\s*:/);

  if (!match) {
    return null;
  }

  return {
    indent: match[1].length,
    key: (match[2] ?? match[3] ?? match[4]).trim()
  };
}

function countIndent(line) {
  return line.match(/^\s*/)[0].length;
}

function isBlank(line) {
  return /^\s*$/.test(line);
}
