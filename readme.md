# Obsidian Tools

## Batch scene evaluation from Templater

Use `Templates/Batch-Evaluate-Scenes.md` from any scene in the folder you want to process.

By default, the Templater script:

1. creates a queued batch job under `obsidianTools/.queue/jobs`
2. starts the scheduler worker in `--drain` mode
3. returns control to Obsidian while the worker processes scenes in the background

The worker writes job logs to `obsidianTools/.queue/logs`.

## Scheduler modes

Scheduler behavior is controlled in `config.local.json`:

```json
{
  "scheduler": {
    "mode": "manual",
    "throttleMs": 5000,
    "pollIntervalMs": 30000,
    "launchWorkerFromTemplater": true
  }
}
```

`manual` mode is the default. Templater queues the batch and starts a worker that drains all queued jobs, using `throttleMs` between evaluator calls.

`background` mode leaves the worker running separately. In this mode, Templater only queues jobs; the long-running worker picks them up on its next poll.

Start the background worker from Obsidian with `Templates/Start-Scheduler.md`, or from a terminal:

```sh
node scheduler/worker.mjs --watch
```

Run one manual drain from a terminal:

```sh
node scheduler/worker.mjs --drain
```

## Command-line batch evaluation

To enqueue a batch job:

```sh
node scheduler/enqueue-batch.mjs "C:\Users\ian\writers\Segments\Tech Tips\Obsidian\POC\Scenes"
```

To run the older direct batch path without queueing:

```sh
node evaluators/batch-evaluate-scenes.mjs "C:\Users\ian\writers\Segments\Tech Tips\Obsidian\POC\Scenes"
```

To process an individual scene:

```sh
node evaluators/evaluate-scene.mjs "C:\Users\ian\writers\Segments\Tech Tips\Obsidian\POC\Scenes\01 Inventory Day.md" "Tension" "Character"
```

These scripts expect scene frontmatter to include the relevant lists, such as `characters`, `plotThreads`, `storyEngines`, and `arcs`. The `ai` section is created or updated by the evaluator.
