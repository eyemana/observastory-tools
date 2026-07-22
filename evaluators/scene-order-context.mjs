import { compareChronologySort } from "../chronology/chronology-utils.mjs";

function numericFrontmatter(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function getStoryOrder(scene) {
  const chapterOrder = numericFrontmatter(scene.data.chapter_order) ??
    numericFrontmatter(scene.data.chapter);
  const sceneOrder = numericFrontmatter(scene.data.scene_order);

  if (chapterOrder === null || sceneOrder === null) {
    return null;
  }

  return { chapterOrder, sceneOrder };
}

export function getChronologyOrder(scene) {
  const generatedSort = scene.data.ai?.chronology?.sort;

  if (generatedSort !== undefined && generatedSort !== null && generatedSort !== "") {
    return String(generatedSort);
  }

  return null;
}

export function compareStoryOrder(a, b) {
  if (a.storyOrder && b.storyOrder) {
    if (a.storyOrder.chapterOrder !== b.storyOrder.chapterOrder) {
      return a.storyOrder.chapterOrder - b.storyOrder.chapterOrder;
    }

    if (a.storyOrder.sceneOrder !== b.storyOrder.sceneOrder) {
      return a.storyOrder.sceneOrder - b.storyOrder.sceneOrder;
    }
  } else if (a.storyOrder) {
    return -1;
  } else if (b.storyOrder) {
    return 1;
  }

  return a.fileName.localeCompare(b.fileName);
}

export function compareChronologyOrder(a, b) {
  if (a.chronologyOrder !== null && b.chronologyOrder !== null) {
    const chronology = compareChronologySort(a.chronologyOrder, b.chronologyOrder);
    if (chronology !== 0) return chronology;
  } else if (a.chronologyOrder !== null) {
    return -1;
  } else if (b.chronologyOrder !== null) {
    return 1;
  }

  return compareStoryOrder(a, b);
}

export function isPriorStoryScene(scene, currentOrder, currentName) {
  if (currentOrder === null) {
    return scene.fileName.localeCompare(currentName) < 0;
  }

  if (scene.storyOrder === null) {
    return false;
  }

  if (scene.storyOrder.chapterOrder !== currentOrder.chapterOrder) {
    return scene.storyOrder.chapterOrder < currentOrder.chapterOrder;
  }

  return scene.storyOrder.sceneOrder < currentOrder.sceneOrder;
}

export function isPriorChronologyScene(scene, currentOrder, currentName) {
  if (currentOrder === null || scene.chronologyOrder === null) {
    return false;
  }

  if (scene.chronologyOrder !== currentOrder) {
    return compareChronologySort(scene.chronologyOrder, currentOrder) < 0;
  }

  return scene.fileName.localeCompare(currentName) < 0;
}

export function formatPriorSceneContext(scenes) {
  if (scenes.length === 0) {
    return "No prior scene context is available. Treat all reader-facing information in this scene as newly available to the reader.";
  }

  return scenes.map(scene => `Scene: ${scene.name}
Story order: ${scene.storyOrder
    ? `${scene.storyOrder.chapterOrder}.${scene.storyOrder.sceneOrder}`
    : "unknown"}
Characters: ${JSON.stringify(scene.characters)}
Plot threads: ${JSON.stringify(scene.plotThreads)}
Arcs: ${JSON.stringify(scene.arcs)}
Text:
${scene.content}`).join("\n\n---\n\n");
}

export function formatPriorChronologyContext(scenes) {
  if (scenes.length === 0) {
    return "No prior chronology context is available. Treat character-facing information in this scene as newly available only if the character can plausibly learn it in this scene.";
  }

  return scenes.map(scene => `Scene: ${scene.name}
Generated chronology sort: ${scene.chronologyOrder ?? "unknown"}
Story order: ${scene.storyOrder
    ? `${scene.storyOrder.chapterOrder}.${scene.storyOrder.sceneOrder}`
    : "unknown"}
Characters: ${JSON.stringify(scene.characters)}
Plot threads: ${JSON.stringify(scene.plotThreads)}
Arcs: ${JSON.stringify(scene.arcs)}
Text:
${scene.content}`).join("\n\n---\n\n");
}
