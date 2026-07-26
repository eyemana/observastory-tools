function normalizeClaimIdentity(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function validateClaimIds(claims) {
  const errors = [];
  const seen = new Map();

  for (const claim of claims) {
    const where = `${claim.source?.path ?? "(unknown)"}:${claim.source?.line ?? "?"}`;

    if (!claim.id) {
      errors.push(`Claim is missing an id at ${where}`);
      continue;
    }

    const signature = JSON.stringify({
      truth: claim.truth,
      subject: normalizeClaimIdentity(claim.subject),
      statement: normalizeClaimIdentity(claim.statement)
    });
    const previous = seen.get(claim.id);

    if (previous && previous.signature !== signature) {
      errors.push(
        `Conflicting claim id "${claim.id}" at ${where}; its truth, subject, or statement differs from ${previous.where}`
      );
    } else if (!previous) {
      seen.set(claim.id, { signature, where });
    }
  }

  return errors;
}
