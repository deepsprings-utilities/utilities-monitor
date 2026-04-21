import test from "node:test";
import assert from "node:assert/strict";
import { physicalGroupForTallRow } from "../src/db.js";

test("physicalGroupForTallRow prefers inferred source_system when not unknown", () => {
  const labelSolar = {
    physicalGroup: "solar_field",
    deviceAddress: "mb-005",
  };
  assert.equal(
    physicalGroupForTallRow({ sourceSystem: "hydro_plant" }, labelSolar),
    "hydro_plant",
  );
  assert.equal(
    physicalGroupForTallRow({ sourceSystem: "solar_field" }, labelSolar),
    "solar_field",
  );
});

test("physicalGroupForTallRow falls back to label when source_system missing or unknown", () => {
  const label = { physicalGroup: "deep_well", deviceAddress: "mb-008" };
  assert.equal(physicalGroupForTallRow({ sourceSystem: "unknown" }, label), "deep_well");
  assert.equal(physicalGroupForTallRow({ sourceSystem: "" }, label), "deep_well");
});
