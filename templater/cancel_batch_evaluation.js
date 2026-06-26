module.exports = async (tp) => {
  const { execFileSync } = require("child_process");
  const fs = require("fs");
  const path = require("path");

  function loadSchedulerConfig(toolsRoot) {
    const defaults = {
      queueDir: ".queue",
      nodePath: "node"
    };
    const localPath = path.join(toolsRoot, "config.local.json");
    const examplePath = path.join(toolsRoot, "config.example.json");
    const configPath = fs.existsSync(localPath) ? localPath : examplePath;

    if (!fs.existsSync(configPath)) {
      return defaults;
    }

    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return {
      ...defaults,
      ...(config.scheduler ?? {})
    };
  }

  function readJsonFile(filePath) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      return null;
    }
  }

  function formatJobOption(job) {
    const progress = job.progress ?? {};
    const completed = Number(progress.completed) || 0;
    const total = Number(progress.total) || 0;
    const progressLabel = total > 0 ? `${completed}/${total}` : `${completed}`;
    const currentScene = progress.currentScene ? ` - ${progress.currentScene}` : "";

    return `${job.status} ${progressLabel}: ${job.id}${currentScene}`;
  }

  const basePath = app.vault.adapter.getBasePath();
  const toolsRoot = path.join(basePath, "obsidianTools");
  const scheduler = loadSchedulerConfig(toolsRoot);
  const queueDir = scheduler.queueDir || ".queue";
  const queueRoot = path.isAbsolute(queueDir)
    ? queueDir
    : path.join(toolsRoot, queueDir);
  const jobsDir = path.join(queueRoot, "jobs");

  if (!fs.existsSync(jobsDir)) {
    new Notice("No scheduler jobs found.");
    return "";
  }

  const jobs = fs.readdirSync(jobsDir)
    .filter(name => name.endsWith(".queued.json") || name.endsWith(".running.json"))
    .sort((a, b) => a.localeCompare(b))
    .map(name => readJsonFile(path.join(jobsDir, name)))
    .filter(Boolean);

  if (jobs.length === 0) {
    new Notice("No queued or running batch jobs.");
    return "";
  }

  const options = jobs.map(formatJobOption);
  const selectedJobId = await tp.system.suggester(
    [...options, "Cancel"],
    [...jobs.map(job => job.id), "cancel"]
  );

  if (!selectedJobId || selectedJobId === "cancel") {
    new Notice("Cancelled.");
    return "";
  }

  const cancelScript = path.join(toolsRoot, "scheduler", "cancel-job.mjs");
  const nodePath = scheduler.nodePath || "node";

  try {
    const rawOutput = execFileSync(
      nodePath,
      [
        cancelScript,
        selectedJobId,
        "--reason",
        "Cancelled from Obsidian."
      ],
      {
        encoding: "utf8",
        cwd: toolsRoot,
        windowsHide: true
      }
    );
    const outputLine = rawOutput.trim().split(/\r?\n/).filter(Boolean).pop();
    const result = JSON.parse(outputLine);

    new Notice(`Cancellation requested for ${result.jobId}.`);
  } catch (error) {
    new Notice("Failed to cancel batch job. See developer console.");
    console.error(error.stdout?.toString() || "");
    console.error(error.stderr?.toString() || error.message);
  }

  return "";
};
