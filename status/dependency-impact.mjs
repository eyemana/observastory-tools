export function buildFragmentImpacts(sceneItems) {
  const byFragment = new Map();

  for (const item of sceneItems) {
    for (const fragmentPath of item.compositionDependencies ?? []) {
      const scenes = byFragment.get(fragmentPath) ?? new Set();
      scenes.add(item.path);
      byFragment.set(fragmentPath, scenes);
    }
  }

  return [...byFragment.entries()]
    .map(([fragmentPath, scenes]) => ({
      fragmentPath,
      scenes: [...scenes].sort((left, right) => left.localeCompare(right))
    }))
    .sort((left, right) => left.fragmentPath.localeCompare(right.fragmentPath));
}
