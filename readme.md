# ObservaStory Tools

Reusable Node and Obsidian Templater tools for ObservaStory scene evaluation, queueing, chronology indexing, Truth Ledger collection, and Dataview report support.

The tools evaluate **scene notes**. Storyboard can group scenes into chapters for planning, but chapter blocks are a writer-controlled organization layer over scene notes.

## Package Recommendation

Use `observastory-tools` for the repository, package name, and installed vault folder. Keeping one kebab-case name across GitHub, submodules, documentation, and Obsidian paths avoids a whole class of setup mistakes.

## Install In An Obsidian Vault

1. Install Node.js 20 or newer and make sure `node` is available on PATH.
2. Install and enable these Obsidian community plugins: Templater, Dataview, and Charts for chart-based reports.
3. Clone or copy this tools folder into the vault root as `observastory-tools`.
4. From a terminal in `observastory-tools`, run:

```sh
npm install
```

5. Copy `config.example.json` to `config.local.json` and adjust the model, Ollama URL, and story paths for your vault.
6. In Obsidian Templater settings, set the user scripts folder to `observastory-tools/templater`.
7. Put the command templates in a vault-level `Templates` folder, or point Obsidian at the folder where you keep them.
8. For the POC book, keep the example content at `Example Book - A Ledger for Maribel Leigh` in the vault root.

A minimal POC layout looks like this:
```text
Your Vault/
  Templates/
  observastory-tools/
    config.local.json
    templater/
    scheduler/
    evaluators/
  Example Book - A Ledger for Maribel Leigh/
    Scenes/
    Characters/
    Plot Threads/
    Arcs/
    Story Engines/
    Reports/
```

## Configure The Example Book


For `A Ledger for Maribel Leigh`, start from `config.example.json`. The important idea is:

- the **vault root** is the Obsidian vault folder
- the **story root** is the book folder inside the vault
- named story folders live inside that story root unless you override them

For the tutorial, the story config looks like this:

```json
"story": {
  "root": "Example Book - A Ledger for Maribel Leigh",
  "folders": {
    "scenes": "Scenes",
    "characters": "Characters",
    "plotThreads": "Plot Threads",
    "storyEngines": "Story Engines",
    "arcs": "Arcs",
    "metrics": "Metrics",
    "reports": "Reports",
    "notes": "Notes"
  },
  "entityTypes": {
    "characters": {
      "target": "Character",
      "folderKeys": ["characters"],
      "label": "character",
      "pluralLabel": "characters"
    },
    "plotThreads": {
      "target": "Plot Thread",
      "folderKeys": ["plotThreads"],
      "label": "plot thread",
      "pluralLabel": "plot threads"
    },
    "storyEngines": {
      "target": "Story Engine",
      "folderKeys": ["storyEngines"],
      "label": "story engine",
      "pluralLabel": "story engines"
    },
    "arcs": {
      "target": "Arc",
      "folderKeys": ["arcs"],
      "label": "arc",
      "pluralLabel": "arcs"
    }
  }
}
```

`story.folders` names the writer-facing folders. `story.entityTypes` tells evaluators which configured folders count as characters, plot threads, story engines, and arcs. If a project spreads one entity type across multiple places, set `folderKeys` to multiple folder keys or use explicit `paths`.

Crawler settings refer to those same folder keys:

```json
"truthLedger": {
  "folders": ["notes", "arcs", "storyEngines", "plotThreads", "characters", "scenes"]
},
"chronology": {
  "folders": ["scenes"]
}
```

That keeps folder names in one place: change `story.folders.scenes`, and every tool using the `scenes` key follows it.

Project calibration is controlled separately:

```json
"projectMode": "draft",
"calibration": {
  "modes": {
    "outline": {
      "guidance": "The project is in outline mode. Treat notes, placeholders, and planned outcomes as low-confidence signals unless the scene text clearly dramatizes them.",
      "scoreCeilings": {
        "Resolution": 3.5,
        "readerAwareness": {
          "delta": 5,
          "confidence": 5
        },
        "characterAwareness": {
          "delta": 5,
          "confidence": 5
        }
      }
    }
  }
}
```

Set `projectMode` to `outline` when you are sketching scenes and want conservative charts. Scalar score ceilings use the evaluator's 0-10 scale, so `Resolution: 3.5` appears as roughly 35% in reports that display percentages. Awareness ceilings can cap individual fields such as `delta` and `confidence`. Default `draft` mode does not cap scores.

## Quick Start

From Obsidian, use these Templater templates:

- `Templates/Queue-Evaluation-All-Scenes.md`: queue the full configured evaluation set for every scene in the configured story scenes folder.
- `Templates/Queue-Evaluation-Current-Scene.md`: queue the full configured evaluation set for only the active scene.
- `Templates/Queue-Evaluation-Reader-Awareness.md`: rerun only Reader Awareness after changing scene order.
- `Templates/Queue-Chronology-Index.md`: queue a throttled chronology index pass.
- `Templates/Queue-Truth-Ledger.md`: queue a throttled Truth Ledger crawl.
- `Templates/Queue-Stale-Work.md`: queue only work that Processing Status can identify as stale, missing, or legacy.
- `Templates/Queue-Cancel-Job.md`: cancel the latest queued or running job.
- `Templates/Scheduler-Start.md`: start a background scheduler worker.
- `Templates/Scheduler-Status.md`: show worker and active-job status, and refresh `observastory-tools/.index/processing-status.json`.
- `Templates/Scheduler-Stop-After-Current.md`: let the current job finish, then stop the worker.
- `Templates/Scheduler-Stop.md`: stop the background scheduler worker immediately.

From a terminal in `observastory-tools`:

To enqueue the full scene evaluation queue:

```sh
node scheduler/enqueue-scene-evaluations.mjs "C:\path\to\your\vault\Example Book - A Ledger for Maribel Leigh\Scenes" --vault-root "C:\path\to\your\vault"
node scheduler/worker.mjs --drain
```

When `story.root` and `story.folders.scenes` are configured, the scenes folder argument can be omitted:

```sh
node scheduler/enqueue-scene-evaluations.mjs --vault-root "C:\path\to\your\vault"
node scheduler/worker.mjs --drain
```

To enqueue the Truth Ledger crawl:

```sh
node scheduler/enqueue-truth-ledger.mjs --vault-root "C:\path\to\your\vault"
node scheduler/worker.mjs --drain
```

To enqueue the Chronology Index:

```sh
node scheduler/enqueue-chronology-index.mjs --vault-root "C:\path\to\your\vault"
node scheduler/worker.mjs --drain
```

To enqueue only Reader Awareness:

```sh
node scheduler/enqueue-scene-evaluations.mjs --vault-root "C:\path\to\your\vault" --preset reader-awareness
```

To enqueue only scenes tagged for a pass:

```sh
node scheduler/enqueue-scene-evaluations.mjs --vault-root "C:\path\to\your\vault" --scene-tag revision-pass-2
```

To enqueue with a named evaluation profile from `config.local.json`:

```sh
node scheduler/enqueue-scene-evaluations.mjs --vault-root "C:\path\to\your\vault" --profile harborExperiment
```

To enqueue the full configured evaluation set for one scene:

```sh
node scheduler/enqueue-scene-evaluations.mjs "C:\path\to\your\vault\Example Book - A Ledger for Maribel Leigh\Scenes" --vault-root "C:\path\to\your\vault" --scene "C:\path\to\your\vault\Example Book - A Ledger for Maribel Leigh\Scenes\Inventory Day.md"
```

To process one scene directly:

```sh
node evaluators/evaluate-scene.mjs "C:\path\to\your\vault\Example Book - A Ledger for Maribel Leigh\Scenes\Inventory Day.md" "Tension" "Character"
```

## Scene Frontmatter

Scene notes are the canonical evaluated units. The evaluator scores every eligible character, plot thread, story engine, or arc note against selected scenes by default. Per-scene story-element lists are optional metadata for planning surfaces such as Storyboard, not required evaluator input.

```yaml
---
chapter_order: 1
scene_order: 1
chronology_label: "July 28, 2026, 7:15:03.192 PM"
chronology_value: "2026-07-28T19:15:03.192"
pov: Mara Bell
---
```

`chapter_order`, `scene_order`, `chronology_label`, and `chronology_value` are writer-authored structure fields. The generated sortable chronology value belongs under `ai.chronology`.
Scene identity comes from the filename without the `.md` extension.

- `chapter_order`: the chapter's position in the book/story, and the field Storyboard uses to group scenes into chapter blocks.
- `scene_order`: the scene's position inside that chapter.
- `chronology_label`: the human-readable chronology display text.
- `chronology_value`: the author-maintained chronology value. Supported starting forms include ISO timestamps such as `2026-07-28T19:15:03.192`, relative durations such as `-4000000000 years`, and scaled phrases such as `4 billion years before story present`.
- `tags`: optional Obsidian tags. Evaluation profiles can use scene tags to decide which scenes to queue. The default profile skips scenes tagged `no-evaluate` or `exclude-evaluation`.
- `chapter`: optional label/title metadata if you want it later; Storyboard does not require it for grouping.

Story-element kind comes from folder location, and story-element identity comes from the filename without the `.md` extension. Story-element notes can use `status` and `tags` for filtering. The default profile includes all element notes except those with excluded statuses such as `draft`, `archived`, or `inactive`, or excluded tags such as `no-evaluate`.

Scene-level entity attention comes from Obsidian links. Link to notes such as `[[Mara Bell]]` or `[[Missing Ledger]]` in the scene body when you want the report and evaluator prompt context to treat that entity as intentionally present. You do not need root-level scene frontmatter fields like `characters`, `plotThreads`, or `arcs`.

For rare scene-specific exceptions, use explicit include/exclude fields:

```yaml
includeCharacters:
  - Mara Bell
excludePlotThreads:
  - Missing Ledger
```

Supported override fields are `includeCharacters`, `excludeCharacters`, `includePlotThreads`, `excludePlotThreads`, `includeStoryEngines`, `excludeStoryEngines`, `includeArcs`, and `excludeArcs`.
If the same name appears in an include and exclude field for the same run, the evaluator stops with a configuration error instead of letting one side silently override the other.

Storyboard writes `chapter_order` and `scene_order` when you rearrange tiles and click `Save Order`.
Storyboard metadata editing can write `chronology_label` and `chronology_value`, but drag-and-drop reordering does not change chronology.
The Chronology Indexer reads `chronology_value` and writes generated metadata under `ai.chronology`:

```yaml
ai:
  chronology:
    status: ok
    label: "July 28, 2026, 7:15:03.192 PM"
    value: "2026-07-28T19:15:03.192"
    sort: "1785262503192"
    sortUnit: ms
    precision: millisecond
```

If a scene has no generated `ai.chronology.sort`, Character Awareness does not infer prior chronology from file name, chapter order, scene order, or presentation order.
Storyboard metadata editing prevents two scenes in the same `chapter_order` from sharing the same `scene_order`.

## Evaluation Scope

Evaluation scope is controlled by note metadata and optional profiles, not by required per-scene story-element lists.

- Element notes define the universe of evaluable characters, plot threads, story engines, and arcs.
- Element `status` and `tags` decide whether an element is eligible.
- Scene `status`, `tags`, and queue options decide which scenes are included in a run.
- Scene-level include/exclude fields are rare hard overrides for a specific scene.
  Include/exclude conflicts are errors for names, statuses, and tags.

The default profile includes element notes and scenes unless they opt out through an excluded status or an excluded tag. To skip a scene in the normal queue, tag it like this:

```yaml
tags:
  - no-evaluate
```

To run an experiment without editing many notes back and forth, use tags and profiles:

```json
"evaluation": {
  "defaultProfile": "default",
  "profiles": {
    "harborExperiment": {
      "elementFilters": {
        "includeTags": ["harbor-experiment"]
      },
      "sceneFilters": {
        "includeTags": ["harbor-experiment"]
      }
    }
  }
}
```

With that profile, only scenes and story elements tagged `harbor-experiment` are queued/evaluated. You can also use command-line scene filters such as `--scene-tag revision-pass-2` and `--exclude-scene-tag no-evaluate`.

## Storyboard

Open `Example Book - A Ledger for Maribel Leigh/Reports/Storyboard.md` in Obsidian.

![Storyboard overview](docs/images/storyboard-overview.png)

Storyboard has two view modes:

- `Scenes`: a horizontal filmstrip of scene tiles.
- `Chapters`: chapter blocks containing nested scene rectangles.

The second selector controls the data lens:

- `Reader plot`: Reader Awareness for plot threads.
- `Reader character`: Reader Awareness for characters.
- `Reader arc`: Reader Awareness for arcs.
- `Story links`: linked characters, plot threads, and arcs without Reader Awareness bars.

Character checkboxes filter the visible scenes. The checkbox colors match the Storyboard color language.

Open `Example Book - A Ledger for Maribel Leigh/Reports/Chronology Storyboard.md` to view scenes by generated chronology for a selected character, plot thread, or arc. This report is read-only and sorts by `ai.chronology.sort`.

### Scene Tiles

Scene tiles are compact color blocks. Their width is based on scene word count. The color is based on POV. Tile faces stay visual; text and metrics belong in hover cards and the detail pane.

Scene tiles show their order badge as:

```text
chapter_order.scene_order
```

Hovering or focusing a scene shows a larger card with Reader Awareness deltas, cumulative totals, bounded awareness axes, and any configured rationale or evidence.

Click a scene to open the scene detail pane. Double-click a scene to open the note.

### Chapter Blocks

Chapter mode groups scene notes by `chapter_order`.

Chapter order is controlled by `chapter_order`. Scene order inside a chapter is controlled by `scene_order`.

Chapter blocks are made of nested scene rectangles and show:

- a chapter order badge, such as `C1`
- nested mini scene rectangles in chapter order
- scene-order numbers inside those rectangles

Hover a chapter to see its scene list. Hover a mini scene rectangle to see scene data. Click a chapter to open the chapter detail pane. Click a mini scene rectangle to switch the detail pane to that scene.

### Saving Order

You can maintain order in two ways:

- Edit `chapter_order` and `scene_order` directly in scene frontmatter.
- Rearrange Storyboard tiles and click `Save Order`.

In `Scenes` mode, dragging scene tiles changes the scene sequence. In `Chapters` mode, dragging chapter blocks changes chapter order while preserving the scene order inside each chapter.

When saved, Storyboard updates scene frontmatter:

```yaml
chapter_order: 2
scene_order: 3
```

If `storyboardReaderAwarenessAfterReorder` is set to `ask` or `auto`, Storyboard can queue Reader Awareness after saving order. Reader Awareness is still evaluated on individual scenes.

## Reader Awareness

Reader Awareness is a delta score, not an absolute score. It also stores bounded numeric axes that can apply across story and non-story contexts.

For each scene, the evaluator asks: what does the reader newly learn in this scene, compared to prior scenes?

It supports three targets:

- `Reader Awareness / Character`: new reader knowledge about a character.
- `Reader Awareness / Plot Thread`: new reader knowledge about a plot thread.
- `Reader Awareness / Arc`: new visible evidence that an arc progressed, reversed, deepened, or resolved.

Scores are stored under scene frontmatter as observations:

```yaml
ai:
  observations:
    plotThreads:
      Missing Ledger:
        awareness:
          reader:
            valueKind: delta
            values:
              delta: 7
              salience: 8
              confidence: 6
              alignment: -4
              evidenceStrength: 7
            rationale: The scene gives the reader a visible but incomplete ledger clue.
```

`delta` is the cumulative chart input. `salience` is how present the target is to the reader. `confidence` is how certain the reader is likely to feel about what they know or infer. `alignment` is how aligned the reader's likely understanding is with the supplied definitions, prior context, and scene evidence. `evidenceStrength` is how much support the supplied text gives for the scores.

Storyboard calculates cumulative totals by summing deltas in story order. If you change order, rerun Reader Awareness so each scene's delta and bounded axes are calculated against the correct prior context.

## Character Awareness

Character Awareness uses the same bounded numeric axes as Reader Awareness, but it evaluates what each character plausibly learns in story chronology rather than what the reader learns in presentation order. The evaluator compares the current scene against prior scenes by generated `ai.chronology.sort`, not by `chapter_order` and `scene_order`.

Scores are stored under scene frontmatter as observations:

```yaml
ai:
  observations:
    plotThreads:
      Missing Ledger:
        awareness:
          characters:
            Mara Bell:
              valueKind: delta
              values:
                delta: 5
                salience: 7
                confidence: 6
                alignment: -3
                evidenceStrength: 6
              rationale: Mara notices the missing ledger but has limited support for what happened to it.
```

`delta` is the cumulative chart input. `salience` is how present the plot thread is to the character. `confidence` is how certain the character seems about what they know or infer. `alignment` is how aligned the character's apparent understanding is with the supplied definitions and scene evidence. `evidenceStrength` is how much support the supplied text gives for the scores.

## Observations

Evaluators write report-facing data under `ai.observations`.

```yaml
ai:
  observations:
    plotThreads:
      Missing Ledger:
        resolution:
          valueKind: delta
          values:
            delta: 3.5
          projectMode: outline
        awareness:
          reader:
            valueKind: delta
            value: 5
            values:
              delta: 5
            observer:
              type: reader
              name: Reader
          characters:
            Mara Bell:
              valueKind: delta
              value: 4
              values:
                delta: 4
              observer:
                type: characters
                name: Mara Bell
```

Entity dimensions such as relevance, tension, and resolution are scene deltas. Scene craft dimensions such as pacing, conflict, poetics, and coherence are scene scores.

## Awareness Rationale Modes

Awareness evaluators can store different rationale payloads through `config.local.json` or `config.example.json`:

```json
"awareness": {
  "rationaleMode": "extractive"
}
```

Modes:

- `off`: store only bounded numeric fields.
- `extractive`: store only exact evidence excerpts copied from supplied scenes, notes, prior scene context, or definitions.
- `paraphrase`: store one tight model-written rationale sentence.

Use `extractive` when you want the evaluator to avoid adding interpretive language. The normalizer drops evidence excerpts that do not appear in the supplied source text.

## Standard Metric Rationale Modes

Relevance, Tension, Resolution, Pacing, Conflict, Poetics, and Coherence use `standardMetrics` in `config.local.json` or `config.example.json`.

```json
"standardMetrics": {
  "default": {
    "rationaleMode": "paraphrase",
    "rationaleField": "sceneRationale"
  }
}
```

Modes:

- `off`: store only numeric deltas or scores.
- `extractive`: store exact evidence excerpts copied from the supplied scene or definitions.
- `paraphrase`: store one tight rationale sentence in the configured `rationaleField`.

Relevance, Tension, and Resolution are entity dimensions and write scene deltas under paths such as `ai.observations.plotThreads.<plot thread>.resolution.values.delta`.

Pacing, Conflict, Poetics, and Coherence are scene-only dimensions. They use the target `Scene`, do not load character/plot/arc/story-engine definitions, and write scores under paths such as `ai.observations.scene.<scene name>.pacing.values.score`.

## Truth Ledger

The Truth Ledger is a generated support map. It scans configured notes, resolves `[[links]]` against known characters, plot threads, story engines, and arcs, and records concrete source evidence for authored and inferred story assertions.

- **Authored anchors**: optional `[!claim]` callouts for facts you want to pin explicitly.
- **Inferred support**: lower-authority claims inferred by the local LLM from scanned notes, with exact evidence excerpts and resolved entities where possible.

Run `Templates/Queue-Truth-Ledger.md` or:

```sh
node scheduler/enqueue-truth-ledger.mjs
node scheduler/worker.mjs --drain
```

Most author work should be ordinary linked prose. Use authored anchors only when you want to pin a durable assertion:

```md
> [!claim] claim.missing-ledger.location
> truth: true
> The [[Missing Ledger]] is hidden in the storm vault.
```

Supported `truth` values:

- `true`
- `false`
- `partial`
- `ambiguous`
- `unknown`

The scheduled crawl scans configured folders one note at a time, using `scheduler.throttleMs` between notes. Each note pass validates authored claim IDs and truth values, resolves linked entities, and asks the local LLM for inferred support when `truthLedger.inference.enabled` is true. The worker merges those results and writes the generated index to `observastory-tools/.index/truth-ledger.json`. The generated file is not meant to be hand-edited. Open `Example Book - A Ledger for Maribel Leigh/Reports/Truth Ledger.md` to review authored anchors and inferred support in Obsidian.

Awareness evaluators use the generated support map as grounding. Reader Awareness receives support from prior story-order scenes as reader-visible context. Character Awareness receives support from prior chronology scenes as candidate character-visible context and must still decide whether a character plausibly had access.

## Reports

Reports live in `Example Book - A Ledger for Maribel Leigh/Reports`.

Most report pages use Dataview or DataviewJS to read scene frontmatter and render tables or charts. They do not run evaluations themselves.

Core report categories:

- `Observation Trajectory by Scene`: selector-driven line chart for entity type, dimension, observer, and delta/cumulative display. This is the main entity/dimension/observation report and replaces the old one-report-per-metric pattern.
- `Scene Metric Bullseye`: selected-scene radar and score bars across available metric families.
- `Metric Heatmaps`: selector-driven heatmaps for relevance, tension, resolution, pacing, conflict, poetics, coherence, and awareness-style signals.
- `Story Overview`: story-level word count, POV, chapter, and metric overview charts.
- `Chronology Timeline`: full-scene chronology strip ordered by generated chronology sort.
- `Truth Ledger`: selector-driven support map from configured notes, including authored anchors, inferred support, resolved entities, and source evidence.
- `Goal Bullseye`: radar view of average goal achievement across metric families.
- `Goal Heatmap`: scene-by-scene heatmap of goal achievement and lowest-scoring areas.
- `Storyboard`: the interactive planning surface for ordering scenes and chapters.
- `Chronology Storyboard`: read-only chronology view for scenes involving a selected character, plot thread, or arc.

One-off report permutations have been pruned. Use selector-driven reports instead of adding entity/dimension permutations.

If a report is empty:

- Confirm the scene evaluation queue has run for that dimension/entity type.
- Reopen the note or refresh Dataview.
- Confirm the Charts plugin is enabled for chart reports.
- Inspect the scene frontmatter under `ai` to confirm the expected data exists.

## Scheduler Modes

Scheduler behavior is controlled in `config.local.json`.

The config loader accepts JSON with comments, so `//` and `/* ... */` comments are allowed in `config.local.json` and `config.example.json`.

```json
{
  "evaluationCache": {
    "enabled": true
  },
  "scheduler": {
    "mode": "manual",
    "throttleMs": 5000,
    "pollIntervalMs": 30000,
    "launchWorkerFromTemplater": true,
    "monitorFromTemplater": true,
    "statusNoticeIntervalMs": 5000,
    "statusNoticeMaxMinutes": 240,
    "backgroundSceneScan": {
      "enabled": true,
      "debounceMs": 5000,
      "baselineOnFirstRun": true,
      "fingerprintPath": ".queue/background-scene-fingerprints.json"
    },
    "storyboardReaderAwarenessAfterReorder": "ask"
  }
}
```

The scheduler has one worker and multiple job types:

- Scene evaluation jobs are queued with `scheduler/enqueue-scene-evaluations.mjs`.
- Truth Ledger crawl jobs are queued with `scheduler/enqueue-truth-ledger.mjs`.
- Chronology Index jobs are queued with `scheduler/enqueue-chronology-index.mjs`.

`manual` mode is the default. Templater queues the requested job and starts a worker that drains queued jobs, using `throttleMs` between evaluator calls, Truth Ledger note crawls, or Chronology Index scene updates.

`background` mode leaves the worker running separately. In this mode, Templater only queues jobs; the long-running worker picks them up on its next poll.

When `scheduler.backgroundSceneScan.enabled` is true, the background worker also scans eligible scene notes and queues a small scene-evaluation job only for scene files whose author-owned input changed. This scan fingerprints scene content plus author frontmatter and ignores the generated `ai` branch, so evaluator writes do not trigger another evaluation loop. The first background run writes a baseline by default instead of queueing every existing scene. Use `Templates/Queue-Evaluation-All-Scenes.md` when you intentionally want a full pass.

`backgroundSceneScan.debounceMs` controls how long a changed scene must stay stable before the worker queues it. This is the guardrail for active Obsidian editing: repeated saves to the current scene update the pending fingerprint rather than spawning a burst of duplicate jobs.

Scene evaluation jobs are incremental by default. Each evaluator stores an input fingerprint for the metric/target axis it writes, then skips unchanged reruns without calling the model or rewriting the scene note. The fingerprint is based on the evaluator prompt inputs, including the scene text, selected definitions, relevant prior-scene context for awareness metrics, model, and evaluation profile. Set `evaluationCache.enabled` to `false`, or pass `--force` to `scheduler/enqueue-scene-evaluations.mjs` or `evaluators/evaluate-scene.mjs`, when you intentionally want a full rerun.

`statusNoticeIntervalMs` controls how often Obsidian checks the job file and shows progress notices. Set `monitorFromTemplater` to `false` if you only want logs and job files.

`storyboardReaderAwarenessAfterReorder` controls what Storyboard does after saving order:

- `manual`: save `chapter_order` and `scene_order` only.
- `ask`: ask whether to queue Reader Awareness.
- `auto`: queue Reader Awareness immediately.

Start the background worker from Obsidian with `Templates/Scheduler-Start.md`, or from a terminal:

```sh
node scheduler/worker.mjs --watch
```

Check status from Obsidian with `Templates/Scheduler-Status.md`, or from a terminal:

```sh
node scheduler/status.mjs
```

Refresh the generated Processing Status index from a terminal:

```sh
node status/freshness.mjs --vault-root "C:\path\to\your\vault" --write
```

Request a graceful stop after the current job from Obsidian with `Templates/Scheduler-Stop-After-Current.md`, or from a terminal:

```sh
node scheduler/stop-worker.mjs --after-current
```

Stop the background worker immediately from Obsidian with `Templates/Scheduler-Stop.md`, or from a terminal:

```sh
node scheduler/stop-worker.mjs
```

Run one manual drain from a terminal:

```sh
node scheduler/worker.mjs --drain
```

Cancel the latest queued or running job from a terminal:

```sh
node scheduler/cancel-job.mjs --latest
```

## Scene Evaluation Queueing

Use `Templates/Queue-Evaluation-All-Scenes.md` to process the configured `story.folders.scenes` folder.

Use `Templates/Queue-Evaluation-Current-Scene.md` when you want the full configured evaluator set for just the active scene.

Queued scene evaluations skip unchanged metric/target axes by default. A skipped evaluation is counted as a successful evaluator process in the job log, but it does not call the model and does not rewrite the scene file.

By default, the Templater script:

1. creates a queued scene evaluation job under `observastory-tools/.queue/jobs`
2. starts the scheduler worker in `--drain` mode
3. shows progress notices while the worker processes scenes in the background
4. returns control to Obsidian

The worker writes job logs to `observastory-tools/.queue/logs`.

Cancel a queued or running job from Obsidian with `Templates/Queue-Cancel-Job.md`. Running jobs stop before the next evaluator call. If cancellation arrives while one evaluator process is active, the worker stops that child process.

Run only Reader Awareness from Obsidian with `Templates/Queue-Evaluation-Reader-Awareness.md`. The full scene evaluation queue also includes Reader Awareness; this template is for targeted reruns after order changes.

## Processing Status and Stale Work

`Templates/Scheduler-Status.md` refreshes `observastory-tools/.index/processing-status.json`, which is displayed by `Reports/Processing Status.md`.

The status index compares author-owned fingerprints instead of modification times:

- scene fingerprints ignore generated `ai` frontmatter so evaluator writes do not trigger another loop
- Truth Ledger sources are compared against source fingerprints stored in `.index/truth-ledger.json`
- chronology metadata is compared against hashes of `chronology_label` and `chronology_value`
- evaluator axes are marked `fresh`, `stale`, `pending`, `unknown`, `never-run`, or `legacy` from stored `ai.evaluationInputs`

Use `Templates/Queue-Stale-Work.md` to queue only currently actionable work. From a terminal, preview the plan without creating jobs:

```sh
node scheduler/enqueue-stale-work.mjs --vault-root "C:\path\to\your\vault" --dry-run
```

`unknown` scene axes mean this machine has not written a background fingerprint baseline yet. They are visible in status, but `Queue-Stale-Work` does not treat them as stale.
