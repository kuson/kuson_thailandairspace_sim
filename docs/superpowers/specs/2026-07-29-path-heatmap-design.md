# Path Heatmap Module — Design Spec

**Date:** 2026-07-29  
**Status:** Approved for planning  
**App:** kuson_thailandairspace_sim (zero-build Three.js Thai airspace trainer)

## Goal

Accumulate live ADS-B aircraft positions into a density grid for as long as recording is enabled (hours to multi-day), then present findings with a clear “wow” in **2D radar** and **3D ground heat** — as an isolated, opt-in module. View window is independent of recording (presets + custom range). Schema is altitude-bin ready so stacked 3D can ship later without re-collecting.

## Non-goals (v1)

- Per-flight track archive / ghost replay
- Dual-writer deduplication (browser + sidecar at once)
- Altitude-stack UI (bins collected; viz later)
- Changing LiveFlights trail LOD (8 min / 150 aircraft caps stay)

## Decisions locked

| Topic | Choice |
|---|---|
| Aggregation | Density grid (not raw tracks) |
| Background | Hybrid: browser default + optional sidecar |
| View time | Presets + custom from–to (recording always continuous while on) |
| First wow | Both 2D radar heat + 3D ground heat plane |
| Writer policy | One active writer at a time (`browser` XOR `sidecar`) |

## Architecture

```
LiveFlightsLayer (existing poll)
        │ onPositions(NormalizedFlight[])
        ▼
PathHeatmapCollector ──► GridStore (IndexedDB)
        │                      ▲
        │                      │ optional shard import
        │                 Sidecar (Python/Node)
        ▼
HeatBake (presets / custom range → density texture)
        ├─► Layer2D  (minimap underlay)
        └─► Layer3D  (THREE.Group, additive ground plane)
```

- Module does **not** own ADS-B fetch; it consumes `NormalizedFlight[]` from LiveFlights.
- Recording on → splat continues whenever the chosen writer can run.
- View window only changes what HeatBake sums.
- Module off → no splat, layers hidden; store retained unless user clears.
- Live cyan trails remain short-horizon; heat is long-horizon.

## Data model

### Grid

- BBox: `THAILAND_BBOX` from `flightSources.js`
- Cell size: ~0.02° (~2 km)
- Key fields: `cellX`, `cellY`, `altBin`, `bucketId`, `count`

### Altitude bins (collect from day one)

| `altBin` | Meaning |
|---|---|
| 0 | On ground / invalid → skip splat in v1 |
| 1 | ≤ FL100 |
| 2 | FL100–FL290 |
| 3 | > FL290 |

v1 bake **sums all airborne bins** into one 2D density. Later stacked 3D filters by `altBin`.

### Time buckets

- `bucketId = floor(epochSec / 300)` → 5-minute slices
- IndexedDB object store with index on `bucketId`
- Record shape: `{ bucketId, cellX, cellY, altBin, count }`
- No callsigns / ICAO24 stored (aggregates only)

### Retention

- Auto-prune buckets older than `retentionDays` (default **14**)
- Independent of view window

### Sidecar parity

- Same bbox, resolution, bin edges, bucket size (shared config / `altBins.js` math)
- Sidecar writes daily shard files; app imports/merges into IndexedDB (`count` adds)

## Collectors

### Browser (default)

- Subscribe to LiveFlights ingest at poll cadence
- Request Wake Lock while recording (best-effort; fail quietly)
- When tab cannot run → status “paused (tab asleep)”; resume on focus
- Batched IndexedDB writes per poll (or short flush interval)

### Sidecar (optional)

- `scripts/path_heatmap_sidecar.py` (or Node equivalent): same ADS-B sources + grid math
- For unattended multi-day runs when the browser tab would sleep
- UI: recording source `browser` | `sidecar` (mutually exclusive in v1)

### Shared rules

- Identical cell / bucket / `altBin` math
- Live Flights must already be enabled for browser writer (no auto-enable; HUD prompts if off)
- Prefer one writer; dual-write deferred

## Visualization

### HeatBake

- Sum buckets in selected window (optional future `altBin` filter)
- Log or percentile stretch for corridor contrast
- Output one `DataTexture` / `ImageData` shared by 2D + 3D
- Rebuild on window change; throttle while live (e.g. every N polls), not every frame

### 2D

- Minimap underlay blit (pattern: airspace bake)
- Toggle + opacity; under blips, above tiles

### 3D (v1 wow)

- `THREE.Group` + ground-aligned plane, additive / heat colormap shader
- Aligned via `geoToWorld` (Bangkok LTP)
- Soft edge fade; opacity slider; Display-options hide
- Later: stacked bands / extruded ribbons per `altBin` using same bake path

### Performance

- No per-flight heat geometry
- When toggles off: no bake, group `visible = false`

## Module layout

```
src/pathHeatmap/
  index.js       # façade
  collector.js   # browser splat
  store.js       # IndexedDB
  bake.js        # window → density
  layer2d.js     # minimap hook
  layer3d.js     # THREE.Group
  settings.js    # localStorage kuson.pathHeatmap.settings.v1
  altBins.js     # shared bin edges
scripts/path_heatmap_sidecar.py
```

### Settings (`kuson.pathHeatmap.settings.v1`)

- `recordingOn`
- `viewPreset` | `customFrom` / `customTo`
- `show2d`, `show3d`, `opacity`
- `retentionDays` (default 14)
- `writer`: `browser` | `sidecar`

### UI

- Display-options / Live block: “Traffic heat”
- Record · Window (1h / 6h / 24h / 7d / All / custom) · 2D/3D · opacity · Clear data · Sidecar help
- `uiPrefs` registry entry
- Wire in `main.js` like LiveFlightsLayer

## Errors

| Condition | Behavior |
|---|---|
| Wake Lock denied / tab asleep | Status paused; resume on focus; sidecar tip |
| IndexedDB quota / open fail | Stop recording; keep last bake; toast + Clear |
| Corrupt sidecar shard | Skip file; report skipped count |
| Live flights off + browser writer | No splat; HUD prompt |
| Empty view window | No overlay (not a blank fake heat) |

## Testing

- Pure functions: cell index, bucket id, altBin, range sum, normalize
- Mock poll → counts increase; custom bake hits expected hot cell
- Prune removes buckets older than `retentionDays`
- Layer off: no bake, `visible = false`
- Manual: record ~10 min → Last 1h on radar + 3D plane; empty custom range → no overlay

## Success criteria

1. Recording can run continuously while enabled (browser when runnable; sidecar for unattended).
2. Presets + custom range change the heat without stopping recording.
3. Both 2D and 3D heat visible and toggleable in one module.
4. Store survives reload; prune respects `retentionDays`.
5. Altitude bins present in stored data for a later stack viz with no re-collect.
6. LiveFlights performance contracts unchanged.

## Implementation order (for planning)

1. `altBins` + `store` + settings  
2. Browser collector + LiveFlights hook  
3. HeatBake + 2D underlay (verify window math)  
4. Layer3D ground plane  
5. UI block + clear/prune  
6. Sidecar script + import path  
7. Tests + smoke + spec/journal notes  

## Open follow-ups (explicitly deferred)

- Dual-writer source tagging  
- Altitude stack UI  
- Track archive / replay  
- Service Worker / SharedWorker experiments (sidecar covers unattended need)
