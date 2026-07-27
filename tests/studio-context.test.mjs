import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { vaultRelativePath } = require("../studio-context.cjs");

test("studio paths resolve within the vault independently of the story root", () => {
  const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "observastory-studio-"));

  try {
    assert.equal(
      vaultRelativePath(vaultRoot, "Example Book/Scenes"),
      "Example Book/Scenes"
    );
    assert.equal(
      vaultRelativePath(vaultRoot, "ObservaStory"),
      "ObservaStory"
    );
    assert.throws(
      () => vaultRelativePath(vaultRoot, path.resolve(vaultRoot, "..", "Archive")),
      /outside the vault/
    );
  } finally {
    fs.rmSync(vaultRoot, { recursive: true, force: true });
  }
});
