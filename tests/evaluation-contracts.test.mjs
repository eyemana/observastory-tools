import assert from "node:assert/strict";
import test from "node:test";

import {
  relationshipContractFor,
  relationshipContracts,
  trajectoryContractFor
} from "../evaluators/evaluation-contracts.mjs";

const config = {
  evaluation: {
    relationships: {
      trust: {
        metric: "Trust",
        dimension: "trust",
        targets: ["narrators"],
        valueKind: "score",
        observer: { mode: "entities", target: "character", storageKey: "characters" }
      },
      readerSuspicion: {
        metric: "Reader Suspicion",
        targets: ["*"],
        observer: { mode: "constant", type: "reader", name: "Reader" }
      },
      disabled: {
        enabled: false,
        metric: "Ignored",
        observer: { mode: "constant" }
      }
    },
    trajectories: {
      change: { metric: "Change", targets: ["motifs"] }
    }
  }
};

test("relationship contracts match configured metrics and arbitrary entity targets", () => {
  const narrator = { key: "narrators", target: "narrator", label: "narrator" };
  const motif = { key: "motifs", target: "motif", label: "motif" };

  assert.equal(relationshipContracts(config).length, 2);
  assert.equal(relationshipContractFor(config, "trust", narrator).valueKind, "score");
  assert.equal(relationshipContractFor(config, "Trust", motif), undefined);
  assert.equal(relationshipContractFor(config, "reader suspicion", motif).observer.name, "Reader");
});

test("trajectory contracts are generic capabilities rather than arc rules", () => {
  const motif = { key: "motifs", target: "motif", label: "motif" };
  const arc = { key: "arcs", target: "arc", label: "arc" };

  assert.equal(trajectoryContractFor(config, "change", motif).dimension, "change");
  assert.equal(trajectoryContractFor(config, "change", arc), undefined);
});
