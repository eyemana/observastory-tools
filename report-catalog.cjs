const fs = require("fs");
const path = require("path");

function stripJsonComments(text) {
  let output = "";
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const next = text[index + 1];
    if (lineComment) {
      if (char === "\n" || char === "\r") { lineComment = false; output += char; }
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") { blockComment = false; index++; }
      continue;
    }
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") { inString = true; output += char; continue; }
    if (char === "/" && next === "/") { lineComment = true; index++; continue; }
    if (char === "/" && next === "*") { blockComment = true; index++; continue; }
    output += char;
  }
  return output;
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function merge(base, override) {
  const result = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(override ?? {})) {
    result[key] = isObject(value) && isObject(result[key]) ? merge(result[key], value) : value;
  }
  return result;
}

function readConfig(toolsRoot) {
  const example = path.join(toolsRoot, "config.example.json");
  const local = path.join(toolsRoot, "config.local.json");
  const read = filePath => fs.existsSync(filePath)
    ? JSON.parse(stripJsonComments(fs.readFileSync(filePath, "utf8")))
    : {};
  return merge(read(example), read(local));
}

function camel(value) {
  const parts = String(value ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map(part => part.toLowerCase());
  return parts.map((part, index) =>
    index === 0 ? part : `${part[0].toUpperCase()}${part.slice(1)}`
  ).join("");
}

function words(value) {
  return String(value ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function normalize(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function asArray(value) {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

function entries(section) {
  return Array.isArray(section)
    ? section.map((value, index) => ({ key: value.key ?? `contract${index}`, ...value }))
    : Object.entries(section ?? {}).map(([key, value]) => ({ key, ...(value ?? {}) }));
}

function targetKey(config, targetName) {
  if (normalize(targetName) === "scene") return "scene";
  return Object.entries(config.story?.entityTypes ?? {}).find(([key, entity]) =>
    [key, entity.target, entity.label, entity.pluralLabel].some(value => normalize(value) === normalize(targetName))
  )?.[0] ?? camel(targetName);
}

function relationshipFor(config, metric, entityTypeKey) {
  return entries(config.evaluation?.relationships).find(contract => {
    if (contract.enabled === false || normalize(contract.metric) !== normalize(metric)) return false;
    const targets = asArray(contract.targets);
    return targets.length === 0 || targets.includes("*") || targets.some(value => normalize(value) === normalize(entityTypeKey));
  });
}

function trajectoryFor(config, metric, entityTypeKey) {
  return entries(config.evaluation?.trajectories).find(contract => {
    if (contract.enabled === false || normalize(contract.metric) !== normalize(metric)) return false;
    const targets = asArray(contract.targets);
    return targets.length === 0 || targets.includes("*") || targets.some(value => normalize(value) === normalize(entityTypeKey));
  });
}

function isObservation(value) {
  return isObject(value) && (
    typeof value.value === "number" || isObject(value.values) ||
    (value.dimension && value.metric) || typeof value.stateAfter === "string"
  );
}

function discoverActual(pages, addAxis) {
  for (const page of pages ?? []) {
    for (const [entityTypeKey, entities] of Object.entries(page?.ai?.observations ?? {})) {
      for (const entity of Object.values(entities ?? {})) {
        for (const [dimensionKey, value] of Object.entries(entity ?? {})) {
          if (isObservation(value)) {
            addAxis(entityTypeKey, dimensionKey, value.valueKind, value.metric);
            continue;
          }
          for (const [observerBucket, observerValue] of Object.entries(value ?? {})) {
            if (isObservation(observerValue)) {
              addAxis(entityTypeKey, dimensionKey, observerValue.valueKind, observerValue.metric, observerBucket);
              continue;
            }
            for (const nested of Object.values(observerValue ?? {})) {
              if (isObservation(nested)) {
                addAxis(entityTypeKey, dimensionKey, nested.valueKind, nested.metric, observerBucket);
              }
            }
          }
        }
      }
    }
  }
}

function buildReportCatalog(config, pages = []) {
  const axes = new Map();
  const entityConfigs = config.story?.entityTypes ?? {};
  const addAxis = (entityTypeKey, dimensionKey, valueKind = "delta", metric, observer) => {
    const key = `${entityTypeKey}:${dimensionKey}:${observer ?? ""}`;
    const current = axes.get(key) ?? {
      entityTypeKey,
      dimensionKey,
      label: words(metric ?? dimensionKey),
      valueKind: valueKind ?? "delta",
      observers: []
    };
    if (observer && !current.observers.includes(observer)) current.observers.push(observer);
    axes.set(key, current);
  };

  for (const evaluation of config.scheduler?.evaluations ?? []) {
    const [metric, target] = evaluation;
    const entityTypeKey = targetKey(config, target);
    const relationship = relationshipFor(config, metric, entityTypeKey);
    const trajectory = trajectoryFor(config, metric, entityTypeKey);
    if (relationship) {
      addAxis(
        entityTypeKey,
        camel(relationship.dimension ?? relationship.key),
        relationship.valueKind ?? "delta",
        metric,
        relationship.observer?.storageKey ?? relationship.observer?.key
      );
    } else if (trajectory) {
      addAxis(entityTypeKey, camel(trajectory.dimension ?? trajectory.key), "movement", metric);
    } else {
      const settings = Object.entries(config.standardMetrics?.metrics ?? {})
        .find(([name]) => normalize(name) === normalize(metric))?.[1] ?? {};
      addAxis(entityTypeKey, camel(metric), settings.valueKind ?? (entityTypeKey === "scene" ? "score" : "delta"), metric);
    }
  }

  discoverActual(pages, addAxis);
  const axisList = [...axes.values()].sort((a, b) =>
    a.entityTypeKey.localeCompare(b.entityTypeKey) || a.dimensionKey.localeCompare(b.dimensionKey)
  );
  const dimensions = {};
  for (const axis of axisList) {
    dimensions[axis.dimensionKey] = dimensions[axis.dimensionKey] ?? {
      key: axis.dimensionKey,
      label: axis.label,
      valueKind: axis.valueKind
    };
  }
  const entityTypeKeys = [...new Set(axisList.map(axis => axis.entityTypeKey))];
  const entityTypes = entityTypeKeys.map(key => {
    const entity = key === "scene" ? {} : entityConfigs[key] ?? {};
    const ownAxes = axisList.filter(axis => axis.entityTypeKey === key);
    return {
      key,
      label: entity.pluralLabel ? words(entity.pluralLabel) : key === "scene" ? "Scenes" : words(key),
      singular: entity.label ? words(entity.label) : key === "scene" ? "Scene" : words(key),
      dimensions: [...new Set(ownAxes.map(axis => axis.dimensionKey))],
      observers: [...new Set(ownAxes.flatMap(axis => axis.observers))],
      observersByDimension: Object.fromEntries(
        [...new Set(ownAxes.map(axis => axis.dimensionKey))].map(dimensionKey => [
          dimensionKey,
          [...new Set(ownAxes.filter(axis => axis.dimensionKey === dimensionKey).flatMap(axis => axis.observers))]
        ])
      )
    };
  });
  const heatmaps = Object.values(dimensions).map((dimension, index) => {
    const matching = axisList.filter(axis => axis.dimensionKey === dimension.key);
    const entityKeys = matching.map(axis => axis.entityTypeKey);
    const rows = entityKeys.map(key => {
      const type = entityTypes.find(entity => entity.key === key);
      return { label: type?.singular ?? words(key), observationEntityTypes: [key] };
    });
    if (entityKeys.length > 1) rows.push({ label: "Average", observationEntityTypes: entityKeys });
    return {
      ...dimension,
      hasObservers: matching.some(axis => axis.observers.length > 0),
      color: ["green", "red", "blue", "amber", "cyan"][index % 5],
      rows
    };
  });
  const columns = axisList.map(axis => ({
    label: `${axis.label} ${axis.valueKind}`,
    dimension: axis.dimensionKey,
    valueKind: axis.valueKind,
    observer: axis.observers.length === 1 ? axis.observers[0] : undefined,
    observationEntityTypes: [axis.entityTypeKey]
  }));
  return { axes: axisList, dimensions, entityTypes, heatmaps, columns };
}

function loadReportCatalog({ toolsRoot, pages = [] }) {
  return buildReportCatalog(readConfig(toolsRoot), pages);
}

module.exports = { buildReportCatalog, loadReportCatalog, readConfig, stripJsonComments };
