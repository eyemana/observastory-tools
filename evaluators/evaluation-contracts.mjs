function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value === null || value === undefined || value === "") return [];
  return [value];
}

function contractEntries(section) {
  if (Array.isArray(section)) {
    return section.map((value, index) => ({ key: value?.key ?? `contract${index + 1}`, ...value }));
  }

  return Object.entries(section ?? {}).map(([key, value]) => ({ key, ...(value ?? {}) }));
}

function targetMatches(contract, targetConfig) {
  const targets = asArray(contract.targets);
  if (targets.length === 0 || targets.includes("*")) return true;
  const candidates = [
    targetConfig.key,
    targetConfig.target,
    targetConfig.label,
    targetConfig.pluralLabel
  ].map(normalize);
  return targets.some(target => candidates.includes(normalize(target)));
}

export function relationshipContracts(config) {
  return contractEntries(config.evaluation?.relationships)
    .filter(contract => contract.enabled !== false && contract.metric && contract.observer)
    .map(contract => ({
      dimension: contract.dimension ?? contract.key,
      valueKind: contract.valueKind ?? "delta",
      priorContext: contract.priorContext ?? null,
      truthVisibility: contract.truthVisibility ?? contract.priorContext ?? "readerOrder",
      ...contract,
      observer: {
        mode: "constant",
        key: "observer",
        type: "observer",
        name: "Observer",
        storageKey: "observer",
        ...(contract.observer ?? {})
      }
    }));
}

export function trajectoryContracts(config) {
  return contractEntries(config.evaluation?.trajectories)
    .filter(contract => contract.enabled !== false && contract.metric)
    .map(contract => ({
      dimension: contract.dimension ?? contract.key,
      priorContext: contract.priorContext ?? "readerOrder",
      truthVisibility: contract.truthVisibility ?? contract.priorContext ?? "readerOrder",
      ...contract
    }));
}

export function relationshipContractFor(config, metricName, targetConfig) {
  return relationshipContracts(config)
    .find(contract => normalize(contract.metric) === normalize(metricName) && targetMatches(contract, targetConfig));
}

export function trajectoryContractFor(config, metricName, targetConfig) {
  return trajectoryContracts(config)
    .find(contract => normalize(contract.metric) === normalize(metricName) && targetMatches(contract, targetConfig));
}

export function relationshipObserverTarget(contract) {
  if (contract?.observer?.mode !== "entities") return null;
  return contract.observer.target ?? contract.observer.entityType ?? contract.observer.key;
}

export function relationshipStorageKey(contract) {
  return contract?.observer?.storageKey ?? contract?.observer?.key ?? "observer";
}

