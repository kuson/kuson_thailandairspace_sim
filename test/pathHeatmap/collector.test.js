import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore } from "../../src/pathHeatmap/store.js";
import { createCollector } from "../../src/pathHeatmap/collector.js";

function flight(overrides = {}) {
  return {
    id: "abc", lat: 13.75, lon: 100.5, altM: 5000, onGround: false,
    tEpoch: 1_700_000_000_000, ...overrides,
  };
}

describe("collector", () => {
  it("splats airborne flights when recording + browser writer + live on", async () => {
    const store = createMemoryStore();
    const c = createCollector({
      store,
      getSettings: () => ({ recordingOn: true, writer: "browser" }),
      isLiveFlightsEnabled: () => true,
      now: () => 1_700_000_000_000,
      requestWakeLock: async () => null,
    });
    await c.handlePositions([flight(), flight({ id: "def", onGround: true })]);
    const cells = await store.sumRange({ fromBucket: 0, toBucket: 1e12 });
    assert.equal(cells.size, 1);
    assert.ok([...cells.values()][0] >= 1);
  });

  it("does not splat when live flights off", async () => {
    const store = createMemoryStore();
    const c = createCollector({
      store,
      getSettings: () => ({ recordingOn: true, writer: "browser" }),
      isLiveFlightsEnabled: () => false,
      now: () => 1_700_000_000_000,
      requestWakeLock: async () => null,
    });
    await c.handlePositions([flight()]);
    assert.equal(c.getStatus().state, "blocked");
    const cells = await store.sumRange({ fromBucket: 0, toBucket: 1e12 });
    assert.equal(cells.size, 0);
  });

  it("does not splat when writer is sidecar", async () => {
    const store = createMemoryStore();
    const c = createCollector({
      store,
      getSettings: () => ({ recordingOn: true, writer: "sidecar" }),
      isLiveFlightsEnabled: () => true,
      now: () => 1_700_000_000_000,
      requestWakeLock: async () => null,
    });
    await c.handlePositions([flight()]);
    const cells = await store.sumRange({ fromBucket: 0, toBucket: 1e12 });
    assert.equal(cells.size, 0);
  });
});
