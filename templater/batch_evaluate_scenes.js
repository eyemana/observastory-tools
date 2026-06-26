module.exports = async (tp) => {
  const { execFileSync, spawn } = require("child_process");
  const fs = require("fs");
  const path = require("path");

  function loadConfig(toolsRoot) {
    const defaults = {
      scheduler: {
        mode: "manual",
        launchWorkerFromTemplater: true,
        nodePath: "node"
      }
    };
    const localPath = path.join(toolsRoot, "config.local.json");
    const examplePath = path.join(toolsRoot, "config.example.json");
    const configPath = fs.existsSync(localPath) ? localPath : examplePath;

    if (!fs.existsSync(configPath)) {
      return defaults;
    }

    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    config.scheduler = {
      ...defaults.scheduler,
      ...(config.scheduler ?? {})
    };
    return config;
  }

  const activeFile = app.workspace.getActiveFile();

  if (!activeFile) {
    new Notice("No active file.");
    return "";
  }

  const folderPath = activeFile.parent?.path;

  if (!folderPath) {
    new Notice("Could not determine active folder.");
    return "";
  }

  const files = app.vault
    .getMarkdownFiles()
    .filter(file => file.parent?.path === folderPath)
    .sort((a, b) => a.name.localeCompare(b.name));

  const confirmed = await tp.system.suggester(
    [`Queue evaluation for ${files.length} scenes in ${folderPath}`, "Cancel"],
    ["yes", "no"]
  );

  if (confirmed !== "yes") {
    new Notice("Cancelled.");
    return "";
  }

  const basePath = app.vault.adapter.getBasePath();
  const toolsRoot = path.join(basePath, "obsidianTools");
  const config = loadConfig(toolsRoot);
  const scheduler = config.scheduler ?? {};
  const nodePath = scheduler.nodePath || "node";
  const absoluteFolderPath = path.join(basePath, folderPath);
  const enqueueScript = path.join(toolsRoot, "scheduler", "enqueue-batch.mjs");
  const workerScript = path.join(toolsRoot, "scheduler", "worker.mjs");

  try {
    const rawOutput = execFileSync(
      nodePath,
      [
        enqueueScript,
        absoluteFolderPath,
        "--vault-root",
        basePath,
        "--source",
        "templater"
      ],
      {
        encoding: "utf8",
        cwd: toolsRoot,
        windowsHide: true
      }
    );

    const outputLine = rawOutput.trim().split(/\r?\n/).filter(Boolean).pop();
    const result = JSON.parse(outputLine);

    const shouldLaunchWorker =
      scheduler.mode !== "background" &&
      scheduler.launchWorkerFromTemplater !== false;

    if (shouldLaunchWorker) {
      const child = spawn(
        nodePath,
        [
          workerScript,
          "--drain"
        ],
        {
          cwd: toolsRoot,
          detached: true,
          stdio: "ignore",
          windowsHide: true
        }
      );

      child.unref();
      new Notice(`Queued batch ${result.jobId}. Scheduler started.`);
    } else {
      new Notice(`Queued batch ${result.jobId}. Background scheduler will pick it up.`);
    }
  } catch (error) {
    new Notice("Failed to queue batch evaluation. See developer console.");
    console.error(error.stdout?.toString() || "");
    console.error(error.stderr?.toString() || error.message);
  }

  return "";
};
