// test/pathHeatmap/gridMath.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BBOX, CELL_DEG, BUCKET_SEC, gridSize, latLonToCell, bucketId, recordKey,
} from "../../src/pathHeatmap/gridMath.js";
import { altBinFromAltM, FL100_M, FL290_M } from "../../src/pathHeatmap/altBins.js";

describe("gridMath", () => {
  it("gridSize matches bbox / CELL_DEG", () => {
    const { cols, rows } = gridSize();
    assert.equal(cols, Math.round((BBOX.lomax - BBOX.lomin) / CELL_DEG));
    assert.equal(rows, Math.round((BBOX.lamax - BBOX.lamin) / CELL_DEG));
  });

  it("latLonToCell maps Bangkok near expected cell", () => {
    const c = latLonToCell(13.7563, 100.5018);
    assert.ok(c);
    assert.equal(c.cellX, Math.floor((100.5018 - BBOX.lomin) / CELL_DEG));
    assert.equal(c.cellY, Math.floor((13.7563 - BBOX.lamin) / CELL_DEG));
  });

  it("latLonToCell returns null outside bbox", () => {
    assert.equal(latLonToCell(0, 100), null);
  });

  it("bucketId uses 5-minute floors", () => {
    assert.equal(BUCKET_SEC, 300);
    assert.equal(bucketId(0), 0);
    assert.equal(bucketId(299_999), 0);
    assert.equal(bucketId(300_000), 1);
  });

  it("recordKey is stable", () => {
    assert.equal(recordKey(10, 3, 4, 2), "10:3:4:2");
  });
});

describe("altBins", () => {
  it("skips ground and invalid", () => {
    assert.equal(altBinFromAltM(0, true), 0);
    assert.equal(altBinFromAltM(NaN, false), 0);
  });
  it("bins by FL100 / FL290", () => {
    assert.equal(altBinFromAltM(FL100_M - 1, false), 1);
    assert.equal(altBinFromAltM(FL100_M, false), 2);
    assert.equal(altBinFromAltM(FL290_M - 1, false), 2);
    assert.equal(altBinFromAltM(FL290_M, false), 3);
  });
});
