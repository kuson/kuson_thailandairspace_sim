# Path Heatmap Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an opt-in Traffic heat module that records live ADS-B positions into a time-bucketed density grid (browser + optional sidecar) and renders settable-window heat on the 2D radar and a 3D ground plane.

**Architecture:** LiveFlights emits positions; `src/pathHeatmap/` splats into IndexedDB (5‑min buckets × lon/lat cells × altBin); HeatBake sums a view window into one density map shared by Layer2D (minimap underlay) and Layer3D (additive Three.js plane). One writer at a time (`browser` XOR `sidecar`).

**Tech Stack:** Vanilla ES modules, Three.js 0.170, IndexedDB, `localStorage`, optional Python sidecar (`scripts/path_heatmap_sidecar.py`), Node built-in test runner for pure math (`node --test`).

**Spec:** `docs/superpowers/specs/2026-07-29-path-heatmap-design.md`

## Global Constraints

- Zero-build: no bundler, no new npm dependencies; browser loads via existing `index.html` importmap.
- Do not change LiveFlights LOD caps (`MAX_RENDERED=150`, `TRAIL_MAX_MS=8min`, `TRAIL_MAX_PTS=120`).
- Aggregates only — never store callsign / ICAO24 in the heat store.
- One active writer: `settings.writer` is `browser` | `sidecar` (no dual-write in v1).
- Browser writer requires Live Flights already enabled — HUD prompt only, never auto-enable.
- Altitude bins collected from day one; v1 bake sums airborne bins; stack UI deferred.
- Follow existing settings pattern (`get/set*Settings` + `localStorage` key).
- Pure grid math must be runnable under `node --test` without Three.js / DOM.

---

## File structure

| File | Responsibility |
|---|---|
| `src/pathHeatmap/gridMath.js` | BBox, cell size, bucket id, cell index, record key |
| `src/pathHeatmap/altBins.js` | FL edges → `altBin` 0..3 |
| `src/pathHeatmap/settings.js` | `kuson.pathHeatmap.settings.v1` |
| `src/pathHeatmap/store.js` | IndexedDB + in-memory seam for tests |
| `src/pathHeatmap/collector.js` | Browser splat + Wake Lock + pause status |
| `src/pathHeatmap/bake.js` | Window sum → `Float32Array` density + RGBA ImageData |
| `src/pathHeatmap/layer2d.js` | Hold latest ImageData; draw helper for minimap |
| `src/pathHeatmap/layer3d.js` | `THREE.Group` + DataTexture plane |
| `src/pathHeatmap/index.js` | Façade: wire collector/store/bake/layers |
| `src/pathHeatmap/importShards.js` | Parse sidecar JSONL shards → store.merge |
| `test/pathHeatmap/*.test.js` | `node --test` pure-function tests |
| `scripts/path_heatmap_sidecar.py` | Unattended ADS-B → daily JSONL shards |
| `scripts/path_heatmap_config.json` | Shared bbox/cell/bucket/bins for sidecar |
| Modify `src/liveFlights.js` | `onPositions` callback after `_ingest` |
| Modify `src/main.js` | Construct façade, scene.add, callbacks |
| Modify `src/ui.js` | Traffic heat controls + status + minimap blit |
| Modify `src/uiPrefs.js` | Optional registry id for heat panel block |
| Modify `spec.md` / `state_TODO.md` / `journal.md` | Document feature |

---

### Task 1: Grid math + altitude bins

**Files:**
- Create: `src/pathHeatmap/gridMath.js`
- Create: `src/pathHeatmap/altBins.js`
- Create: `scripts/path_heatmap_config.json`
- Test: `test/pathHeatmap/gridMath.test.js`

**Interfaces:**
- Consumes: `THAILAND_BBOX` values mirrored into config (do not import `flightSources.js` from Node tests — duplicate numeric constants in `gridMath.js` / JSON)
- Produces:
  - `CELL_DEG = 0.02`
  - `BUCKET_SEC = 300`
  - `BBOX = { lamin: 5.5, lomin: 97, lamax: 20.5, lomax: 106 }`
  - `gridSize() → { cols, rows }`
  - `latLonToCell(lat, lon) → { cellX, cellY } | null` (out of bbox → null)
  - `bucketId(epochMs) → number`
  - `recordKey(bucketId, cellX, cellY, altBin) → string`
  - `altBinFromAltM(altM, onGround) → 0|1|2|3` (0 = skip splat)

- [ ] **Step 1: Write failing tests**

```js
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
```

- [ ] **Step 2: Run tests — expect FAIL (module missing)**

```bash
node --test test/pathHeatmap/gridMath.test.js
```

Expected: `ERR_MODULE_NOT_FOUND` for `gridMath.js`

- [ ] **Step 3: Implement `altBins.js` and `gridMath.js`**

```js
// src/pathHeatmap/altBins.js
import { FT_TO_M } from "../coords.js";

export const FL100_M = 10000 * FT_TO_M;
export const FL290_M = 29000 * FT_TO_M;

/** @returns {0|1|2|3} 0 = skip splat */
export function altBinFromAltM(altM, onGround) {
  if (onGround || !(typeof altM === "number") || !Number.isFinite(altM)) return 0;
  if (altM < FL100_M) return 1;
  if (altM < FL290_M) return 2;
  return 3;
}
```

```js
// src/pathHeatmap/gridMath.js
export const CELL_DEG = 0.02;
export const BUCKET_SEC = 300;
export const BBOX = Object.freeze({
  lamin: 5.5, lomin: 97, lamax: 20.5, lomax: 106,
});

export function gridSize() {
  return {
    cols: Math.round((BBOX.lomax - BBOX.lomin) / CELL_DEG),
    rows: Math.round((BBOX.lamax - BBOX.lamin) / CELL_DEG),
  };
}

export function latLonToCell(lat, lon) {
  if (lat < BBOX.lamin || lat >= BBOX.lamax || lon < BBOX.lomin || lon >= BBOX.lomax) {
    return null;
  }
  return {
    cellX: Math.floor((lon - BBOX.lomin) / CELL_DEG),
    cellY: Math.floor((lat - BBOX.lamin) / CELL_DEG),
  };
}

export function bucketId(epochMs) {
  return Math.floor(epochMs / 1000 / BUCKET_SEC);
}

export function recordKey(bucketId, cellX, cellY, altBin) {
  return `${bucketId}:${cellX}:${cellY}:${altBin}`;
}
```

```json
// scripts/path_heatmap_config.json
{
  "bbox": { "lamin": 5.5, "lomin": 97, "lamax": 20.5, "lomax": 106 },
  "cellDeg": 0.02,
  "bucketSec": 300,
  "fl100Ft": 10000,
  "fl290Ft": 29000,
  "queryCenters": [
    { "lat": 16.0, "lon": 100.5 },
    { "lat": 9.0, "lon": 100.0 }
  ],
  "queryRadiusNm": 250,
  "adsbxBase": "https://api.airplanes.live"
}
```

Note: `altBins.js` imports `FT_TO_M` from `coords.js` (no Three.js). That import is fine under Node.

- [ ] **Step 4: Run tests — expect PASS**

```bash
node --test test/pathHeatmap/gridMath.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/pathHeatmap/gridMath.js src/pathHeatmap/altBins.js \
  scripts/path_heatmap_config.json test/pathHeatmap/gridMath.test.js
git commit -m "feat(pathHeatmap): grid math and altitude bins"
```

---

### Task 2: Settings + store

**Files:**
- Create: `src/pathHeatmap/settings.js`
- Create: `src/pathHeatmap/store.js`
- Test: `test/pathHeatmap/store.test.js`

**Interfaces:**
- Consumes: `bucketId`, `recordKey` from `gridMath.js`
- Produces:
  - `DEFAULT_PATH_HEATMAP_SETTINGS` / `getPathHeatmapSettings()` / `setPathHeatmapSettings(patch)`
  - `createMemoryStore()` and `openHeatStore()` → `{ incrementMany(records), sumRange({fromBucket,toBucket}), pruneOlderThan(bucketId), clear(), exportAll() }`
  - Record: `{ bucketId, cellX, cellY, altBin, count }`

Settings shape:

```js
{
  recordingOn: false,
  writer: "browser",          // "browser" | "sidecar"
  viewPreset: "24h",          // "1h"|"6h"|"24h"|"7d"|"all"|"custom"
  customFrom: null,           // epoch ms or null
  customTo: null,
  show2d: true,
  show3d: true,
  opacity: 0.65,
  retentionDays: 14,
}
```

- [ ] **Step 1: Write failing store tests (memory backend)**

```js
// test/pathHeatmap/store.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore } from "../../src/pathHeatmap/store.js";

describe("memory heat store", () => {
  it("increments and sums range", async () => {
    const s = createMemoryStore();
    await s.incrementMany([
      { bucketId: 1, cellX: 10, cellY: 20, altBin: 2, count: 1 },
      { bucketId: 1, cellX: 10, cellY: 20, altBin: 2, count: 1 },
      { bucketId: 5, cellX: 10, cellY: 20, altBin: 2, count: 3 },
    ]);
    const cells = await s.sumRange({ fromBucket: 1, toBucket: 1 });
    assert.equal(cells.get("10:20"), 2); // summed across altBin in range helper
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
```

- [ ] **Step 2: Run — expect FAIL**

```bash
node --test test/pathHeatmap/store.test.js
```

- [ ] **Step 3: Implement `settings.js` and `store.js`**

`settings.js` — mirror `getLiveFlightsSettings` / `setLiveFlightsSettings` in `flightSources.js:248-272` with key `kuson.pathHeatmap.settings.v1`.

`store.js`:
- `createMemoryStore()` — `Map` keyed by `recordKey`, used in tests and as fallback if IDB fails.
- `openHeatStore()` — open DB `kuson-path-heatmap` v1, store `cells`, index `byBucket` on `bucketId`. `incrementMany` reads-modifies-puts in a transaction. `sumRange` uses the index (or full scan if simpler for v1) and aggregates `count` into `Map<"cellX:cellY", number>` summing all `altBin` values.
- On IDB open failure, resolve to memory store and surface `{ backend: "memory"|"idb", error?: string }` via a property `store.backend`.

- [ ] **Step 4: Run tests — expect PASS**

```bash
node --test test/pathHeatmap/store.test.js test/pathHeatmap/gridMath.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/pathHeatmap/settings.js src/pathHeatmap/store.js test/pathHeatmap/store.test.js
git commit -m "feat(pathHeatmap): settings and density store"
```

---

### Task 3: LiveFlights `onPositions` + browser collector

**Files:**
- Modify: `src/liveFlights.js` (`_ingest` end + constructor `onPositions = null`)
- Create: `src/pathHeatmap/collector.js`
- Test: `test/pathHeatmap/collector.test.js`

**Interfaces:**
- Consumes: `NormalizedFlight[]`, `latLonToCell`, `altBinFromAltM`, `bucketId`, store.`incrementMany`
- Produces:
  - `LiveFlightsLayer.onPositions?: (list: NormalizedFlight[]) => void` called once per successful ingest with the raw list
  - `createCollector({ store, getSettings, isLiveFlightsEnabled, now })` → `{ handlePositions(list), getStatus(), dispose(), setRecording(on) }`
  - Status: `{ state: "off"|"recording"|"paused"|"blocked"|"error", detail: string }`

- [ ] **Step 1: Write failing collector tests**

```js
// test/pathHeatmap/collector.test.js
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
```

- [ ] **Step 2: Run — expect FAIL**

```bash
node --test test/pathHeatmap/collector.test.js
```

- [ ] **Step 3: Implement collector + LiveFlights hook**

In `liveFlights.js` constructor add `this.onPositions = null;`. At end of `_ingest(list)` (after the miss/despawn loop):

```js
this.onPositions?.(list);
```

`collector.js` logic:
1. If `!recordingOn` → status `off`, return.
2. If `writer !== "browser"` → status `off` (sidecar mode), return.
3. If `!isLiveFlightsEnabled()` → status `blocked`, detail `"Enable Live Flights to record"`, return.
4. If `document?.hidden` → status `paused`, detail `"paused (tab asleep)"`, return (no splat).
5. Else splat: for each flight with valid cell and `altBin > 0`, push `{ bucketId: bucketId(now()), cellX, cellY, altBin, count: 1 }`; `await store.incrementMany(...)`.
6. Wake Lock: on `setRecording(true)` try `navigator.wakeLock?.request("screen")`; on false / dispose release. Failures → keep recording, do not change status to error.
7. `visibilitychange` listener: when becoming hidden while recording → status `paused`; when visible → next handlePositions resumes `recording`.

- [ ] **Step 4: Run tests — PASS**

```bash
node --test test/pathHeatmap/collector.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/liveFlights.js src/pathHeatmap/collector.js test/pathHeatmap/collector.test.js
git commit -m "feat(pathHeatmap): browser collector and onPositions hook"
```

---

### Task 4: HeatBake

**Files:**
- Create: `src/pathHeatmap/bake.js`
- Test: `test/pathHeatmap/bake.test.js`

**Interfaces:**
- Consumes: store.`sumRange`, `gridSize`, `BBOX`, `CELL_DEG`, settings view fields
- Produces:
  - `resolveWindow(settings, nowMs) → { fromBucket, toBucket } | null` (`null` = empty/invalid custom range)
  - `presetToMs(preset) → number | Infinity` for `1h|6h|24h|7d|all`
  - `bakeDensity(cellCounts, { cols, rows }) → Float32Array` length `cols*rows`, row-major `cellY * cols + cellX`, values in 0..1 after log1p + max-normalize
  - `densityToRgba(density, opacity) → Uint8ClampedArray` length `cols*rows*4` (transparent where ~0; heat colormap blue→cyan→yellow→red)

- [ ] **Step 1: Write failing bake tests**

```js
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
```

- [ ] **Step 2: Run — FAIL; Step 3: implement; Step 4: PASS; Step 5: Commit**

```bash
git add src/pathHeatmap/bake.js test/pathHeatmap/bake.test.js
git commit -m "feat(pathHeatmap): window bake and colormap"
```

Colormap (simple piecewise): t=0 → transparent; else RGB from cold `(20,40,120)` through `(0,200,200)` / `(255,220,60)` to `(220,40,40)`, alpha = `opacity * smoothstep(t)`.

---

### Task 5: Layer2D + minimap integration

**Files:**
- Create: `src/pathHeatmap/layer2d.js`
- Modify: `src/ui.js` (`drawMinimap` — blit heat after map underlay / before airspace bake or after bake and before live blips; prefer **after airspace bake, before live blips** so corridors sit under aircraft)

**Interfaces:**
- Produces: `HeatLayer2D` with `setImageData(imageData, meta)`, `clear()`, `draw(ctx, { cx, cy, wx, wz, scale, geoToWorld })`  
  `meta = { lamin, lomin, lamax, lomax, cols, rows }` — map each cell to world via cell-center lat/lon → `geoToWorld`, then to radar pixels.

Simpler v1 draw approach (acceptable): create an offscreen canvas from ImageData covering the bbox in world metres; `drawImage` with the same transform style as `_minimapBake` (world-aligned quad). Implement `worldBoundsFromBbox()` using `geoToWorld` on SW/NE corners.

- [ ] **Step 1: Manual/visual gate first code** — implement `layer2d.js` with `setImageData` storing canvas; `draw` blits with opacity.

- [ ] **Step 2: In `ui.js` constructor**, add `this._heatLayer2d = null` and `setHeatLayer2d(layer) { this._heatLayer2d = layer; }`.

- [ ] **Step 3: In `drawMinimap`**, after airspace bake blit (~line 3006), before live blips:

```js
this._heatLayer2d?.draw(ctx, {
  cx, cy, wx, wz, scale: SCALE,
});
```

- [ ] **Step 4: Smoke** — temporarily call `setImageData` with a synthetic hot stripe; confirm it appears under blips. Remove synthetic after façade wires bake.

- [ ] **Step 5: Commit**

```bash
git add src/pathHeatmap/layer2d.js src/ui.js
git commit -m "feat(pathHeatmap): 2D radar heat underlay"
```

---

### Task 6: Layer3D ground plane

**Files:**
- Create: `src/pathHeatmap/layer3d.js`

**Interfaces:**
- Consumes: `THREE`, `geoToWorld`, `BBOX`, density RGBA
- Produces: `class HeatLayer3D { constructor(scene); group; setOpacity(n); setVisible(on); setTextureRGBA(uint8, cols, rows); dispose(); }`

Implementation notes:
- One `THREE.Mesh` (`PlaneGeometry(1,1)`), rotated to XZ (`rotation.x = -π/2`), positioned at centroid of bbox in world XZ, scaled to bbox width/depth in metres from `geoToWorld` corners.
- `DataTexture` with `RGBAFormat`, `UnsignedByteType`, `needsUpdate = true`, `magFilter/minFilter = LinearFilter`, `colorSpace = THREE.SRGBColorSpace` (or NoColorSpace if additive looks wrong — pick whichever matches scene; document choice in comment).
- Material: `MeshBasicMaterial({ map, transparent: true, depthWrite: false, opacity: 1 })` — alpha lives in texture; multiply with settings opacity via `material.opacity`.
- Y = 2 m AMSL so it sits just above flat ground without z-fighting.
- `group.visible` driven by `show3d`.

- [ ] **Step 1: Implement `layer3d.js`**
- [ ] **Step 2: Temporary wire in `main.js`** — `scene.add` via constructor; set a synthetic texture; fly over Bangkok and confirm plane. Remove synthetic when Task 7 wires bake.
- [ ] **Step 3: Commit**

```bash
git add src/pathHeatmap/layer3d.js
git commit -m "feat(pathHeatmap): 3D ground heat plane"
```

---

### Task 7: Façade + main + UI controls

**Files:**
- Create: `src/pathHeatmap/index.js`
- Modify: `src/main.js`
- Modify: `src/ui.js` (Display options block after live flights status)
- Modify: `src/uiPrefs.js` (optional `{ id: "trafficHeat", label: "Traffic heat", group: "INFO", sel: "#trafficHeatBlock", default: true }`)

**Interfaces — `PathHeatmapModule`:**
```js
export async function createPathHeatmapModule({ scene, liveFlights, ui, getLiveEnabled }) {
  // open store, collector, layers, wire liveFlights.onPositions
  // return { applySettings(), refreshBake(), dispose(), getStatus() }
}
```

Behavior:
- On construct: `openHeatStore()`, build layers, `ui.setHeatLayer2d(layer2d)`, `scene` already has layer3d.group.
- `liveFlights.onPositions = (list) => collector.handlePositions(list)` (compose if something else needs it — currently nothing).
- When settings change (record / window / opacity / show2d/3d / writer): persist + apply; if window/opacity/show → `refreshBake()`.
- `refreshBake`: `resolveWindow` → if null clear both layers; else `sumRange` → `bakeDensity` → `densityToRgba` → push to 2d+3d.
- Throttle: while recording, rebake at most every 60s or on window change (whichever).
- After successful splat batches, optionally schedule throttled rebake.
- On start: if `retentionDays`, `pruneOlderThan(bucketId(now - retentionDays*864e5))`.
- Status line in UI: `Traffic heat: off | recording | paused (tab asleep) | blocked — enable Live Flights | N cells in view`

UI HTML (insert after `#liveFlightsStatus`):

```html
<div id="trafficHeatBlock">
  <div class="opt" style="margin-top:6px;font-size:11px;opacity:.6;text-transform:uppercase;letter-spacing:.06em">Traffic heat</div>
  <label class="opt"><input type="checkbox" id="optHeatRecord" /> Record traffic heat</label>
  <label class="opt">Writer
    <select id="optHeatWriter" class="opt-select">
      <option value="browser">This browser</option>
      <option value="sidecar">Sidecar import</option>
    </select>
  </label>
  <label class="opt">Window
    <select id="optHeatWindow" class="opt-select">
      <option value="1h">Last 1h</option>
      <option value="6h">Last 6h</option>
      <option value="24h">Last 24h</option>
      <option value="7d">Last 7d</option>
      <option value="all">All recorded</option>
      <option value="custom">Custom…</option>
    </select>
  </label>
  <div id="heatCustomRange" class="opt" style="display:none">
    <input type="datetime-local" id="optHeatFrom" />
    <input type="datetime-local" id="optHeatTo" />
  </div>
  <label class="opt"><input type="checkbox" id="optHeat2d" /> Show on radar</label>
  <label class="opt"><input type="checkbox" id="optHeat3d" /> Show 3D heat plane</label>
  <label class="opt">Opacity <input type="range" id="optHeatOpacity" min="10" max="100" value="65" /></label>
  <button type="button" id="optHeatClear" class="opt">Clear heat data</button>
  <button type="button" id="optHeatImport" class="opt">Import sidecar shards…</button>
  <input type="file" id="optHeatImportFile" accept=".jsonl,.json,application/json" multiple hidden />
  <div id="heatStatus" class="opt" style="opacity:.75;font-size:11px">Traffic heat: off</div>
</div>
```

Wire callbacks in `main.js` analogous to live flights (`ui.onHeatRecordToggle`, etc.).

Confirm dialog before Clear.

- [ ] **Step 1: Implement façade**
- [ ] **Step 2: Wire main + UI**
- [ ] **Step 3: Manual smoke**
  1. Enable Live Flights (mock source OK) + Record.
  2. Wait 2–3 polls → Last 1h heat on radar + 3D plane.
  3. Switch window to custom empty → overlays clear.
  4. Hide tab → status paused; return → recording.
  5. Disable Live Flights while recording → blocked, no new splats.
- [ ] **Step 4: Commit**

```bash
git add src/pathHeatmap/index.js src/main.js src/ui.js src/uiPrefs.js
git commit -m "feat(pathHeatmap): module façade, UI, and main wiring"
```

---

### Task 8: Sidecar + shard import

**Files:**
- Create: `scripts/path_heatmap_sidecar.py`
- Create: `src/pathHeatmap/importShards.js`
- Create: `scripts/path_heatmap_sidecar.md` (run instructions; short)
- Test: `test/pathHeatmap/importShards.test.js`

**Shard format (JSONL, one object per line):**
```json
{"bucketId":123,"cellX":10,"cellY":20,"altBin":2,"count":4}
```

Sidecar:
- Read `scripts/path_heatmap_config.json`
- Poll airplanes.live point API for both centers every `--interval` seconds (default 60)
- Splat like collector; append to `data/path_heatmap_shards/YYYY-MM-DD.jsonl` (gitignore the directory except `.gitkeep`)
- CLI: `python3 scripts/path_heatmap_sidecar.py [--interval 60] [--out data/path_heatmap_shards]`

Import:
- `parseShardText(text) → { records, skipped }` — skip bad lines
- `mergeRecords(store, records)` → `incrementMany`
- UI file picker feeds text to import; toast/status shows imported/skipped counts

- [ ] **Step 1: Write import tests with corrupt lines**
- [ ] **Step 2: Implement import + sidecar**
- [ ] **Step 3: Add `data/path_heatmap_shards/.gitkeep` and ignore `*.jsonl` in `.gitignore`**
- [ ] **Step 4: Dry-run sidecar briefly; import one shard in UI**
- [ ] **Step 5: Commit**

```bash
git add scripts/path_heatmap_sidecar.py scripts/path_heatmap_sidecar.md \
  src/pathHeatmap/importShards.js test/pathHeatmap/importShards.test.js \
  data/path_heatmap_shards/.gitkeep .gitignore
git commit -m "feat(pathHeatmap): sidecar writer and shard import"
```

---

### Task 9: Spec / TODO / journal + regression checklist

**Files:**
- Modify: `spec.md` — new subsection under live flights / overlays describing Traffic heat
- Modify: `state_TODO.md` — add completed path-heatmap tasks once verified
- Modify: `journal.md` — session block
- Modify: `README.md` — one short “Traffic heat” bullet under live flights

- [ ] **Step 1: Run full pure-test suite**

```bash
node --test test/pathHeatmap/*.test.js
```

Expected: all PASS

- [ ] **Step 2: Manual regression**
  - Live flights still LOD-capped; trails still ~8 min
  - Heat off → no bake cost (throttle idle)
  - Reload → settings + IDB density survive
- [ ] **Step 3: Update docs**
- [ ] **Step 4: Commit**

```bash
git add spec.md state_TODO.md journal.md README.md
git commit -m "docs: path heatmap module in spec, TODO, journal, README"
```

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|---|---|
| Density grid aggregation | 1–2 |
| Alt bins from day one | 1, 3 |
| 5-min buckets, IndexedDB, retention prune | 2, 7 |
| Hybrid browser + sidecar, one writer | 3, 7, 8 |
| Presets + custom view window | 4, 7 |
| 2D radar + 3D plane wow | 5, 6, 7 |
| Module sectioned under `src/pathHeatmap/` | all |
| Wake Lock / tab pause status | 3, 7 |
| No LiveFlights LOD changes | 3 (hook only) |
| Clear data / errors / empty window | 2, 4, 7 |
| Tests for pure math + store + collector + bake + import | 1–4, 8 |
| Docs | 9 |

**Deferred (explicit):** dual-writer dedupe, altitude stack UI, track archive — no tasks (correct).

**Type consistency check:** `sumRange` → `Map<"cellX:cellY", number>`; bake uses same key format; settings key `kuson.pathHeatmap.settings.v1`; writer values `browser`|`sidecar`; status states `off|recording|paused|blocked|error`.
