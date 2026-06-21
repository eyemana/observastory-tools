module.exports = async (tp) => {
  const path = await tp.system.prompt("Frontmatter path to delete", "");

  if (!path) {
    new Notice("Cancelled.");
    return "";
  }

  const file = app.workspace.getActiveFile();

  if (!file) {
    new Notice("No active file.");
    return "";
  }

  const parts = path.split(".").filter(Boolean);

  let deleted = false;

  await app.fileManager.processFrontMatter(file, (fm) => {
    let obj = fm;

    for (let i = 0; i < parts.length - 1; i++) {
      obj = obj?.[parts[i]];
      if (!obj || typeof obj !== "object") return;
    }

    const key = parts[parts.length - 1];

    if (obj && Object.prototype.hasOwnProperty.call(obj, key)) {
      delete obj[key];
      deleted = true;
    }
  });

  if (deleted) {
    new Notice(`Deleted "${path}" from ${file.path}.`);
  } else {
    new Notice(`Path "${path}" not found in ${file.path}.`);
  }

  return "";
};