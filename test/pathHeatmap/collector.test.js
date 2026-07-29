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

  it("visibility resume re-evaluates to blocked when live off", async () => {
    let hidden = true;
    let liveOn = true;
    const listeners = new Set();
    const c = createCollector({
      store: createMemoryStore(),
      getSettings: () => ({ recordingOn: true, writer: "browser" }),
      isLiveFlightsEnabled: () => liveOn,
      now: () => 1_700_000_000_000,
      requestWakeLock: async () => null,
      isDocumentHidden: () => hidden,
      addVisibilityListener: (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    });
    await c.handlePositions([flight()]);
    assert.equal(c.getStatus().state, "paused");
    liveOn = false;
    hidden = false;
    for (const fn of listeners) fn();
    await refreshStatusSettled(listeners);
    assert.equal(c.getStatus().state, "blocked");
    assert.equal(c.getStatus().detail, "Enable Live Flights to record");
  });

  it("setRecording does not acquire wake lock when blocked", async () => {
    let wakeLockCalls = 0;
    const c = createCollector({
      store: createMemoryStore(),
      getSettings: () => ({ recordingOn: true, writer: "browser" }),
      isLiveFlightsEnabled: () => false,
      requestWakeLock: async () => {
        wakeLockCalls++;
        return { release: async () => {} };
      },
    });
    await c.setRecording(true);
    assert.equal(wakeLockCalls, 0);
    assert.equal(c.getStatus().state, "blocked");
  });

  it("discards in-flight wake lock when tab backgrounds during acquire", async () => {
    let hidden = false;
    let resolveAcquire;
    let staleLockReleased = false;
    const listeners = new Set();
    const c = createCollector({
      store: createMemoryStore(),
      getSettings: () => ({ recordingOn: true, writer: "browser" }),
      isLiveFlightsEnabled: () => true,
      now: () => 1_700_000_000_000,
      requestWakeLock: () => new Promise((resolve) => {
        resolveAcquire = () => resolve({
          release: async () => { staleLockReleased = true; },
        });
      }),
      isDocumentHidden: () => hidden,
      addVisibilityListener: (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    });
    const ingest = c.handlePositions([flight()]);
    await new Promise((r) => setImmediate(r));
    hidden = true;
    for (const fn of listeners) fn();
    await refreshStatusSettled(listeners);
    resolveAcquire();
    await ingest;
    assert.equal(c.getStatus().state, "paused");
    assert.equal(staleLockReleased, true);
  });
});

/** Drain visibility-triggered refreshStatus queue. */
async function refreshStatusSettled(listeners) {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}
