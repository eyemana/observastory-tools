import fs from "fs";
import path from "path";

export const defaultConfig = {
  ollamaUrl: "http://localhost:11434/api/generate",
  model: "qwen2.5:7b",
  awareness: {
    rationaleMode: "paraphrase",
    rationaleSources: ["scene", "definitions", "priorScenes"]
  },
  story: {
    root: "",
    folders: {
      scenes: "Scenes",
      characters: "Characters",
      plotThreads: "Plot Threads",
      storyEngines: "Story Engines",
      arcs: "Arcs",
      narrators: "Narrators",
      metrics: "Metrics",
      reports: "Reports",
      notes: "Notes"
    },
    entityTypes: {
      characters: {
        target: "character",
        folderKeys: ["characters"],
        label: "character",
        pluralLabel: "characters",
        referenceFields: ["characters", "pov"],
        readerAwareness: {
          subject: "characters",
          meaning: "Measure how much the scene increases, refreshes, or reinforces reader-facing awareness of each character through visible information, action, relationship, choice, reputation, or memorable detail.",
          cautions: [
            "Score what the reader receives, not whether the character is important.",
            "An absent character may still receive a nonzero delta when the scene reveals information about them.",
            "Frontmatter alone is not reader-visible evidence."
          ]
        }
      },
      plotThreads: {
        target: "plot thread",
        folderKeys: ["plotThreads"],
        label: "plot thread",
        pluralLabel: "plot threads",
        referenceFields: ["plotThreads"],
        readerAwareness: {
          meaning: "Measure how much new or meaningfully reinforced information the reader receives about each configured plot thread.",
          cautions: ["Do not score plot importance or author-only intent."]
        }
      },
      storyEngines: {
        target: "story engine",
        folderKeys: ["storyEngines"],
        label: "story engine",
        pluralLabel: "story engines",
        referenceFields: ["storyEngines"]
      },
      arcs: {
        target: "arc",
        folderKeys: ["arcs"],
        label: "arc",
        pluralLabel: "arcs",
        referenceFields: ["arcs"],
        readerAwareness: {
          meaning: "Measure how much new evidence the reader receives about the configured change described by this definition.",
          cautions: [
            "Use the definition's own model of change; do not assume fixed stages, forward progress, improvement, or character-centered change.",
            "Score evidence shown to the reader, not author intent that remains invisible."
          ]
        }
      },
      narrators: {
        target: "narrator",
        folderKeys: ["narrators"],
        label: "narrator",
        pluralLabel: "narrators",
        referenceFields: ["narrators", "narrator", "pov"],
        readerAwareness: {
          subject: "narrator identities",
          meaning: "Reader awareness means how much NEW information this scene gives the reader about a narrator's identity, role, access, motives, relationship to the narrated subject, or reliability.",
          low: "1-3 = the reader receives a minor voice cue, suspicion, confirmation, or identity clue.",
          medium: "4-6 = the reader gains meaningful information about who the narrator may be, what they want, or how they know what they narrate.",
          high: "7-9 = the reader gains major new understanding of the narrator's identity, role, access, motives, or reliability.",
          decisive: "10 = the narrator's identity or narrative role is decisively revealed, reversed, or resolved.",
          cautions: [
            "Score what becomes available to the reader, not the narrator's general importance or mere amount of narration.",
            "A recognizable voice can reinforce salience without revealing identity; keep identity delta low unless the scene adds a meaningful clue or connection.",
            "If the scene repeats information the reader already had, use delta 0 or a low confirmatory score."
          ]
        }
      }
    }
  },
  sceneLifecycle: {
    defaultStatus: "draft",
    excludedStatuses: ["scratch", "archived"]
  },
  sceneComposition: {
    maxDepth: 5
  },
  calibration: {
    modes: {
      draft: {
        guidance:
          "Scene lifecycle status: draft. The author has intentionally marked this scene as working material. It may contain notes, placeholders, outline fragments, paraphrase, lists, and links that indicate intended entities or relationships. Treat explicit Obsidian links as strong author intent signals for relevant entity and relationship observations, but keep polish-facing displayed scores conservative where caps are configured.",
        scoreCeilings: {
          pacing: 7,
          poetics: 6,
          coherence: 6
        }
      },
      live: {
        guidance:
          "Scene lifecycle status: live. Treat this as prose intended to be part of the book. Do not apply protective draft dampening. Visible scaffolding, TODOs, placeholders, outline fragments, paraphrase, and loose notes should lower the appropriate craft scores and raise Scaffolding.",
        scoreCeilings: {}
      },
      scratch: {
        guidance: "Scene lifecycle status: scratch. Scratch scenes are excluded before evaluator prompts are built.",
        scoreCeilings: {}
      },
      archived: {
        guidance: "Scene lifecycle status: archived. Archived scenes are excluded before evaluator prompts are built.",
        scoreCeilings: {}
      }
    }
  },
  standardMetrics: {
    default: {
      rationaleMode: "paraphrase",
      rationaleSources: ["scene", "definitions"],
      rationaleField: "sceneRationale"
    },
    metrics: {
      Relevance: {
        rationaleType: "relevance rationale"
      },
      Tension: {
        rationaleType: "tension rationale"
      },
      Resolution: {
        rationaleType: "resolution rationale"
      },
      Pacing: {
        rationaleType: "pacing rationale"
      },
      Conflict: {
        rationaleType: "conflict rationale"
      },
      Poetics: {
        rationaleType: "poetics rationale"
      },
      Coherence: {
        rationaleType: "coherence rationale"
      },
      "Voice Consistency": {
        rationaleType: "voice consistency rationale",
        valueKind: "score",
        contextFields: ["pov", "narrator"],
        targetSelection: {
          mode: "sceneFields",
          fields: ["narrator", "pov"],
          fallback: "none"
        }
      },
      "POV Legibility": {
        rationaleType: "POV legibility rationale",
        valueKind: "score",
        contextFields: ["pov", "narrator"]
      },
      "Thread Cueing": {
        rationaleType: "thread cueing rationale",
        valueKind: "score",
        contextFields: ["pov", "narrator"],
        priorContext: "readerOrder",
        targetSelection: {
          mode: "sceneFields",
          fields: ["narrator", "pov"],
          fallback: "none"
        }
      },
      "Knowledge Integrity": {
        rationaleType: "knowledge integrity rationale",
        valueKind: "score",
        contextFields: ["pov"],
        priorContext: "chronology",
        targetSelection: {
          mode: "sceneFields",
          fields: ["characters", "pov"],
          includeLinked: true,
          fallback: "none"
        }
      }
    }
  },
  truthLedger: {
    folders: ["notes", "arcs", "storyEngines", "plotThreads", "characters", "narrators", "scenes"],
    paths: [],
    outputPath: ".index/truth-ledger.json",
    cachePath: ".queue/truth-ledger-cache.json",
    inference: {
      enabled: true,
      maxClaimsPerNote: 5,
      minConfidence: 6
    }
  },
  chronology: {
    folders: ["scenes"],
    paths: [],
    sortUnit: "ms",
    generatedPath: "ai.chronology"
  },
  evaluation: {
    defaultProfile: "default",
    relationships: {
      readerAwareness: {
        metric: "reader awareness",
        dimension: "awareness",
        targets: ["*"],
        valueKind: "delta",
        priorContext: "readerOrder",
        targetGuidance: "readerAwareness",
        observer: {
          mode: "constant",
          key: "reader",
          type: "reader",
          name: "Reader",
          storageKey: "reader"
        },
        meaning: "Measure how much new information the observer gains in this scene about each target.",
        knowledgeBoundary: "The reader can learn from narration, dramatic irony, framing, implication, reveals, and any point of view. Do not limit the reader to what a character knows."
      },
      characterAwareness: {
        metric: "character awareness",
        dimension: "awareness",
        targets: ["plotThreads"],
        valueKind: "delta",
        priorContext: "chronology",
        observer: {
          mode: "entities",
          key: "characters",
          target: "character",
          storageKey: "characters"
        },
        meaning: "Measure how much new information each observer gains in this scene about each target.",
        knowledgeBoundary: "Only score what each observer plausibly learns. Presence, access, chronology, and supplied evidence constrain knowledge."
      }
    },
    trajectories: {
      trajectory: {
        metric: "trajectory",
        dimension: "trajectory",
        targets: ["arcs"],
        priorContext: "readerOrder",
        meaning: "Describe the state or transition made visible by this scene using the author's own definition. The definition may describe stages, a spectrum, a cycle, a reversal, or another form of change; do not impose a stage model that is not present."
      }
    },
    elementFilters: {
      includeStatuses: [],
      excludeStatuses: ["scratch", "archived", "inactive"],
      includeTags: [],
      excludeTags: ["no-evaluate", "exclude-evaluation"]
    },
    sceneFilters: {
      includeStatuses: [],
      excludeStatuses: ["scratch", "archived", "inactive"],
      includeTags: [],
      excludeTags: ["no-evaluate", "exclude-evaluation"]
    },
    profiles: {
      default: {}
    }
  },
  evaluationCache: {
    enabled: true
  },
  scheduler: {
    mode: "manual",
    queueDir: ".queue",
    throttleMs: 5000,
    pollIntervalMs: 30000,
    launchWorkerFromTemplater: true,
    monitorFromTemplater: true,
    statusNoticeIntervalMs: 5000,
    statusNoticeMaxMinutes: 240,
    nodePath: "node",
    backgroundSceneScan: {
      enabled: true,
      debounceMs: 5000,
      baselineOnFirstRun: true,
      fingerprintPath: ".queue/background-scene-fingerprints.json"
    },
    storyboardReaderAwarenessAfterReorder: "ask",
    readerAwarenessEvaluations: [
      ["reader awareness", "character"],
      ["reader awareness", "plot thread"],
      ["reader awareness", "arc"],
      ["reader awareness", "narrator"]
    ],
    evaluations: [
      ["relevance", "character"],
      ["relevance", "plot thread"],
      ["relevance", "story engine"],
      ["relevance", "arc"],
      ["tension", "character"],
      ["tension", "plot thread"],
      ["tension", "story engine"],
      ["tension", "arc"],
      ["resolution", "character"],
      ["resolution", "plot thread"],
      ["resolution", "story engine"],
      ["resolution", "arc"],
      ["pacing", "scene"],
      ["conflict", "scene"],
      ["poetics", "scene"],
      ["coherence", "scene"],
      ["scaffolding", "scene"],
      ["voice consistency", "narrator"],
      ["pov legibility", "scene"],
      ["thread cueing", "narrator"],
      ["knowledge integrity", "character"],
      ["character awareness", "plot thread"],
      ["reader awareness", "character"],
      ["reader awareness", "plot thread"],
      ["reader awareness", "arc"],
      ["reader awareness", "narrator"],
      ["trajectory", "arc"]
    ]
  }
};

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function mergeConfig(base, override) {
  const merged = { ...base };

  for (const [key, value] of Object.entries(override ?? {})) {
    if (isPlainObject(value) && isPlainObject(merged[key])) {
      merged[key] = mergeConfig(merged[key], value);
    } else {
      merged[key] = value;
    }
  }

  return merged;
}

export function stripJsonComments(text) {
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

export function parseConfigText(text) {
  return JSON.parse(stripJsonComments(text));
}

export function loadConfig(toolRoot) {
  const localPath = path.join(toolRoot, "config.local.json");
  const examplePath = path.join(toolRoot, "config.example.json");
  const configPath = fs.existsSync(localPath) ? localPath : examplePath;

  if (!fs.existsSync(configPath)) {
    return defaultConfig;
  }

  const fileConfig = parseConfigText(fs.readFileSync(configPath, "utf8"));
  return mergeConfig(defaultConfig, fileConfig);
}

export function getSchedulerConfig(toolRoot) {
  return loadConfig(toolRoot).scheduler;
}

export function getStoryConfig(config) {
  const configuredEntityTypes = config.story?.entityTypes ?? {};
  const entityTypeKeys = new Set([
    ...Object.keys(defaultConfig.story.entityTypes),
    ...Object.keys(configuredEntityTypes)
  ]);
  return {
    ...defaultConfig.story,
    ...(config.story ?? {}),
    folders: {
      ...defaultConfig.story.folders,
      ...(config.story?.folders ?? {})
    },
    entityTypes: Object.fromEntries([...entityTypeKeys].map(key => [key, {
      ...(defaultConfig.story.entityTypes[key] ?? {}),
      ...(configuredEntityTypes[key] ?? {})
    }]))
  };
}

export function storyPath(config, configuredPath) {
  const story = getStoryConfig(config);

  if (path.isAbsolute(configuredPath)) {
    return configuredPath;
  }

  return story.root
    ? path.join(story.root, configuredPath)
    : configuredPath;
}

export function storyRelativePath(config, folderKey) {
  const story = getStoryConfig(config);
  const folder = story.folders[folderKey];

  if (!folder) {
    const configuredKeys = Object.keys(story.folders).sort().join(", ");
    throw new Error(`Unknown story folder key "${folderKey}". Configured story.folders keys: ${configuredKeys}`);
  }

  return storyPath(config, folder);
}

function asArray(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => item !== null && item !== undefined);
  }

  if (value === null || value === undefined || value === "") {
    return [];
  }

  return [value];
}

export function getStoryEntityTypes(config) {
  return getStoryConfig(config).entityTypes;
}

export function storyEntityTypePaths(config, entityTypeKey) {
  const story = getStoryConfig(config);
  const entityTypes = getStoryEntityTypes(config);
  const entityType = entityTypes[entityTypeKey];

  if (!entityType) {
    const configuredKeys = Object.keys(entityTypes).sort().join(", ");
    throw new Error(`Unknown story entity type "${entityTypeKey}". Configured story.entityTypes keys: ${configuredKeys}`);
  }

  const explicitPaths = asArray(entityType.paths);

  if (explicitPaths.length > 0) {
    return explicitPaths.map((configuredPath) => String(configuredPath));
  }

  const folderKeys = asArray(entityType.folderKeys);
  return folderKeys.map((folderKey) => {
    const folder = story.folders[folderKey];

    if (!folder) {
      const configuredKeys = Object.keys(story.folders).sort().join(", ");
      throw new Error(`Unknown story folder key "${folderKey}". Configured story.folders keys: ${configuredKeys}`);
    }

    return folder;
  });
}

function configuredSectionPaths(config, sectionName, defaultFolderKeys) {
  const sectionConfig = config[sectionName] ?? {};

  if (Array.isArray(sectionConfig.paths) && sectionConfig.paths.length > 0) {
    return sectionConfig.paths;
  }

  const folderKeys = Array.isArray(sectionConfig.folders) && sectionConfig.folders.length > 0
    ? sectionConfig.folders
    : defaultFolderKeys;

  return folderKeys.map((folderKey) => storyRelativePath(config, folderKey));
}

export function defaultTruthLedgerPaths(config) {
  return configuredSectionPaths(config, "truthLedger", defaultConfig.truthLedger.folders);
}

export function defaultChronologyPaths(config) {
  return configuredSectionPaths(config, "chronology", defaultConfig.chronology.folders);
}

export function defaultScenesPath(config) {
  return storyRelativePath(config, "scenes");
}
