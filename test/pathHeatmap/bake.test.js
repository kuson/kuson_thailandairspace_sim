import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveWindow, bakeDensity, densityToRgba, presetToMs } from "../../src/pathHeatmap/bake.js";
import { bucketId } from "../../src/pathHeatmap/gridMath.js";

describe("bake", () => {
  it("resolveWindow for 1h", () => {
    const now = 1_700_000_000_000;
    const w = resolveWindow({ viewPreset: "1h", customFrom: null, customTo: null }, now);
    assert.equal(w.toBucket, bucketId(now));
    assert.equal(w.fromBucket, bucketId(now - 3600_000));
  });

  it("custom range empty when from>=to", () => {
    assert.equal(
      resolveWindow({ viewPreset: "custom", customFrom: 200, customTo: 100 }, 1000),
      null,
    );
  });

  it("bakeDensity normalizes hot cell to ~1", () => {
    const counts = new Map([["1:0", 9], ["0:0", 1]]);
    const d = bakeDensity(counts, { cols: 2, rows: 1 });
    assert.ok(d[1] > d[0]);
    assert.ok(d[1] <= 1 && d[1] >= 0.99);
  });

  it("densityToRgba zeroes empty cells alpha", () => {
    const d = new Float32Array([0, 1]);
    const rgba = densityToRgba(d, 0.5);
    assert.equal(rgba[3], 0);
    assert.ok(rgba[7] > 0);
  });

  it("presetToMs all is Infinity", () => {
    assert.equal(presetToMs("all"), Infinity);
  });
});
