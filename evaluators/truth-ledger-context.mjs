import fs from "fs";
import path from "path";

function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizePathKey(value) {
  return String(value ?? "").replace(/\\/g, "/").toLowerCase();
}

function claimEntities(claim) {
  const entities = Array.isArray(claim?.entities) ? claim.entities : [];
  return entities
    .map(entity => ({
      type: String(entity?.type ?? "").trim(),
      name: String(entity?.name ?? "").trim()
    }))
    .filter(entity => entity.type && entity.name);
}

function claimLegacyNames(claim, entityTypeKey, normalizeTargetName) {
  const values = Array.isArray(claim?.[entityTypeKey]) ? claim[entityTypeKey] : [];
  return values.map(normalizeTargetName).filter(Boolean);
}

function claimMatchesTarget(claim, entityTypeKey, targetName, normalizeTargetName) {
  const normalizedTarget = targetName.toLowerCase();

  if (claimEntities(claim).some(entity =>
    entity.type === entityTypeKey && entity.name.toLowerCase() === normalizedTarget
  )) {
    return true;
  }

  return claimLegacyNames(claim, entityTypeKey, normalizeTargetName)
    .some(name => name.toLowerCase() === normalizedTarget);
}

function supportRecordsForClaim(claim) {
  const support = Array.isArray(claim?.support) ? claim.support : [];

  if (support.length > 0) {
    return support;
  }

  if (!claim?.source?.path) {
    return [];
  }

  return [{
    type: claim.authority ?? "claim",
    path: claim.source.path,
    absolutePath: claim.source.absolutePath,
    line: claim.source.line,
    excerpt: claim.statement
  }];
}

function truncateForPrompt(value, maxLength = 260) {
  const text = normalizeWhitespace(value);
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

function formatSupportList(records) {
  if (!records.length) {
    return "None.";
  }

  return records.slice(0, 3).map(record => {
    const location = `${record.path ?? "(unknown)"}:${record.line ?? "?"}`;
    const excerpt = truncateForPrompt(record.excerpt ?? "");
    return excerpt ? `- ${location}: ${excerpt}` : `- ${location}`;
  }).join("\n");
}

function relationshipMatchesTarget(relationship, targetName) {
  const normalizedTarget = targetName.toLowerCase();
  return [relationship?.source, relationship?.target, relationship?.statement]
    .some(value => String(value ?? "").toLowerCase().includes(normalizedTarget));
}

function formatRelationshipList(relationships, targetName) {
  const matching = (Array.isArray(relationships) ? relationships : [])
    .filter(relationship => relationshipMatchesTarget(relationship, targetName))
    .slice(0, 3);

  if (!matching.length) {
    return "None.";
  }

  return matching.map(relationship => {
    const dimension = relationship.dimension ? ` (${relationship.dimension})` : "";
    const source = relationship.source || "?";
    const target = relationship.target || "?";
    const statement = relationship.statement
      ? `: ${truncateForPrompt(relationship.statement, 180)}`
      : "";
    return `- ${source} -> ${target}${dimension}${statement}`;
  }).join("\n");
}

export function createTruthLedgerContext({
  config,
  toolRoot,
  normalizeTargetName
}) {
  let cache;

  function readIndex() {
    if (cache !== undefined) {
      return cache;
    }

    const outputPath = config.truthLedger?.outputPath ?? ".index/truth-ledger.json";
    const ledgerPath = path.isAbsolute(outputPath)
      ? outputPath
      : path.join(toolRoot, outputPath);

    if (!fs.existsSync(ledgerPath)) {
      cache = null;
      return cache;
    }

    try {
      cache = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
    } catch {
      cache = null;
    }

    return cache;
  }

  function formatSupport(targetConfig, targetNames, visibleScenes, visibilityLabel) {
    const ledger = readIndex();

    if (!ledger) {
      return "Truth Ledger index is not available. Run Queue-Truth-Ledger to generate support-map context.";
    }

    const claims = [
      ...(Array.isArray(ledger.claims) ? ledger.claims : []),
      ...(Array.isArray(ledger.inferredClaims) ? ledger.inferredClaims : [])
    ];
    const visiblePaths = new Set(visibleScenes.map(scene => normalizePathKey(scene.path)));
    const blocks = [];

    for (const targetName of targetNames) {
      const matchingClaims = claims
        .filter(claim => claimMatchesTarget(
          claim,
          targetConfig.key,
          targetName,
          normalizeTargetName
        ))
        .slice(0, 5);

      if (!matchingClaims.length) {
        continue;
      }

      const authorSupport = [];
      const visibleSupport = [];
      const relationships = [];

      for (const claim of matchingClaims) {
        const support = supportRecordsForClaim(claim);
        authorSupport.push(...support);
        visibleSupport.push(...support.filter(record =>
          visiblePaths.has(normalizePathKey(record.path))
        ));
        relationships.push(...(Array.isArray(claim.relationships) ? claim.relationships : []));
      }

      blocks.push([
        `${targetConfig.label}: ${targetName}`,
        `${visibilityLabel}:`,
        formatSupportList(visibleSupport),
        "Author support, not necessarily visible to reader or character yet:",
        formatSupportList(authorSupport),
        "Relationships:",
        formatRelationshipList(relationships, targetName)
      ].join("\n"));
    }

    return blocks.length > 0
      ? blocks.join("\n\n---\n\n")
      : "No Truth Ledger support found for the listed targets.";
  }

  return { formatSupport, readIndex };
}
