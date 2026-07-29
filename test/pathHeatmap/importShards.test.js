// test/pathHeatmap/importShards.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseShardText,
  mergeRecords,
} from "../../src/pathHeatmap/importShards.js";
import { createMemoryStore } from "../../src/pathHeatmap/store.js";

describe("parseShardText", () => {
  it("parses valid JSONL lines into records", () => {
    const text = [
      '{"bucketId":123,"cellX":10,"cellY":20,"altBin":2,"count":4}',
      '{"bucketId":124,"cellX":11,"cellY":21,"altBin":3,"count":1}',
    ].join("\n");
    const { records, skipped } = parseShardText(text);
    assert.equal(skipped, 0);
    assert.equal(records.length, 2);
    assert.deepEqual(records[0], {
      bucketId: 123, cellX: 10, cellY: 20, altBin: 2, count: 4,
    });
  });

  it("skips corrupt, empty, and invalid lines", () => {
    const text = [
      "",
      "not json",
      '{"bucketId":1,"cellX":0,"cellY":0,"altBin":2,"count":0}',
      '{"bucketId":"x","cellX":1,"cellY":1,"altBin":1,"count":1}',
      '{"bucketId":5,"cellX":2,"cellY":3,"altBin":1,"count":2}',
    ].join("\n");
    const { records, skipped } = parseShardText(text);
    assert.equal(records.length, 1);
    assert.equal(skipped, 4);
    assert.deepEqual(records[0], {
      bucketId: 5, cellX: 2, cellY: 3, altBin: 1, count: 2,
    });
  });
});

describe("mergeRecords", () => {
  it("increments store with parsed shard records", async () => {
    const store = createMemoryStore();
    const records = [
      { bucketId: 1, cellX: 10, cellY: 20, altBin: 2, count: 3 },
      { bucketId: 1, cellX: 10, cellY: 20, altBin: 2, count: 2 },
    ];
    await mergeRecords(store, records);
    const cells = await store.sumRange({ fromBucket: 1, toBucket: 1 });
    assert.equal(cells.get("10:20"), 5);
  });

  it("no-ops on empty records", async () => {
    const store = createMemoryStore();
    await mergeRecords(store, []);
    const cells = await store.sumRange({ fromBucket: 0, toBucket: 10 });
    assert.equal(cells.size, 0);
  });

  it("mergeRecords handles large batches without array spread", async () => {
    const store = createMemoryStore();
    const batch = Array.from({ length: 150_000 }, (_, i) => ({
      bucketId: 1,
      cellX: i % 500,
      cellY: 0,
      altBin: 1,
      count: 1,
    }));
    await mergeRecords(store, batch);
    const cells = await store.sumRange({ fromBucket: 1, toBucket: 1 });
    assert.equal(cells.size, 500);
    assert.equal([...cells.values()].reduce((a, b) => a + b, 0), 150_000);
  });
});
