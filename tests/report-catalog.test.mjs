import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { buildReportCatalog } = require("../report-catalog.cjs");

test("report catalog discovers configured entity types, dimensions, and observers", () => {
  const config = {
    story: {
      entityTypes: {
        narrators: { target: "narrator", label: "narrator", pluralLabel: "narrators" },
        motifs: { target: "motif", label: "motif", pluralLabel: "motifs" }
      }
    },
    standardMetrics: { metrics: { Resonance: { valueKind: "score" } } },
    evaluation: {
      relationships: {
        trust: {
          metric: "Trust", dimension: "trust", targets: ["narrators"], valueKind: "score",
          observer: { mode: "entities", storageKey: "characters" }
        }
      },
      trajectories: {
        change: { metric: "Change", dimension: "change", targets: ["motifs"] }
      }
    },
    scheduler: { evaluations: [
      ["Trust", "Narrator"], ["Change", "Motif"], ["Resonance", "Motif"]
    ] }
  };

  const catalog = buildReportCatalog(config);
  assert.deepEqual(catalog.entityTypes.map(type => type.key), ["motifs", "narrators"]);
  assert.equal(catalog.dimensions.change.valueKind, "movement");
  assert.equal(catalog.dimensions.resonance.valueKind, "score");
  assert.deepEqual(
    catalog.entityTypes.find(type => type.key === "narrators").observersByDimension.trust,
    ["characters"]
  );
  assert.ok(catalog.columns.some(column =>
    column.dimension === "trust" && column.observer === "characters"
  ));
});

test("report catalog augments configuration with canonical observations", () => {
  const pages = [{ ai: { observations: { promises: { Oath: {
    pressure: { metric: "Pressure", dimension: "pressure", valueKind: "score", value: 6, values: { score: 6 } }
  } } } } }];
  const catalog = buildReportCatalog({ story: { entityTypes: {} }, scheduler: { evaluations: [] } }, pages);

  assert.equal(catalog.entityTypes[0].key, "promises");
  assert.equal(catalog.dimensions.pressure.valueKind, "score");
});
