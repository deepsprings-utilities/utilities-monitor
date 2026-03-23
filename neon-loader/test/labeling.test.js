import test from "node:test";
import assert from "node:assert/strict";
import { extractLabelCodeFromFilename, resolveLabel } from "../src/labeling.js";

test("extractLabelCodeFromFilename finds numeric token", () => {
  assert.equal(extractLabelCodeFromFilename("Deep_Springs_Acquisuite_mb-002.5880AEA2_2.log.csv"), "002");
});

test("extractLabelCodeFromFilename falls back to unknown", () => {
  assert.equal(extractLabelCodeFromFilename("no-code-file.log.gz"), "unknown");
});

test("resolveLabel returns mapped label name", () => {
  const config = {
    labels: {
      "003": {
        labelName: "Boiler Plant Meter",
        deviceAddress: "mb-003",
        physicalGroup: "hydro_plant",
      },
    },
  };
  assert.deepEqual(resolveLabel(config, "foo_mb-003_bar.log.gz"), {
    labelCode: "003",
    labelName: "Boiler Plant Meter",
    deviceAddress: "mb-003",
    physicalGroup: "hydro_plant",
    schemaId: "default_v1",
    hasData: true,
  });
});

test("resolveLabel tolerates unmapped code", () => {
  const config = { labels: {} };
  assert.deepEqual(resolveLabel(config, "foo_mb-009_bar.log.gz"), {
    labelCode: "009",
    labelName: "Unknown Label",
    deviceAddress: "mb-009",
    physicalGroup: "unknown",
    schemaId: "default_v1",
    hasData: true,
  });
});
