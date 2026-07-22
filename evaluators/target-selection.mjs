function asArray(value) {
  if (Array.isArray(value)) return value;
  return value === null || value === undefined || value === "" ? [] : [value];
}

export function normalizeReferenceName(value) {
  const raw = value && typeof value === "object"
    ? value.path ?? value.name ?? value.value ?? ""
    : value;
  return String(raw ?? "")
    .replace(/^!/, "")
    .replace(/^\[\[|\]\]$/g, "")
    .split("|")[0]
    .split("#")[0]
    .trim()
    .replace(/\.md$/i, "")
    .split(/[\\/]/)
    .pop();
}

export function selectReferencedDefinitions({
  definitions,
  sceneData = {},
  sceneContent = "",
  targetConfig,
  selection = {}
}) {
  if (selection?.mode === "all") return definitions;

  const canonical = new Map(
    definitions.map(definition => [definition.name.toLowerCase(), definition.name])
  );
  const configuredFields = targetConfig.definitionConfig?.referenceFields;
  const fields = new Set([
    ...(Array.isArray(configuredFields) && configuredFields.length ? configuredFields : [targetConfig.key]),
    ...(Array.isArray(selection?.fields) ? selection.fields : []),
    `include${targetConfig.key[0].toUpperCase()}${targetConfig.key.slice(1)}`
  ]);
  const selected = new Set();

  for (const field of fields) {
    for (const value of asArray(sceneData[field])) {
      const name = canonical.get(normalizeReferenceName(value).toLowerCase());
      if (name) selected.add(name);
    }
  }

  if (selection?.includeLinked !== false) {
    const pattern = /!?\[\[([^\]]+)\]\]/g;
    let match;
    while ((match = pattern.exec(sceneContent)) !== null) {
      const name = canonical.get(normalizeReferenceName(match[1]).toLowerCase());
      if (name) selected.add(name);
    }
  }

  return definitions.filter(definition => selected.has(definition.name));
}
