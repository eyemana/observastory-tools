# Community plugin roadmap

Observastory can be distributed as an Obsidian community plugin, but the current proof of concept is not yet packaged as one.

## Recommended repository shape

Create a dedicated public plugin repository with the standard Obsidian TypeScript build:

- `manifest.json` at the repository root
- `README.md` and `LICENSE` at the repository root
- TypeScript source using the Obsidian API
- a production build that emits `main.js`
- optional `styles.css`
- `versions.json` when releases need different minimum Obsidian versions

The plugin should own the command palette, settings UI, status and progress views, queue lifecycle, content discovery, safe vault edits, and report installation or generation. Existing evaluator modules can be migrated or bundled behind that user-facing layer.

Because the POC uses Node.js filesystem and process facilities, the first plugin release should declare `isDesktopOnly: true` unless those dependencies are removed or isolated behind mobile-safe implementations.

## User-facing migration

The community plugin should replace POC setup steps with native experiences:

- command-palette actions instead of required Templater command notes
- an Observastory settings tab instead of hand-editing JSON for ordinary setup
- folder and entity-root pickers
- explicit progress, cancellation, and error notices
- Obsidian `Vault` and `FileManager` APIs for note edits and trash behavior
- first-run project setup that never overwrites existing author content

`Inline Embed References...` is a particularly good native-plugin command because Obsidian can resolve vault links, show a modal preflight, process notes safely, and use the user's configured trash behavior.

## Beta and directory release

Obsidian recommends BRAT for public beta testing before directory publication. For the official directory release:

1. Publish the source on GitHub.
2. Keep an accurate `manifest.json` at the default branch HEAD.
3. Create a GitHub release whose tag exactly matches the manifest's `x.y.z` version.
4. Attach `main.js`, `manifest.json`, and optional `styles.css` to that release.
5. Submit the GitHub repository through the Obsidian Community directory.
6. Address automated review findings in a new incremented release.

The plugin ID must be unique, lowercase with hyphens, must not contain `obsidian`, and cannot end in `plugin`.

Official references:

- [Build a plugin](https://docs.obsidian.md/Plugins/Getting%20started/Build%20a%20plugin)
- [Plugin manifest](https://docs.obsidian.md/Reference/Manifest)
- [Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)
- [Beta-testing plugins](https://docs.obsidian.md/Plugins/Releasing/Beta-testing%20plugins)
- [Plugin self-critique checklist](https://docs.obsidian.md/oo/plugin)

## Release gate

Before calling a build `1.0.0-beta.1` for testers, Observastory should have:

- a non-destructive first-run setup
- clear managed-root configuration
- the beta content model implemented and tested
- transactional preflight for destructive or wide-ranging edits
- queue cancellation and recovery behavior
- local-model and network-use disclosures
- a sample vault or guided tutorial separate from required plugin runtime files
- automated tests plus a disposable-vault integration test

For Community directory submission, use a three-component version such as `1.0.0`; Obsidian's submission documentation currently requires `x.y.z`. The release name can still identify it as the initial beta-quality public release, but BRAT is the cleaner channel for prerelease testing.
