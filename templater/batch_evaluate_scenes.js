module.exports = async (tp) => {
  const { execFileSync } = require("child_process");
  const path = require("path");

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

  const confirmed = await tp.system.suggester(
    [`Evaluate all scenes in ${folderPath}`, "Cancel"],
    ["yes", "no"]
  );

  if (confirmed !== "yes") {
    new Notice("Cancelled.");
    return "";
  }

  const metrics = ["Tension", "Relevance", "Resolution"];

  const files = app.vault
    .getMarkdownFiles()
    .filter(file => file.parent?.path === folderPath)
    .sort((a, b) => a.name.localeCompare(b.name));

  const basePath = app.vault.adapter.getBasePath();

  const evaluatorPath = path.join(
    basePath,
    "obsidianTools",
    "evaluators",
    "evaluate-scene-metric.mjs"
  );

  let success = 0;
  let failed = 0;

  for (const file of files) {
    const absoluteFilePath = path.join(basePath, file.path);

    for (const metric of metrics) {
      try {
        new Notice(`Evaluating ${file.name}: ${metric}`);

        execFileSync(
          "node",
          [evaluatorPath, absoluteFilePath, metric],
          {
            encoding: "utf8",
            cwd: path.join(basePath, "obsidianTools")
          }
        );

        success++;
      } catch (error) {
        failed++;
        console.error(`Failed: ${file.path} / ${metric}`);
        console.error(error.stdout?.toString() || "");
        console.error(error.stderr?.toString() || error.message);
      }
    }
  }

  new Notice(
    `Batch complete. ${success} succeeded, ${failed} failed.`
  );

  return "";
};
