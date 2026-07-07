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
      metrics: "Metrics",
      reports: "Reports",
      notes: "Notes"
    },
    entityTypes: {
      characters: {
        target: "Character",
        folderKeys: ["characters"],
        label: "character",
        pluralLabel: "characters"
      },
      plotThreads: {
        target: "Plot Thread",
        folderKeys: ["plotThreads"],
        label: "plot thread",
        pluralLabel: "plot threads"
      },
      storyEngines: {
        target: "Story Engine",
        folderKeys: ["storyEngines"],
        label: "story engine",
        pluralLabel: "story engines"
      },
      arcs: {
        target: "Arc",
        folderKeys: ["arcs"],
        label: "arc",
        pluralLabel: "arcs"
      }
    }
  },
  projectMode: "draft",
  calibration: {
    modes: {
      outline: {
        guidance:
          "The project is in outline mode. Treat notes, placeholders, and planned outcomes as low-confidence signals unless the scene text clearly dramatizes them.",
        scoreCeilings: {
          Resolution: 3.5
        }
      },
      draft: {
        guidance: "",
        scoreCeilings: {}
      },
      revision: {
        guidance: "",
        scoreCeilings: {}
      },
      final: {
        guidance: "",
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
      }
    }
  },
  truthLedger: {
    folders: ["notes", "arcs", "storyEngines", "plotThreads", "characters", "scenes"],
    paths: [],
    outputPath: ".index/truth-ledger.json",
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
    elementFilters: {
      includeStatuses: [],
      excludeStatuses: ["draft", "archived", "inactive"],
      includeTags: [],
      excludeTags: ["no-evaluate", "exclude-evaluation"]
    },
    sceneFilters: {
      includeStatuses: [],
      excludeStatuses: ["draft", "archived", "inactive"],
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
    storyboardReaderAwarenessAfterReorder: "ask",
    readerAwarenessEvaluations: [
      ["Reader Awareness", "Character"],
      ["Reader Awareness", "Plot Thread"],
      ["Reader Awareness", "Arc"]
    ],
    evaluations: [
      ["Relevance", "Character"],
      ["Relevance", "Plot Thread"],
      ["Relevance", "Story Engine"],
      ["Relevance", "Arc"],
      ["Tension", "Character"],
      ["Tension", "Plot Thread"],
      ["Tension", "Story Engine"],
      ["Tension", "Arc"],
      ["Resolution", "Character"],
      ["Resolution", "Plot Thread"],
      ["Resolution", "Story Engine"],
      ["Resolution", "Arc"],
      ["Pacing", "Scene"],
      ["Conflict", "Scene"],
      ["Poetics", "Scene"],
      ["Coherence", "Scene"],
      ["Character Awareness", "Plot Thread"],
      ["Reader Awareness", "Character"],
      ["Reader Awareness", "Plot Thread"],
      ["Reader Awareness", "Arc"]
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
  return {
    ...defaultConfig.story,
    ...(config.story ?? {}),
    folders: {
      ...defaultConfig.story.folders,
      ...(config.story?.folders ?? {})
    },
    entityTypes: {
      ...defaultConfig.story.entityTypes,
      ...(config.story?.entityTypes ?? {})
    }
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
