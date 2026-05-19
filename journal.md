# Thai Airspace Sim — Journal (append-only)

> **Protocol:** Append a new block at the end of this file at the close of every session. Never edit prior blocks. Tick `state_TODO.md` checkboxes only after the corresponding pass criterion is verified. The single source of truth for *what is done* is `state_TODO.md`; this file is the single source of truth for *what happened and why*.

---

## 2026-05-19 (a) — Build dispatches 1–3 (Claude Dispatch, web)

**Operator:** Claude Dispatch (web service), 3 separate dispatches to the same folder.
**Local-time window:** ~12:53–13:03 ICT (Bangkok).
**Inputs:** Build prompt requesting a single-page browser-only Three.js drone sim teaching Thai airspace around Bangkok.

**Outcome — the working tree as found at 2026-05-19 13:40 ICT:**
- `index.html` (entry, importmap to `three@0.170.0`, HUD/minimap/panel/footer DOM, loading splash, styles).
- `src/main.js` (scene, sky gradient, fog, ground tiles 5×5 zoom-8 OSM, N/S/E/W compass, drone bootstrap, render loop).
- `src/drone.js` (6-DoF WASD+QE+mouse, pointer-lock + drag-look, hover, boost, floor clamp).
- `src/airspace.js` (JSON loader, extruded volumes, point-in-volume, vantage points).
- `src/coords.js` (lat/lon ↔ world XZ, slippy tile math, DMS format, bearing→compass).
- `src/ui.js` (HUD, minimap, educational panel, teleport buttons).
- `data/airspaces.json` (17 volumes: 12 authoritative + 5 approximate).
- `README.md`, `LICENSE` (MIT).

**Stability concern raised by operator:** the three dispatches produced an internally consistent result, but never converged through a single review pass. Operator therefore requested an audit.

**Dispatch log files retained in `~/.claude/projects/-Volumes-ExtremeProApple-dev-2026-kuson-thailandairspace-sim/`:**
- `2ec4a4dc-d718-440c-966e-0154dd14e0ad.jsonl` (225 KB, 63 events, 2026-05-19T06:40 UTC). First attempt at the consolidation/review meta-task. Died from `MCP error -32000: Connection closed` mid-investigation. **No source files were written or modified.** Confirmed during that attempt that the original build-dispatch logs are not stored in `~/.claude/projects/` — Claude Dispatch retains its own log surface separately.
- `53fdf4b8-ed6d-4387-ae6c-e06e1485ed14.jsonl` (336 KB, 122 events, 2026-05-19T08:14 UTC). Second attempt at the same meta-task — this is the current session, in progress.

> Per operator instruction "choose only the one I did not rename as -duplicate": no `*-duplicate*` files exist in the project log directory, so both surviving `.jsonl` files are retained.

---

## 2026-05-19 (b) — Consolidation, audit, fix pass

**Operator:** Claude Code (this session — `53fdf4b8…`), Sonnet-class.
**Start:** 2026-05-19T08:14 UTC ≈ 15:14 ICT.
**Objective:** Study the app; produce `spec.md`, `journal.md`, `state_TODO.md`, `claude.md`; review the 3-dispatch code and **fix all bugs**.

### Findings — code review (severity ordered)

| # | Severity | File:line | Finding |
|---|---|---|---|
| 1 | HIGH | `src/drone.js:122` (pre-fix) | `Space` hover toggle was effectively a no-op: it zeroed `vy` only when `keys.size === 0`, but `vy` was already 0 in that branch. README claimed "cuts vertical drift" but there was no drift code to cut. |
| 2 | HIGH | `src/drone.js` (event listeners) | No `window.blur` handler → keys held across Alt+Tab persist in the `keys` Set, leaving the drone flying when focus returns. |
| 3 | MED | `src/drone.js:6` | `PITCH_LIMIT = 89°` causes mouse-look instability near vertical (camera basis becomes near-singular). |
| 4 | MED | `src/drone.js:50–55` (pre-fix) | Redundant `keys.add("shift")` / `keys.delete("shift")` immediately after the same `keys.add(k)` with `k === "shift"`. Dead code. |
| 5 | MED | `src/airspace.js:152–170` (pre-fix) | `vantagePoint(id)` hard-coded a 5 km standoff and `main.js` hard-coded a -0.25 rad teleport pitch. For huge airspaces (VTBD-TMA, 50 NM radius) the user landed at a grazing 14° pitch with the volume off-frame; for tiny ones (VTR2 Chitralada, 1 NM) the standoff was visually far. |
| 6 | LOW | `src/main.js:46` (pre-fix) | `HemisphereLight` added but every material in the scene is `MeshBasicMaterial` (unlit). The light contributed nothing. |
| 7 | LOW | `src/main.js:12` (pre-fix) | `TILE_RANGE = 2` → 25 OSM tiles in a 760 km square. App's stated scope is 300 km radius; 9 tiles (3×3, 456 km square) is sufficient and ~64% fewer requests against OSM. |
| 8 | LOW | `src/ui.js:161–163` (pre-fix) | Minimap drew only the `N` compass tick; `E`/`S`/`W` were missing. Range rings drew without labels. |
| — | DATA | `data/airspaces.json` (VTR8) | Polygon coordinates (12.58–12.88°N, 100.19–100.41°E) land near Sattahip; description says "Kamphaeng Saen" (~14.08°N, ~99.91°E). Already flagged `approximate: true`; left as-is and documented in `spec.md §3.2.2`. |

### Fixes applied (in this session, in order)

1. **`src/drone.js`** — `PITCH_LIMIT` 89° → 85°.
2. **`src/drone.js`** — Removed redundant Shift `add`/`delete`. Added `window.blur → keys.clear()`. Collapsed pointer-lock and drag-look branches into one (identical body). Pitch clamp moved inside the `if (locked || dragging)` block.
3. **`src/drone.js`** — `update()`: rewrote hover so it actually freezes position (`if (!this.hover) { … }` wraps all WASD/QE input). Mouse-look still works in hover. Stale comment on `this.hover` updated.
4. **`src/airspace.js`** — `vantagePoint(id)` returns a `pitch` field. Standoff = `clamp(rmax × 1.0, 3 km, 50 km)`. Altitude = `max(upper × 1.10 + 200, standoff × 0.25)`. Pitch derived so centroid sits ~10° below horizon.
5. **`src/main.js`** — `TILE_RANGE` 2 → 1. Removed `HemisphereLight`. `onTeleport` now uses `v.pitch ?? -0.15` from `vantagePoint`.
6. **`src/ui.js`** — Minimap: added E/S/W ticks; added "Xkm" labels on each range ring's east side.
7. **`README.md`** — Updated tile-grid description from "5×5" to "3×3" and "~760 km" to "~456 km". Updated `Space` row from "cuts vertical drift" to "freezes position — mouse-look still works".

### Decisions

- **Did not** "fix" VTR8 coordinates. Re-doing DDMMSS interpretation from the AIP is out-of-scope for a code audit pass. Status documented in `spec.md` and `state_TODO.md`.
- **Did not** add gravity. Original spec did not mention it; the drone is a free 6-DoF cam, not a quadcopter simulation. Hover meaning is therefore "freeze position", not "counteract gravity".
- **Did not** add E2E or unit tests. App has no test rig; adding one is a separate, scoped task (filed in `state_TODO.md`).
- **Did not** patch `airspace.ftToY()` to interpret `lowerRef`/`upperRef`. Spec §3.2 explicitly accepts the educational simplification (Y=0 ground, AGL≡AMSL, FL≡AMSL, UNL caps at stored `upperFt`).

### Files written this session

- `spec.md` (new — Phase 1 spec, ~200 lines)
- `journal.md` (this file)
- `state_TODO.md` (new)
- `claude.md` (new)
- Edits to `src/drone.js`, `src/airspace.js`, `src/main.js`, `src/ui.js`, `README.md`.

### Pending verification (operator action)

The fixes above are mechanically correct (per code review and consistent edits) but the project ships no automated tests. Operator should run the **Acceptance criteria** in `spec.md §6` in a browser to confirm.

### Session close

- TaskList: all 5 session tasks completed.
- No tools left running, no background processes.
- `state_TODO.md` updated to reflect the post-audit state.

---

<!-- ▼ Append the next session block below this line ▼ -->

## 2026-05-19 (c) — Sim-speed buttons + movement flicker fix

**Operator:** Cursor Agent (Composer).
**Objective:** Add 1×/5×/25×/50×/100× sim-speed buttons; fix on-screen flicker while moving; update `spec.md`, `state_TODO.md`, and this journal.

### Root cause — flicker

| # | Layer | Finding |
|---|---|---|
| 1 | 3D | Standard depth buffer with `near=1`, `far=2_000_000` loses precision at km scale → z-fighting between ground tiles and the fallback plane while the camera moves. |
| 2 | 3D | Overlapping transparent airspace volumes (`depthWrite: false`) were not distance-sorted each frame → classic transparency pop/flicker when flying through nested CTR/TMA rings. |
| 3 | DOM | `updateHUD()` rewrote `#currentInside.innerHTML` every frame even when the inside-set was unchanged → visible overlay flicker. |

### Fixes applied

1. **`src/drone.js`** — `speedMultiplier` (default 1) and `setSpeedMultiplier()`. Movement speed = `CRUISE_SPEED × speedMultiplier × (Shift ? 3 : 1)`. Exported `SPEED_MULTIPLIERS = [1, 5, 25, 50, 100]`.
2. **`src/ui.js`** — HUD sim-speed button row; active-state highlight; SPD line shows active multiplier; HUD fields cached (`_hudCache`) so text/innerHTML updates only when values change.
3. **`index.html`** — `#speedControls` row in HUD; styles for `.speed-btn.active`; controls hint mentions sim-speed buttons.
4. **`src/main.js`** — `logarithmicDepthBuffer: true`; ground fallback at Y=−5 with `renderOrder = -1`; tile meshes at Y=0 with `polygonOffset`; `sortTransparentVolumes()` sets each airspace group's `renderOrder` from camera distance each frame.
5. **`spec.md`**, **`state_TODO.md`**, **`journal.md`** — updated to reflect the new controls and render-stability work.

### Verification

- Local server: `python3 -m http.server 8765` → `http://localhost:8765/index.html`.
- Page loads without console errors; all five sim-speed buttons render; clicking 100× sets `active` state on the button.
- Operator should confirm visually in a desktop browser: faster movement at 25×/100×, and reduced flicker when traversing overlapping volumes.

### Session close

- No git commit (not requested).
- Docs updated: `spec.md §3.3–3.4`, `§4`, `§6`; `state_TODO.md §1`; this block appended.

---

## 2026-05-19 (d) — Flicker v2, compass 5×, labels, radar upgrades, geocode, detail map

**Operator:** Cursor Agent (Composer).
**Objective:** Fix persistent overlap flicker; enlarge horizon compass 5×; add 3D airspace labels, radar FOV + map underlay, Amphoe/Province geocode, higher-detail ground tiles; update docs.

### A — Flicker / overlap (second pass)

Session (c) mitigations were insufficient: solid extruded transparent side walls between nested volumes still produced overlap pop while moving.

**Fix:** Replaced solid `ExtrudeGeometry` side fills with **wireframe cages** — top/bottom `Line`, vertical ribs every ~1/16 of the ring, and a subtle top-cap `ShapeGeometry` disc only. No shared coplanar side walls → no nested-transparency z-fight. Outlines use `depthWrite: true`; caps stay low-opacity with `depthWrite: false`. Groups still sorted back-to-front each frame. Dynamic camera `near`/`far` tightened per altitude.

### B — Compass 5×

Sprite scale `8000×4000` → `40000×20000`; canvas font 96 px → 192 px; poles `4000 m` → `16000 m` tall, `800 m` radius, labels at 12 km.

### C — Map & UI enhancements

| Item | Implementation |
|---|---|
| C1 3D labels | Sprite labels at volume centroid mid-altitude; panel toggles **3D airspace labels** + **Label floor & ceiling (ft)** |
| C2 Radar FOV | Dashed triangle from drone arrow, half-angle = `camera.fov/2`, 80 km reach; toggle above minimap |
| C3 Radar map | OSM zoom-7 tile cache drawn as bottom canvas layer; **Map underlay** checkbox |
| C4 Geocode | `src/geocode.js` → Nominatim reverse, Amphoe + Province in HUD **PLACE** row; ~100 m cache grid, ~1 req/s throttle |
| C5 Detail map | `src/ground.js` `DynamicGround`: zoom-8 base 3×3 + zoom-11 detail 5×5 following drone; tiles disposed when stale |

### Files touched

- **New:** `src/ground.js`, `src/geocode.js`
- **Updated:** `src/main.js`, `src/airspace.js`, `src/ui.js`, `index.html`, `spec.md`, `state_TODO.md`, `journal.md`

### Verification

- `http://localhost:8765/index.html` — loads without console errors; all toggles present; 3D labels + map underlay checkboxes activate.
- Operator should confirm visually: no flicker in nested volumes, readable compass, PLACE populates with network, detail tiles load near drone.

### Session close

- No git commit (not requested).

---

## 2026-05-19 (e) — Fix brown horizon ball, map streaking, pan flicker

**Operator:** Cursor Agent (Composer).
**Objective:** Fix E1 brown horizon ball, E2 weird radar map underlay, E3 pan flicker.

### Root causes

| Error | Cause | Fix |
|---|---|---|
| E1 Brown ball | Low-poly sky sphere with beige gradient band; 40 km compass sprites subtended ~11° at 200 km | Removed sky sphere; flat background + fog. Compass: 192 px font, 12 km sprite scale |
| E2 Weird map | Global tile size for all minimap tiles; `const y` shadowed tile row in `ground.js` | Per-tile bounds, zoom 8, circular clip; renamed to `meshY` |
| E3 Pan flicker | Per-frame camera clip; coplanar base+detail tiles; transparent cap discs | Fixed near/far; detail at Y=0.4; wireframe-only volumes |

### Files touched

`src/main.js`, `src/ground.js`, `src/airspace.js`, `src/ui.js`, `state_TODO.md`, `journal.md`, `spec.md`

### Verification

Browser: no console errors; clean horizon; OSM ground without streaks; radar map aligns when tiles load.

---

## 2026-05-19 (f) — Radar zoom/pan, identify mode, fly-to, live panel title

**Operator:** Cursor Agent (Composer).
**Objective:** Radar interaction, identify mode (`I`), animated catalog fly-to with highlight, dynamic panel title, resume-flight list entry.

### Delivered

| Feature | Implementation |
|---|---|
| Radar zoom/pan | `ui.js`: `_radarCenter`, `_radarScale`; wheel zoom, drag pan, dbl-click recenter on drone |
| Identify mode | `I` key in `drone.js`; `#crosshairs` overlay; `identify.js` ray pick + label layout; highlight fill in `airspace.js` |
| Fly-to animation | `flyto.js` `FlyToController`; 40 000 ft overview via `overviewVantage()`; catalog click saves resume bookmark |
| Panel title | `#panelTitle` updates from `airspacesAt()` each frame |
| Resume entry | First list row after catalog fly-to; animated return via `resumeFlight()` |

### Files touched

- **New:** `src/flyto.js`, `src/identify.js`
- **Updated:** `src/main.js`, `src/airspace.js`, `src/drone.js`, `src/ui.js`, `index.html`, `spec.md`, `state_TODO.md`, `journal.md`

### Verification

- `http://localhost:8765/index.html` — loads; panel title shows live airspaces; catalog click adds Resume row; no new console errors.

### Session close

- No git commit (not requested).

---

## 2026-05-19 (g) — Flight history, GPS start, nationwide airspaces, label scale

**Operator:** Cursor Agent (Composer).
**Objective:** Undo/redo flight history (replace resume), warp fly-to, defaults (100×, GPS, radar map), bigger distance-scaled labels, nationwide airspace catalog.

### Delivered

| Feature | Implementation |
|---|---|
| Flight history | `flightHistory.js` — undo/redo stack; HUD buttons; path samples |
| Warp fly-to | 0.45 s animation; destination is new position; resume row removed |
| Defaults | 100× sim speed; GPS start via `geolocation.js`; radar map on |
| Labels | `updateLabelScales()` — distance scale + 36 px minimum |
| Nationwide data | `scripts/build_airspaces.py` → 68 volumes; panel filter box |

### Session close

- No git commit (not requested).

---

## 2026-05-19 (h) — Speed presets, D/B camera views, radar center aircraft

**Operator:** Cursor Agent (Composer).
**Objective:** Replace sim-speed multipliers with absolute km/h presets; add radar **Center aircraft** toggle; add **D** (nadir) and **B** (rear) camera modes with crosshairs and GPS; polish flight history + docs.

### Delivered

| Feature | Implementation |
|---|---|
| Speed presets | `drone.js` `SPEED_PRESETS`: 1×=50, Cessna 172=226, Learjet=850, Boeing 777=920, 100×=10 000 km/h; `setSpeedPreset(id)`; default 100× |
| Body vs camera | `bodyYaw`/`bodyPitch` for movement; `yaw`/`pitch` for camera; `_applyCameraMode()` for locked views |
| Down view (`D`) | Pitch ≈ −π/2; `#crosshairs` + `#crosshairInfo` nadir lat/lon; radar crosshair on drone marker; mouse-look off |
| Rear view (`B`) | Yaw = body + π; `#viewModeBadge`; mouse-look off |
| Strafe right | Moved from `D` to `ArrowRight` |
| Radar center | `#optRadarCenter` checkbox; `_radarCenter` follows drone each frame when on; drag-pan disabled |
| Flight history | Snapshots store `speedPresetId` (replaces `speedMultiplier`); undo/redo restores camera mode |
| Fly-to | Clears `cameraMode` on start; hover cleared on complete (fixes stuck-movement after warp) |

### Files touched

- **Updated:** `src/drone.js`, `src/ui.js`, `src/main.js`, `src/flyto.js`, `src/flightHistory.js`, `index.html`, `spec.md`, `state_TODO.md`, `journal.md`

### Verification

- Syntax check: `node --check` on modified JS — pass.
- Browser: `http://localhost:8766/index.html` — 68 airspaces load; five preset buttons; Center aircraft + D/B controls present in UI.
- Port 8766 may already be in use from prior session; reuse or pick another port.

### Session close

- No git commit (not requested).
- Docs updated: `spec.md`, `state_TODO.md`; this block appended.

---

## 2026-05-19 (i) — Arrow camera views, HDG compass, aircraft horizon compass, UX defaults

**Operator:** Cursor Agent (Composer).
**Objective:** Restore `D` strafe; map down/left/right views to arrow keys; default radar center aircraft; aircraft-relative horizon N/S/E/W; collapsible drone rules; analog HDG compass in HUD.

### Delivered

| Feature | Implementation |
|---|---|
| Camera views | `↓` down, `←` left, `→` right — toggle same key for front view; removed `B` rear mode |
| Strafe | `D` strafe right restored (no longer down view) |
| Radar default | `Center aircraft` checked on load; `setRadarCenterDefault(true)` in bootstrap |
| Horizon compass | `updateHorizonCompass()` repositions N/S/E/W sprites + poles at drone + 200 km cardinal offset each frame |
| Drone rules | Collapsible `#droneRulesToggle` / `#droneRules`; default collapsed |
| HDG compass | `#hdgCompass` canvas — 5° ticks, N/E/S/W labels, card rotates with heading; digital value right |

### Files touched

- **Updated:** `src/drone.js`, `src/ui.js`, `src/main.js`, `index.html`, `spec.md`, `state_TODO.md`, `journal.md`

### Verification

- `node --check` on modified JS — pass.
- Browser: `http://localhost:8770/index.html` — Center aircraft checked by default; HDG canvas present; drone rules collapsed; 68 airspaces load.

### Session close

- No git commit (not requested).
- Docs updated: `spec.md`, `state_TODO.md`; this block appended.

---

## 2026-05-19 (j) — Horizontal slip HDG compass

**Operator:** Cursor Agent (Composer).
**Objective:** Replace round rotating HDG dial with flat horizontal aviation-style slip compass (`| | N | |` tape).

### Delivered

| Feature | Implementation |
|---|---|
| Slip compass | `_drawHeadingCompass()` redrawn: horizontal baseline, vertical 5° ticks, N/E/S/W on cardinals; tape scrolls with heading; fixed center lubber (triangle + index line) |
| Canvas | 152×26 px flat strip (was 108×44 round dial) |

### Files touched

- **Updated:** `src/ui.js`, `index.html`, `spec.md`, `state_TODO.md`, `journal.md`

### Verification

- `node --check src/ui.js` — pass.
- Browser reload at `http://localhost:8770/index.html` — HDG strip renders; N centers under lubber at north heading.

### Session close

- No git commit (not requested).
- Docs updated: `spec.md`, `state_TODO.md`; this block appended.

---

## 2026-05-19 (k) — HDG compass inertia + identify bottom panel

**Operator:** Cursor Agent (Composer).
**Objective:** Beautify slip compass with inertial tape movement; show identify hits as stacked bottom cards with category-colored backing.

### Delivered

| Feature | Implementation |
|---|---|
| HDG compass | Gradient housing, edge vignette, glowing lubber, 30° numerals; `_smoothCompassHeading()` exponential lag (τ=0.14 s); digital readout stays instantaneous |
| Identify panel | `#identifyPanel` bottom-center stack; `airspace.identifyInfoForIds()`; name, radius (NM), base/ceiling ft; CSS tints per CTR/TMA/Class D/P/R/D |
| Cleanup | Removed floating 3D identify sprites from `setHighlighted`; `layoutIdentifyLabels` no longer called |

### Files touched

- **Updated:** `src/ui.js`, `src/airspace.js`, `src/main.js`, `index.html`, `spec.md`, `state_TODO.md`, `journal.md`

### Verification

- `node --check` on modified JS — pass.
- Browser: press `I` and aim at airspace — bottom cards appear with category colors; turn aircraft — HDG tape lags smoothly.

### Session close

- No git commit (not requested).
- Docs updated: `spec.md`, `state_TODO.md`; this block appended.

---

## 2026-05-19 (l) — Full ENR 5.1 military & P/R/D catalog

**Operator:** Cursor Agent (Composer).
**Objective:** Restore missing military airspaces and include all remaining ENR 5.1 P/R/D areas important for Thailand drone operators.

### Delivered

| Feature | Implementation |
|---|---|
| AIP parser | Rewrote `scripts/build_airspaces.py` — TAIRSPACE-aware coordinate extraction (DDMMSS.ss + DDMM.mm), multi-area splits (`VTD16-1`, `VTD63-2`), semi-circles, TACAN/VOR circles, arc-vertex rows |
| Catalog | **145 volumes** (was 68): 50 airport CTR/TMA + **95 P/R/D** (5 Prohibited, 21 Restricted, 69 Danger) |
| Military | RTAF training/danger areas (VTD16–77), RTN prohibited/restricted (VTP7, VTP36–38, VTR11–13, etc.), RTAF base CTRs added: **VTPI Takhli**, **VTBC Watthana Nakhon**, Khorat, Kamphaeng Saen |
| Merge | Curated `curated_prd.json` overrides parsed approximations for 12 authoritative entries |

### Files touched

- **Updated:** `scripts/build_airspaces.py`, `data/airspaces.json`, `spec.md`, `state_TODO.md`, `journal.md`

### Verification

- `python3 scripts/build_airspaces.py` → 145 airspaces, 0 parse failures.
- JSON schema check — all circles/polygons valid; 67 RTAF/RTN descriptions.
- `node --check` on `main.js`, `airspace.js`, `ui.js` — pass.
- Browser reload at `http://localhost:8770/index.html` — app loads; RTAF filter shows military CTRs + danger/restricted areas.

### Session close

- No git commit (not requested).
- Docs updated: `spec.md`, `state_TODO.md`; this block appended.

---

## 2026-05-20 (a) — AIP parser radius/vertex bug fix, 11 zones corrected

**Operator:** Claude Code (Opus 4.7), session `53fdf4b8…` continued.
**Objective:** Investigate operator report that "Military and 3 Restricted Zones are FAR TOO BIG"; re-source the AIP boundaries; correct the data.

### Findings — three parser bugs in `scripts/build_airspaces.py`

The 2026-05-19 (l) parser pass produced 145 airspaces from the AIP HTML dump, but the dump format glues internal numeric token-IDs directly against numeric data values, e.g.:

```
CircleTAIRSPACE_VERTEX;CODE_TYPE;461 of 3TAIRSPACE_VERTEX;VAL_RADIUS_ARC;461 NM…
```

Here `461` is an internal HTML element ID and `3` is the real radius (3 NM). Three regexes mishandled this:

| Bug | Regex | Effect |
|---|---|---|
| 1. `parse_circle` | `(?:Circle|circle|A semi-circle|semi-circle).*?(?:of\s+)?(\d+(?:\.\d+)?)\s*NM` | Non-greedy `.*?` happily skipped the real `of 3` and grabbed the token-ID `461 NM`. Nine circles inherited radii of 307–461 NM (570–855 km!) instead of 0.5–17 NM. |
| 2. `ARC_VERTEX_RE` | `TAIRSPACE_VERTEX;VAL_RADIUS_ARC;1164(\d{6})([NS])\s+(\d{7})([EW])` | Required exactly 6 digits + N — no decimal seconds. The AIP gives `151305.60N`, so every token-prefixed vertex failed to match. |
| 3. `COORD_PAIR_RE` | `(\d{3,8}(?:\.\d+)?)([NS])…` | Free-form 3–8 digits greedily ate the `1164` prefix into the lat run, yielding `64151305.60` → parsed as 64°15'13"N → outside Thailand → rejected. With every token-prefixed vertex rejected, `parse_area_block` fell through to `parse_tacan_training_circle`, which fired on "arc 30 NM" phrases and rendered VTD34-1 / VTD34-2 as wrong 30 NM circles around PSL DVOR instead of polygons. |

### Impacted airspaces (FROM → TO)

| ID | Name | Source phrase | Before | After |
|---|---|---|---|---|
| VTD24 | Ko Chang, Trat (RTN gun range) | "Circle of 5 NM" | 444 NM (822 km) | 5 NM |
| VTD25 | Ko Tao, Chumphon (RTN weapon range) | "Circle of 5 NM" | 445 NM (824 km) | 5 NM |
| VTD29 | Hin Rakit, Pattani (RTN weapon range) | "Circle of 3 NM" | 461 NM (854 km) | 3 NM |
| VTR3 | Hua Hin Palace | "Circle of 1 NM" | 318 NM (589 km) | 1 NM |
| VTR5 | Phu Phing Palace (Chiang Mai) | "Circle of 2 NM" | 319 NM (591 km) | 2 NM |
| VTR6 | Thaksin Palace (Narathiwat) | "Circle of 5 NM" | 320 NM (593 km) | 5 NM |
| VTR12 | Ko Luam Jettison (Prachuap) | "Circle of 0.5 NM" | 332 NM (615 km) | 0.5 NM |
| VTP36 | Khao Soi Dao Tai (RTN) | "A semi-circle 17 NM" | 307 NM (569 km) | 17 NM (semi→full) |
| VTP37 | Khao Khlong Oa (RTN) | "A semi-circle 14 NM" | 308 NM (570 km) | 14 NM (semi→full) |
| VTD34-1 | Phetchabun/Phichit Area 1 (RTAF) | polygon w/ arc seg | 30 NM circle @ PSL | 7-pt polygon |
| VTD34-2 | Phetchabun/Phichit Area 2 (RTAF) | polygon w/ arc seg | 30 NM circle @ PSL | 7-pt polygon |

The user-reported "3 Restricted zones too big" maps to VTR3, VTR5, VTR6 (the three royal residences). VTR12 was a 4th. "Military too big" was VTD24/VTD25/VTD29 (Danger) and VTP36/VTP37 (Prohibited) — all RTN/RTAF training.

### How the corrected radii were obtained

The "real" values were never lost — they sit in the source `enr51_aip.txt` between `of `/`semi-circle ` and the next `TAIRSPACE_VERTEX` token. A diff script checked all 26 ENR-5.1 circles against the source's `"of N"` / `"semi-circle N"` mentions and flagged exactly the 9 oversized ones. No external web fetch was needed — the AIP source text in `scripts/data/enr51_aip.txt` is authoritative; only the parser was wrong. Independent sanity-check against real-world geography (royal palace columns are 1–5 NM; RTN naval weapon ranges are a few NM; RTAF training corridors are 14–17 NM semi-circles) confirms the corrected values.

### Fixes applied

1. **`scripts/build_airspaces.py`**:
   - `_LAT_DIGITS` / `_LON_DIGITS` use explicit DDMMSS / DDMM / DD lengths instead of `\d{3,8}`, and `COORD_PAIR_RE` adds a `(?<![0-9])` lookbehind so token-ID prefixes can't bleed into the lat digit run.
   - `ARC_VERTEX_RE` made decimal-aware and the literal `1164` prefix relaxed to `\d{3,5}`.
   - `extract_coord_pairs` re-ordered: `ARC_VERTEX_RE` runs **first**, so token-prefixed vertices are consumed correctly before the looser `COORD_PAIR_RE` can grab them.
   - `parse_circle` requires a leading `\b(?:Circle|semi-circle)` (trailing boundary intentionally relaxed for mangled `CircleTAIRSPACE…`), and reads the radius via `\bof\s+(\d+(?:\.\d+)?)(?=\s*(?:NM\b|TAIRSPACE))` or the equivalent `semi-circle N` form. The old "any N NM radius" regex is kept only as a last-resort fallback.

2. **`scripts/data/curated_prd.json`**: locked in the 9 corrected circles plus the 2 polygons-from-AIP-arc cases with descriptive `shortName` / `description` fields. `build_airspaces.py` applies curated overrides last, so even if the parser regresses, the visualised data won't.

3. **Rebuilt `data/airspaces.json`** — 147 volumes (was 145; +2 because the previously-collapsed VTD34-1/VTD34-2 are now properly parsed as polygons, and a couple more parsed entries no longer fall under the `<3 points` rejection).

### Verification

| Check | Result |
|---|---|
| `python3 scripts/build_airspaces.py` | `Wrote 147 airspaces`, 0 errors |
| 20-zone spot-check (9 corrected + 11 controls) | 20/20 pass |
| Top-12-by-area pre vs post fix | 9 entries with >500 NM radius gone; new top is VTR62 (54 k km², per AIP) and VTD58 (35 k km², Andaman Sea, per AIP) — both polygons faithfully parsed from the source |
| `parse_circle` regression test on a polygon block (VTD34, VTD58, VTR62) | All return `None` → polygons parsed via `parse_vertices` ✓ |
| Largest danger circle area | VTD32 at 26 938 km² (50 NM, AIP says so explicitly) |
| `json.load` on the rebuilt file | passes |

### Residual large polygons (NOT bugs — accurately reflect AIP)

- **VTR62** EASTERN AREA (54 k km²) — RTN training corridor along the Thai-Cambodian border. AIP boundary description says "then westward along the Thai-Cambodian border to the starting point." The straight-line closure between point 9 and point 1 overstates the area on the Cambodia side; flagging `approximate: true` is appropriate. Tracing the true border requires a separate dataset (out of scope).
- **VTD58** Surat Thani (35 k km²) — RTAF Andaman Sea flying training area. The polygon includes an arc segment ("then follow the arc 30 NM clockwise from PUTT DVOR/DME") approximated as a chord. Already flagged `approximate: true`.
- **VTD32** Nakhon Ratchasima (27 k km², 50 NM circle) — AIP explicitly says "Circle of 50 NM radius centred on KRT TACAN". Correct as-is.

### Decisions

- Did NOT touch the rendering code (`src/airspace.js`, `src/main.js`). The bug was in the data pipeline; the renderer was correct.
- Did NOT fetch the AIP from the web. The on-disk `scripts/data/enr51_aip.txt` was the authoritative source for all 11 corrections — the parser bug was the only obstacle.
- Did NOT change the `approximate: true` flag on VTR62 / VTD58 / VTD34. Their boundaries depend on geography (Thai-Cambodian border, coastline, arcs) that this Phase-1 visualisation models with straight-line polygons.

### Files written this session

- `scripts/build_airspaces.py` (parser regex fixes)
- `scripts/data/curated_prd.json` (+9 circles, +2 polygons locked in)
- `data/airspaces.json` (regenerated, 147 volumes)
- `journal.md` (this block)
- `state_TODO.md` (updated)
- `spec.md` (updated)

### Pending verification (operator action)

Visually re-open the sim and confirm: the 11 zones above now fit on-map instead of swallowing the country. Specifically the four royal residences (VTR2 Chitralada, VTR3 Hua Hin, VTR5 Phu Phing, VTR6 Thaksin, VTR80 Srapathum) should appear as **small** 1–5 NM no-fly columns, not country-spanning discs.

### Session close

- TaskList: all 9 session tasks complete.
- No git commit (not requested).
- No background processes.

---

## 2026-05-20 (b) — Radar identify highlight + PLACE overlay

**Operator:** Cursor Agent (Composer).
**Objective:** Mirror identify-mode volume highlights on the radar minimap; move PLACE out of the HUD to bottom-right transparent text.

### Delivered

| Feature | Implementation |
|---|---|
| Radar highlight | `drawMinimap()` checks `layer.highlightedIds`; identified / fly-to volumes get brighter fill (`77` alpha), thicker category stroke, dashed accent outline |
| PLACE overlay | Removed `#adminRow` from `#hud`; new `#placeLabel` fixed bottom-right above footer — transparent background, text-shadow for legibility |
| API | `AirspaceLayer.highlightedIds` getter exposes current highlight set |

### Files touched

- **Updated:** `src/ui.js`, `src/airspace.js`, `index.html`, `spec.md`, `state_TODO.md`, `journal.md`

### Verification

- `node --check` on modified JS — pass.
- Browser: press `I` and aim at airspace — volume highlights in 3D and on radar; place name appears bottom-right without panel chrome.

### Session close

- No git commit (not requested).
- Docs updated: `spec.md`, `state_TODO.md`; this block appended.

---

## 2026-05-20 (c) — PLACE center, HDG compass polish, military default

**Operator:** Cursor Agent (Composer).
**Objective:** Move PLACE to bottom-center; fix aviation HDG compass (bottom lubber, large cyan cardinals, no centerline); enable military airspaces by default.

### Delivered

| Feature | Implementation |
|---|---|
| PLACE | `#placeLabel` repositioned bottom-center (`left: 50%`, `translateX(-50%)`) |
| HDG compass | Canvas 176×44; cyan lubber triangle at bottom pointing up; removed vertical centerline; N/E/S/W **15 px bold cyan** in upper tape band (no clipping) |
| Military default | `AirspaceLayer.showMilitary = true`; `#optMilitary` checked on load |

### Files touched

- **Updated:** `src/ui.js`, `src/airspace.js`, `index.html`, `spec.md`, `state_TODO.md`, `journal.md`

### Verification

- `node --check` on modified JS — pass.
- Browser: military volumes visible on first load; PLACE centered above controls hint; HDG lubber at bottom with large cyan cardinals.

### Session close

- No git commit (not requested).
- Docs updated: `spec.md`, `state_TODO.md`; this block appended.
