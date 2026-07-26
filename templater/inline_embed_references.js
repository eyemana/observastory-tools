module.exports = async (tp) => {
  const fs = require("fs");
  const path = require("path");
  const { pathToFileURL } = require("url");
  const { Modal, Notice, Setting, TFile } = require("obsidian");

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
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === "\"") inString = false;
        continue;
      }

      if (char === "\"") {
        inString = true;
        output += char;
      } else if (char === "/" && next === "/") {
        inLineComment = true;
        index++;
      } else if (char === "/" && next === "*") {
        inBlockComment = true;
        index++;
      } else {
        output += char;
      }
    }

    return output;
  }

  function loadConfig(toolsRoot) {
    const localPath = path.join(toolsRoot, "config.local.json");
    const examplePath = path.join(toolsRoot, "config.example.json");
    const configPath = fs.existsSync(localPath) ? localPath : examplePath;

    if (!fs.existsSync(configPath)) {
      throw new Error("Observastory configuration was not found.");
    }

    return JSON.parse(stripJsonComments(fs.readFileSync(configPath, "utf8")));
  }

  function normalizeVaultPath(value) {
    return String(value ?? "")
      .replace(/\\/g, "/")
      .replace(/^\/+|\/+$/g, "");
  }

  function vaultPathFromConfigured(configuredPath, storyRoot, vaultBasePath) {
    const candidate = String(configuredPath ?? "").trim();
    const configuredStoryRoot = String(storyRoot ?? "").trim();
    const absoluteCandidate = path.isAbsolute(candidate)
      ? candidate
      : path.isAbsolute(configuredStoryRoot)
        ? path.join(configuredStoryRoot, candidate)
        : path.join(vaultBasePath, configuredStoryRoot, candidate);

    if (path.isAbsolute(absoluteCandidate)) {
      const relative = path.relative(vaultBasePath, absoluteCandidate);
      return relative.startsWith("..") || path.isAbsolute(relative)
        ? null
        : normalizeVaultPath(relative);
    }

    return null;
  }

  function managedRoots(config, vaultBasePath) {
    const story = config.story ?? {};
    const storyRoot = story.root ?? "";
    const roots = new Set();

    for (const configuredPath of Object.values(story.folders ?? {})) {
      const resolved = vaultPathFromConfigured(configuredPath, storyRoot, vaultBasePath);
      if (resolved) roots.add(resolved);
    }

    for (const entityType of Object.values(story.entityTypes ?? {})) {
      for (const configuredPath of entityType.paths ?? []) {
        const resolved = vaultPathFromConfigured(configuredPath, storyRoot, vaultBasePath);
        if (resolved) roots.add(resolved);
      }
    }

    return [...roots].sort((left, right) => left.localeCompare(right));
  }

  function pathIsManaged(filePath, roots) {
    const normalized = normalizeVaultPath(filePath).toLowerCase();
    return roots.some(root => {
      const normalizedRoot = normalizeVaultPath(root).toLowerCase();
      return normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}/`);
    });
  }

  function countOccurrences(changes) {
    return changes.reduce((total, change) => total + change.occurrences.length, 0);
  }

  function showPreflight(plan) {
    return new Promise(resolve => {
      let settled = false;

      class InlineEmbedPreflightModal extends Modal {
        onOpen() {
          const { contentEl } = this;
          contentEl.empty();
          contentEl.createEl("h2", { text: "Inline embed references" });
          contentEl.createEl("p", {
            text: `Source to remove after successful replacement: ${plan.sourcePath}`
          });
          contentEl.createEl("p", {
            text: `${plan.managedOccurrenceCount} managed reference(s) in ${plan.managedChanges.length} note(s) will be replaced.`
          });

          if (plan.errors.length > 0) {
            contentEl.createEl("h3", { text: "Cannot continue" });
            contentEl.createEl("p", {
              text: "No notes have been changed. Resolve these references and run the command again:"
            });
            const errorList = contentEl.createEl("ul");
            for (const error of plan.errors) {
              errorList.createEl("li", {
                text: `${error.path}: ${error.raw} — ${error.message}`
              });
            }
          }

          const includedOutsidePaths = new Set();

          if (plan.outsideChanges.length > 0) {
            contentEl.createEl("h3", { text: "References outside configured folders" });
            contentEl.createEl("p", {
              text: "Unchecked references will be left unchanged and will become hanging embeds when the source is removed."
            });

            for (const change of plan.outsideChanges) {
              new Setting(contentEl)
                .setName(change.path)
                .setDesc(`${change.occurrences.length} embed reference(s)`)
                .addToggle(toggle => toggle
                  .setValue(false)
                  .onChange(value => {
                    if (value) includedOutsidePaths.add(change.path);
                    else includedOutsidePaths.delete(change.path);
                  }));
            }
          }

          if (plan.managedChanges.length > 0) {
            contentEl.createEl("h3", { text: "Configured-folder destinations" });
            const destinationList = contentEl.createEl("ul");
            for (const change of plan.managedChanges) {
              destinationList.createEl("li", {
                text: `${change.path} (${change.occurrences.length})`
              });
            }
          }

          const buttons = contentEl.createDiv({ cls: "modal-button-container" });
          const cancel = buttons.createEl("button", { text: "Cancel" });
          cancel.addEventListener("click", () => this.close());

          if (plan.errors.length === 0 && plan.managedChanges.length > 0) {
            const confirm = buttons.createEl("button", {
              text: "Inline references and trash source",
              cls: "mod-cta"
            });
            confirm.addEventListener("click", () => {
              settled = true;
              resolve({
                confirmed: true,
                includedOutsidePaths: [...includedOutsidePaths]
              });
              this.close();
            });
          }
        }

        onClose() {
          this.contentEl.empty();
          if (!settled) {
            settled = true;
            resolve({ confirmed: false, includedOutsidePaths: [] });
          }
        }
      }

      new InlineEmbedPreflightModal(app).open();
    });
  }

  async function rollbackChanges(appliedChanges) {
    const failures = [];

    for (const change of [...appliedChanges].reverse()) {
      const file = app.vault.getAbstractFileByPath(change.path);
      if (!(file instanceof TFile)) continue;

      try {
        await app.vault.process(file, current => {
          if (current !== change.updatedContent) {
            throw new Error("note changed again before rollback");
          }
          return change.originalContent;
        });
      } catch (error) {
        failures.push(`${change.path}: ${error.message}`);
      }
    }

    return failures;
  }

  const vaultBasePath = app.vault.adapter.getBasePath();
  const toolsRoot = path.join(vaultBasePath, "observastory-tools");
  const config = loadConfig(toolsRoot);
  const roots = managedRoots(config, vaultBasePath);
  const modulePath = path.join(toolsRoot, "inline-embed-references.mjs");
  const {
    buildInlineEmbedPlan,
    findEmbedOccurrences
  } = await import(`${pathToFileURL(modulePath).href}?mtime=${fs.statSync(modulePath).mtimeMs}`);
  const markdownFiles = app.vault.getMarkdownFiles();
  const notes = await Promise.all(markdownFiles.map(async file => ({
    file,
    path: file.path,
    managed: pathIsManaged(file.path, roots),
    content: await app.vault.cachedRead(file)
  })));

  function resolveTarget(noteTarget, fromPath) {
    if (!noteTarget) return fromPath;
    return app.metadataCache.getFirstLinkpathDest(noteTarget, fromPath)?.path ?? null;
  }

  const candidates = new Map();

  for (const note of notes.filter(item => item.managed)) {
    for (const occurrence of findEmbedOccurrences(note.content)) {
      const resolvedPath = resolveTarget(occurrence.note, note.path);
      if (!resolvedPath || resolvedPath === note.path) continue;
      const resolvedFile = app.vault.getAbstractFileByPath(resolvedPath);
      if (!(resolvedFile instanceof TFile) || resolvedFile.extension !== "md") continue;

      const entry = candidates.get(resolvedPath) ?? {
        path: resolvedPath,
        count: 0,
        forms: new Set()
      };
      entry.count++;
      entry.forms.add(occurrence.raw);
      candidates.set(resolvedPath, entry);
    }
  }

  const choices = [...candidates.values()].sort((left, right) =>
    left.path.localeCompare(right.path)
  );

  if (choices.length === 0) {
    new Notice("No embed references were found in configured folders.");
    return "";
  }

  const selectedPath = await tp.system.suggester(
    choices.map(choice =>
      `${choice.path} — ${choice.count} managed reference(s), ${choice.forms.size} form(s)`
    ),
    choices.map(choice => choice.path),
    false,
    "Select an embed source to inline"
  );

  if (!selectedPath) {
    new Notice("Cancelled. No notes were changed.");
    return "";
  }

  const source = notes.find(note => note.path === selectedPath);

  if (!source) {
    new Notice(`Embed source not found: ${selectedPath}`);
    return "";
  }

  const plan = buildInlineEmbedPlan({
    sourcePath: selectedPath,
    sourceContent: source.content,
    notes,
    resolveTarget
  });
  const decision = await showPreflight(plan);

  if (!decision.confirmed) {
    new Notice("Cancelled. No notes were changed.");
    return "";
  }

  const includedOutsidePaths = new Set(decision.includedOutsidePaths);
  const chosenChanges = [
    ...plan.managedChanges,
    ...plan.outsideChanges.filter(change => includedOutsidePaths.has(change.path))
  ];
  const appliedChanges = [];

  try {
    for (const change of chosenChanges) {
      const file = app.vault.getAbstractFileByPath(change.path);

      if (!(file instanceof TFile)) {
        throw new Error(`Destination note disappeared: ${change.path}`);
      }

      await app.vault.process(file, current => {
        if (current !== change.originalContent) {
          throw new Error(`Destination note changed after preflight: ${change.path}`);
        }
        return change.updatedContent;
      });
      appliedChanges.push(change);
    }

    const sourceFile = app.vault.getAbstractFileByPath(selectedPath);
    if (!(sourceFile instanceof TFile)) {
      throw new Error(`Source note disappeared: ${selectedPath}`);
    }

    const currentSource = await app.vault.read(sourceFile);
    if (currentSource !== source.content) {
      throw new Error(`Source note changed after preflight: ${selectedPath}`);
    }

    await app.fileManager.trashFile(sourceFile);
  } catch (error) {
    const rollbackFailures = await rollbackChanges(appliedChanges);
    const suffix = rollbackFailures.length > 0
      ? ` Rollback also failed for: ${rollbackFailures.join("; ")}`
      : " Applied destination changes were rolled back.";
    new Notice(`Inlining failed: ${error.message}.${suffix}`, 15000);
    return "";
  }

  const occurrenceCount = countOccurrences(chosenChanges);
  const omittedOutside = plan.outsideChanges.filter(
    change => !includedOutsidePaths.has(change.path)
  );
  const hangingWarning = omittedOutside.length > 0
    ? ` ${countOccurrences(omittedOutside)} out-of-scope embed(s) were deliberately left hanging.`
    : "";

  new Notice(
    `Inlined ${occurrenceCount} reference(s) in ${chosenChanges.length} note(s) and moved ${selectedPath} to trash.${hangingWarning}`,
    12000
  );
  return "";
};
