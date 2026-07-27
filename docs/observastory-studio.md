# Observastory Studio

Observastory is a narrative development studio. It helps authors compose freely, make durable story structure explicit, refresh observations, explore the work from several perspectives, and revise intentionally.

The Studio does not prescribe what a story should be. It organizes evidence from the author's own manuscript and story model so the author can see relationships, movement, continuity, voice, information flow, and development choices more clearly.

## Core vocabulary

- **Studio**: the complete narrative development environment.
- **Workspace**: an interactive place where the author performs a sustained task, such as arranging scenes, developing one scene, or tracing continuity.
- **Lens**: a selected analytical perspective within a workspace, such as Craft, Story Movement, Information Flow, Trajectories, Reader Awareness, or Character Awareness.
- **Observation**: a generated finding grounded in configured definitions and bounded story evidence.
- **Evaluation**: the background process that produces or refreshes observations.
- **Index**: generated structure that organizes evidence, freshness, chronology, or processing state.
- **Snapshot** or **export**: a static artifact intentionally produced for sharing or preservation. This is the appropriate place for the word *report*.

## Development rhythm

The central rhythm is:

> Compose → Observe → Explore → Develop

In practical terms:

1. Write freely without stopping to organize every fragment.
2. Register durable story material where the project requires it.
3. Refresh observations when the author wants a current reading.
4. Explore the story through relevant workspaces and lenses.
5. Revise deliberately, keeping authorship and judgment with the writer.

## POC workspaces and lenses

The POC implements Studio surfaces as Dataview and Charts notes in the vault-root `ObservaStory` folder. They are tooling, not part of the configured book.

- **Storyboard** is the scene and chapter arrangement workspace.
- **Scene Development Map** is the selected-scene workspace with Craft, Story Movement, Information Flow, and Trajectories lenses.
- **Scene Profile** is a plain-language selected-scene workspace.
- **Truth Ledger** is the continuity and authored-truth workspace.
- **Chronology Storyboard** and **Chronology Timeline** are chronology workspaces.
- **Observation Trajectory**, **Metric Heatmaps**, and **Goal Heatmap** are comparative development lenses.
- **Narrative Voice Diagnostics** is the voice and point-of-view workspace.
- **Processing Status** is the activity and freshness workspace.

These surfaces consume canonical observations and indexes. Moving them out of the story folder changes their architectural ownership, not their analytical behavior.

## Content boundary

The configured story root contains the developing book and its author-owned model: scenes, characters, narrators, plot threads, arcs, story engines, metrics, and notes.

The Studio root contains interface surfaces. `observastory-templates` contains the current internal POC command adapter. `observastory-tools` contains the reusable engine and generated state.

This boundary prevents interface notes from being mistaken for book content, truth sources, evaluation targets, or managed prose during content operations such as `Inline Embed References...`.
