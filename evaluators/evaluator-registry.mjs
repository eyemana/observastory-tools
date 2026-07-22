export function createEvaluatorRegistry({ normalizeName, specialized = {}, fallback }) {
  if (typeof normalizeName !== "function" || typeof fallback !== "function") {
    throw new Error("Evaluator registry requires normalizeName and fallback functions.");
  }

  const evaluators = new Map(Object.entries(specialized));

  return {
    resolve(metricName) {
      return evaluators.get(normalizeName(metricName)) ?? fallback;
    }
  };
}
