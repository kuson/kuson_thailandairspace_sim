// test/pathHeatmap/store.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateIncrementRecords,
  createMemoryStore,
} from "../../src/pathHeatmap/store.js";

describe("aggregateIncrementRecords", () => {
  it("merges duplicate recordKey rows before IDB get→put", () => {
    const merged = aggregateIncrementRecords([
      { bucketId: 1, cellX: 10, cellY: 20, altBin: 2, count: 1 },
      { bucketId: 1, cellX: 10, cellY: 20, altBin: 2, count: 1 },
      { bucketId: 5, cellX: 10, cellY: 20, altBin: 2, count: 3 },
    ]);
    assert.equal(merged.length, 2);
    const bucket1 = merged.find((r) => r.bucketId === 1);
    const bucket5 = merged.find((r) => r.bucketId === 5);
    assert.equal(bucket1.count, 2);
    assert.equal(bucket5.count, 3);
  });
});

describe("memory heat store", () => {
  it("increments and sums range", async () => {
    const s = createMemoryStore();
    await s.incrementMany([
      { bucketId: 1, cellX: 10, cellY: 20, altBin: 2, count: 1 },
      { bucketId: 1, cellX: 10, cellY: 20, altBin: 2, count: 1 },
      { bucketId: 5, cellX: 10, cellY: 20, altBin: 2, count: 3 },
    ]);
    const cells = await s.sumRange({ fromBucket: 1, toBucket: 1 });
    assert.equal(cells.get("10:20"), 2);
    const wider = await s.sumRange({ fromBucket: 1, toBucket: 5 });
    assert.equal(wider.get("10:20"), 5);
  });

  it("pruneOlderThan removes old buckets", async () => {
    const s = createMemoryStore();
    await s.incrementMany([
      { bucketId: 1, cellX: 0, cellY: 0, altBin: 1, count: 1 },
      { bucketId: 100, cellX: 0, cellY: 0, altBin: 1, count: 1 },
    ]);
    await s.pruneOlderThan(50);
    const all = await s.sumRange({ fromBucket: 0, toBucket: 1000 });
    assert.equal(all.get("0:0"), 1);
  });

  it("clear empties store", async () => {
    const s = createMemoryStore();
    await s.incrementMany([{ bucketId: 1, cellX: 1, cellY: 1, altBin: 1, count: 9 }]);
    await s.clear();
    const all = await s.sumRange({ fromBucket: 0, toBucket: 10 });
    assert.equal(all.size, 0);
  });
});
