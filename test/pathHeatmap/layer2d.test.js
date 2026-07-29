import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bakeRowToNorthUpRow,
  worldBoundsFromBbox,
} from "../../src/pathHeatmap/layer2d.js";
import { BBOX, latLonToCell, gridSize } from "../../src/pathHeatmap/gridMath.js";

describe("layer2d north-up mapping", () => {
  it("bakeRowToNorthUpRow places north cells at top row", () => {
    const { rows } = gridSize();
    const south = latLonToCell(BBOX.lamin + 0.01, 100);
    const north = latLonToCell(BBOX.lamax - 0.01, 100);
    assert.ok(south.cellY < north.cellY);
    assert.equal(bakeRowToNorthUpRow(south.cellY, rows), rows - 1);
    assert.equal(bakeRowToNorthUpRow(north.cellY, rows), 0);
  });

  it("worldBoundsFromBbox maps lamax to minZ (north edge)", () => {
    const b = worldBoundsFromBbox(BBOX);
    assert.ok(b.minZ < b.maxZ);
  });
});
