module.exports = async () => {
  const { execFileSync } = require("child_process");
  const fs = require("fs");
  const path = require("path");

  function stripJsonComments(text) {
    let output = "";
    let inString = false;
    let escaped = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      const next = text[index + 1];

      if (inLineComment) {
        if (char === "\n" || char === "\r") {
          inLineComment = false;
          output += char;
        }

        continue;
      }

      if (inBlockComment) {
        if (char === "*" && next === "/") {
          inBlockComment = false;
          index++;
        }

        continue;
      }

      if (inString) {
        output += char;

        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }

        continue;
      }

      if (char === "\"") {
        inString = true;
        output += char;
        continue;
      }

      if (char === "/" && next === "/") {
        inLineComment = true;
        index++;
        continue;
      }

      if (char === "/" && next === "*") {
        inBlockComment = true;
        index++;
        continue;
      }

      output += char;
    }

    return output;
  }

  function parseJsonWithComments(text) {
    return JSON.parse(stripJsonComments(text));
  }

  function loadSchedulerConfig(toolsRoot) {
    const defaults = {
      nodePath: "node"
    };
    const localPath = path.join(toolsRoot, "config.local.json");
    const examplePath = path.join(toolsRoot, "config.example.json");
    const configPath = fs.existsSync(localPath) ? localPath : examplePath;

    if (!fs.existsSync(configPath)) {
      return defaults;
    }

    const config = parseJsonWithComments(fs.readFileSync(configPath, "utf8"));
    return {
      ...defaults,
      ...(config.scheduler ?? {})
    };
  }

  const basePath = app.vault.adapter.getBasePath();
  const toolsRoot = path.join(basePath, "observastoryTools");
  const scheduler = loadSchedulerConfig(toolsRoot);
  const nodePath = scheduler.nodePath || "node";
  const stopScript = path.join(toolsRoot, "scheduler", "stop-worker.mjs");

  try {
    const rawOutput = execFileSync(
      nodePath,
      [
        stopScript
      ],
      {
        encoding: "utf8",
        cwd: toolsRoot,
        windowsHide: true
      }
    );
    const outputLine = rawOutput.trim().split(/\r?\n/).filter(Boolean).pop();
    const result = JSON.parse(outputLine || "{}");

    if (result.status === "stopped") {
      new Notice("Background scheduler stopped.");
    } else if (result.status === "stop-requested") {
      new Notice("Scheduler stop requested.");
    } else if (result.status === "stale-lock-removed") {
      new Notice("Removed stale scheduler lock.");
    } else {
      new Notice("Background scheduler was not running.");
    }
  } catch (error) {
    new Notice("Failed to stop scheduler. See developer console.");
    console.error(error.stdout?.toString() || "");
    console.error(error.stderr?.toString() || error.message);
  }

  return "";
};
