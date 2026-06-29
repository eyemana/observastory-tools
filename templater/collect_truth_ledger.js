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

  function loadNodePath(toolsRoot) {
    const localPath = path.join(toolsRoot, "config.local.json");
    const examplePath = path.join(toolsRoot, "config.example.json");
    const configPath = fs.existsSync(localPath) ? localPath : examplePath;

    if (!fs.existsSync(configPath)) {
      return "node";
    }

    const config = JSON.parse(stripJsonComments(fs.readFileSync(configPath, "utf8")));
    return config.scheduler?.nodePath ?? "node";
  }

  const basePath = app.vault.adapter.getBasePath();
  const toolsRoot = path.join(basePath, "obsidianTools");
  const nodePath = loadNodePath(toolsRoot);
  const scriptPath = path.join(toolsRoot, "truth", "collect-truth-ledger.mjs");

  try {
    const output = execFileSync(
      nodePath,
      [scriptPath, "--vault-root", basePath],
      {
        cwd: toolsRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      }
    ).trim();

    new Notice(output || "Truth Ledger collected.");
  } catch (error) {
    const message = [
      error.stdout?.toString().trim(),
      error.stderr?.toString().trim(),
      error.message
    ].filter(Boolean).join("\n");

    console.error(message);
    new Notice("Truth Ledger collection failed. See console for details.");
  }
};
