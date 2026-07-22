import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function canonicalText(value) {
  return normalizeWhitespace(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g, "$1")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function canonicalClaimKey(claim) {
  const identity = `${canonicalText(claim?.subject)}\n${canonicalText(claim?.statement)}`;
  return crypto.createHash("sha256").update(identity).digest("hex").slice(0, 20);
}

export function consolidateClaims(authoredClaims = [], inferredClaims = []) {
  const groups = new Map();
  const ordered = [
    ...authoredClaims.map(claim => ({ ...claim, authority: claim.authority ?? "author" })),
    ...inferredClaims.map(claim => ({ ...claim, authority: claim.authority ?? "inferred" }))
  ];

  for (const claim of ordered) {
    const semanticKey = canonicalClaimKey(claim);
    const group = groups.get(semanticKey) ?? {
      id: `claim.${semanticKey}`,
      semanticKey,
      subject: claim.subject ?? "",
      statement: claim.statement ?? "",
      authority: claim.authority,
      truthValues: [],
      entities: [],
      relationships: [],
      occurrences: []
    };
    if (!group.truthValues.includes(claim.truth)) group.truthValues.push(claim.truth);
    group.occurrences.push({
      claimId: claim.id,
      authority: claim.authority,
      truth: claim.truth,
      confidence: claim.confidence,
      source: claim.source,
      support: claim.support ?? []
    });
    for (const entity of claim.entities ?? []) {
      if (!group.entities.some(existing =>
        existing.type === entity.type && existing.name === entity.name
      )) group.entities.push(entity);
    }
    for (const relationship of claim.relationships ?? []) {
      const key = JSON.stringify(relationship);
      if (!group.relationships.some(existing => JSON.stringify(existing) === key)) {
        group.relationships.push(relationship);
      }
    }
    if (group.authority !== "author" && claim.authority === "author") {
      group.authority = "author";
      group.subject = claim.subject ?? group.subject;
      group.statement = claim.statement ?? group.statement;
    }
    groups.set(semanticKey, group);
  }

  return [...groups.values()]
    .map(group => ({
      ...group,
      occurrenceCount: group.occurrences.length,
      hasConflict: group.truthValues.length > 1
    }))
    .sort((left, right) =>
      left.subject.localeCompare(right.subject) || left.statement.localeCompare(right.statement)
    );
}

function lineForExcerpt(content, excerpt) {
  const direct = content.indexOf(excerpt);
  if (direct >= 0) return content.slice(0, direct).split(/\r?\n/).length;
  const normalizedExcerpt = normalizeWhitespace(excerpt);
  if (!normalizedExcerpt) return null;
  const lines = content.split(/\r?\n/);
  for (let start = 0; start < lines.length; start++) {
    let combined = "";
    for (let end = start; end < Math.min(lines.length, start + 12); end++) {
      combined = normalizeWhitespace(`${combined} ${lines[end]}`);
      if (combined.includes(normalizedExcerpt)) return start + 1;
      if (combined.length > normalizedExcerpt.length * 3 + 200) break;
    }
  }
  return null;
}

export function locateComposedEvidence({ scenePath, dependencies = [], excerpt, vaultRoot }) {
  const candidates = [...dependencies, scenePath].map(candidate => path.resolve(candidate));
  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    const content = matter(fs.readFileSync(filePath, "utf8")).content;
    const line = lineForExcerpt(content, excerpt);
    if (line === null) continue;
    return {
      path: path.relative(vaultRoot, filePath),
      absolutePath: filePath,
      line,
      kind: filePath === path.resolve(scenePath) ? "scene" : "fragment"
    };
  }
  return null;
}

export function attachComposedEvidenceProvenance(claim, source, vaultRoot) {
  if (source?.kind !== "scene") return claim;
  const dependencies = source.dependencies ?? [];
  claim.support = (claim.support ?? []).map(record => {
    const origin = locateComposedEvidence({
      scenePath: source.path,
      dependencies,
      excerpt: record.excerpt,
      vaultRoot
    });
    return origin ? { ...record, composedFrom: origin } : record;
  });
  return claim;
}
