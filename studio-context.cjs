const path = require("path");

const { readConfig } = require("./report-catalog.cjs");

function vaultRelativePath(vaultRoot, configuredPath) {
  const absolutePath = path.isAbsolute(configuredPath)
    ? path.resolve(configuredPath)
    : path.resolve(vaultRoot, configuredPath);
  const relativePath = path.relative(vaultRoot, absolutePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Configured Observastory path is outside the vault: ${configuredPath}`);
  }

  return relativePath.replace(/\\/g, "/").replace(/\/$/, "");
}

function loadStudioContext(vaultRoot) {
  const toolsRoot = path.join(vaultRoot, "observastory-tools");
  const config = readConfig(toolsRoot);
  const storyRoot = vaultRelativePath(vaultRoot, config.story?.root ?? "");
  const scenesRoot = vaultRelativePath(
    vaultRoot,
    path.join(config.story?.root ?? "", config.story?.folders?.scenes ?? "Scenes")
  );
  const studioRoot = vaultRelativePath(
    vaultRoot,
    config.studio?.root ?? "Observastory Studio"
  );

  return {
    config,
    storyRoot,
    scenesRoot,
    studioRoot,
    toolsRoot
  };
}

module.exports = { loadStudioContext, vaultRelativePath };
