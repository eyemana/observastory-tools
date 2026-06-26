module.exports = async () => {
  const { spawn } = require("child_process");
  const fs = require("fs");
  const path = require("path");

  function loadSchedulerConfig(toolsRoot) {
    const localPath = path.join(toolsRoot, "config.local.json");
    const examplePath = path.join(toolsRoot, "config.example.json");
    const configPath = fs.existsSync(localPath) ? localPath : examplePath;

    if (!fs.existsSync(configPath)) {
      return {
        nodePath: "node"
      };
    }

    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return {
      nodePath: "node",
      ...(config.scheduler ?? {})
    };
  }

  const basePath = app.vault.adapter.getBasePath();
  const toolsRoot = path.join(basePath, "obsidianTools");
  const scheduler = loadSchedulerConfig(toolsRoot);
  const nodePath = scheduler.nodePath || "node";
  const workerScript = path.join(toolsRoot, "scheduler", "worker.mjs");

  try {
    const child = spawn(
      nodePath,
      [
        workerScript,
        "--watch"
      ],
      {
        cwd: toolsRoot,
        detached: true,
        stdio: "ignore",
        windowsHide: true
      }
    );

    child.unref();
    new Notice("Background scheduler started.");
  } catch (error) {
    new Notice("Failed to start scheduler. See developer console.");
    console.error(error.stderr?.toString() || error.message);
  }

  return "";
};
