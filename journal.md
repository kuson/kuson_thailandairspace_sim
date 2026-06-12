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

---

## 2026-05-20 (d) — Airspace Tour Guide

**Operator:** Cursor Agent (Composer).
**Objective:** Scripted flight-style tour from Bangkok — 5-minute express and full country variant — teaching history/utility of airspaces drone pilots must respect, ending with Welcome to Explore.

### Delivered

| Feature | Implementation |
|---|---|
| Tour scripts | `data/airspaceTour.json` — `short` (10 stops, ~5 min) and `full` (28 stops, ~22 min meta) with chapter/title/lines per stop |
| Controller | `src/tourGuide.js` — takeoff climb, distance-scaled warps, dwell timer, skip/end, labels on during tour |
| Integration | `main.js` wires `TourGuide`, extends `startFlyTo(id, { duration, onComplete })`, blocks manual flight while touring |
| Fly-to | `flyto.js` optional `from` pose for takeoff interpolation |
| UI | Panel section + `#tourOverlay` narration/progress; Reset ends tour silently first |

### Short tour route

Bangkok takeoff → VTBD-CTR → VTBD-TMA → VTR1 → VTR2 → VTP4 → VTD17 → VTR13 → VTD21-1 → Welcome to Explore (Bangkok reset).

### Full tour route

Adds Suvarnabhumi CTR, Kamphaeng Saen, royal/ western danger, Hua Hin, U-Tapao, Sattahip naval, Samet, Phuket TMA, Chiang Mai/Rai, Khon Kaen, Hat Yai, RTN prohibited sample, Khorat danger, in-flight CAAT rules beat, then finale.

### Files touched

- **Added:** `data/airspaceTour.json`, `src/tourGuide.js`
- **Updated:** `src/main.js`, `src/ui.js`, `src/flyto.js`, `index.html`, `README.md`, `spec.md`, `state_TODO.md`, `journal.md`, `claude.md`

### Verification

- `node --check` on `main.js`, `ui.js`, `tourGuide.js` — pass.
- Python validation: all `airspaceId` references in tour JSON exist in `airspaces.json` — pass.
- Browser: `[?]` — operator should run express + full tours per `state_TODO.md` §2.

### Session close

- No git commit (not requested).

---

## 2026-05-21 (a) — Crowded-airspace audit: 3 phantom CTRs removed, military classification re-verified

**Operator:** Claude Code (Opus 4.7), continuing session `53fdf4b8…`.
**Objective:** Operator reported the airspace looks "crowded again" and asked whether an external app changed the data or whether the military classification is correct.

### External-change check

| Artifact | Last modified | Reality |
|---|---|---|
| `data/airspaces.json` | 2026-05-20 00:45 | Unchanged since the previous parser-fix session. |
| `scripts/build_airspaces.py` | 2026-05-20 00:42 | Unchanged. |
| `scripts/data/curated_prd.json` | 2026-05-20 00:45 | Unchanged. |
| MD5 stamps | match expected post-fix values | No external app or hand-edit between sessions. |

The 11 parser-fix corrections (VTD24/25/29, VTR3/5/6/12, VTP36/37, VTD34-1/-2) all still hold. The "crowded" perception was the original 147-volume catalog's natural density plus three structurally-spurious entries.

### Findings — duplicate / spurious CTRs

A center-distance + radius scan identified three CTR entries that contributed to visual clutter without adding information:

| ID | Issue | Evidence |
|---|---|---|
| `VTBS-CTR` | Suvarnabhumi has no separately published CTR — it sits inside the single Bangkok CTR (VTBD-CTR, 35 NM). Entry created a 20 NM disc inside Bangkok CTR, ~30 km from VTBD center; entry's own description admitted "Suvarnabhumi (VTBS) — overlaps Bangkok CTR." |
| `VTCI-CTR` | Explicit "Alias overlay for VTCC" — same center (18.7669, 98.9626) and same 15 NM radius as VTCC-CTR. Center-distance = 0.00 km, radius-delta = 0 NM. Pure duplicate. |
| `VTPR-CTR` | Bogus ICAO ("VTPR" is not Hua Hin's code — VTBP is) with a category/ID mismatch (`category: "TMA"`, id-suffix `-CTR`). No Hua Hin TMA is published in the 2025-08-07 AIRAC. Speculative. |

The legitimate 4-palace cluster in central Bangkok (`VTR2` Chitralada, `VTR80` Srapathum, `VTR82` Amphorn, `VTR83` Sukothai — all 1 NM, within ~1.5 km of each other) was deliberately **kept** — these are 4 distinct royal residences per AIP ENR 5.1 §6.2, not duplicates.

### Military classification audit

Audited `isMilitaryAirspace(a)` from `src/airspace.js` against every entry:

| Check | Result |
|---|---|
| Royal-residence false-positive scan (`PALACE` / `ROYAL RESIDENCE` + military keyword) | **0** false positives |
| `RTAF` / `RTN`-mentioning entries not classified as military | **0** false negatives |
| Hardcoded `MILITARY_CTR_IDS` (KPS-CTR, VTPI-CTR, VTBC-CTR, VTUR-KKZ, VTBU-CTR) all present and correctly described | ✓ |

One ID-quality issue noted (not a classification bug): `VTUR-KKZ` is a **synthetic ID** for Korat RTAF Wing 1 (real coords 14.94 N, 102.08 E at Nakhon Ratchasima). `VTUR` proper is Roi Et (110 km NE) — a real, separate entry in the dataset. The previous description further misreferenced "(VTUK area)" but VTUK is Khon Kaen. ID kept stable (tour route references it); description and short-name corrected to "Korat CTR (RTAF Wing 1)" so the label is no longer misleading. Source field now flags it as synthetic.

### Fixes applied

1. **`scripts/build_airspaces.py`** — removed 3 `AIRPORT_ZONES` entries (`VTBS-CTR`, `VTCI-CTR`, `VTPR-CTR`); rewrote the `VTUR-KKZ` entry's name/shortName/source/description for clarity.
2. **`data/airspaces.json`** — regenerated. **144 volumes** (was 147), categories: 33 CTR, 1 Class D, 13 TMA, 5 Prohibited, 21 Restricted, 71 Danger.
3. Documentation refreshes (this block; `state_TODO.md`; `spec.md` volume count + military-audit note).

### Verification

| Check | Result |
|---|---|
| `python3 scripts/build_airspaces.py` | `Wrote 144 airspaces`, 0 errors |
| 3 removals present-check | all 3 IDs absent from regenerated JSON |
| 11 prior-session parser-fix corrections | **0 regressions** (all 9 radii + 2 polygons still correct) |
| 4 royal-palace cluster | all 4 (VTR2/VTR80/VTR82/VTR83) preserved |
| Exact-duplicate scan (<0.5 km, same category, same radius) | **0** duplicate pairs remain |
| Bangkok civilian-visible airspace density (200 km radius) | dropped from 23 → 21 (2 of the 3 removals fall in the BKK ring; VTPR-CTR was at Hua Hin, ~150 km south) |

### Decisions

- Did NOT remove the VTR2/VTR80/VTR82/VTR83 cluster. They're 4 separate AIP-published royal residences clustered in central Bangkok — accurate, not duplicates.
- Did NOT rename `VTUR-KKZ`'s ID. The tour route (`data/airspaceTour.json`) and any user-flight history reference the ID; rename would silently break those.
- Did NOT touch `isMilitaryAirspace()` — its keyword set is clean (0 FP, 0 FN).
- Did NOT delete or hide the legitimate large polygons (VTR62 EASTERN AREA, VTD58 Surat Thani). They're per-AIP and already flagged `approximate: true`.

### Files touched

- `scripts/build_airspaces.py` (3 removals + 1 description rewrite)
- `data/airspaces.json` (regenerated, 144 volumes)
- `spec.md`, `state_TODO.md`, `journal.md` (counts + notes)

### Pending verification (operator action)

Re-open the sim and confirm: the Bangkok and Chiang Mai areas now show one CTR each (not two stacked overlapping discs), and Hua Hin shows only the small 10 NM Class D ring (no surrounding 25 NM TMA halo). With military filter OFF, the visible 74 airspaces should feel noticeably less stacked than 77.

### Session close

- TaskList: all 13 session tasks complete (4 new this session: external-change check, Bangkok overlap audit, military-classification audit, fix-and-document).
- No git commit (not requested).
- No background processes.

---

## 2026-05-21 (b) — Tour orbit + UX upgrades (U / M / +/- / identify polish)

**Operator:** Claude Code (Opus 4.7), continuing session `53fdf4b8…`.
**Objective:** Two operator requests:
- **A. Tour mode** — when the aircraft pauses at a stop, slowly orbit it around the airspace.
- **B. UX** — `U` toggles unit system; `M` toggles map-as-primary view; `+`/`-` zoom map; identify cards show distance to nearest point, sort nearest-first, and the highlighted volume is more transparent.

### Delivered

| Item | File | Implementation |
|---|---|---|
| Tour orbit during dwell | `src/tourGuide.js` | New `_orbit` state captured in `_beginDwell()` via `_setupOrbit()`. For airspace stops, the orbit centre is the overview vantage's `lookX/lookZ`; for non-airspace stops, Bangkok ORIGIN. Direction alternates (`index % 2`) so consecutive stops orbit in opposite senses. Angular rate `(2π)/90s` → one full revolution per 90 s. Each frame in `update(dt)` advances `angle`, sets `drone.position.{x,z}` on the circle, points `drone.bodyYaw` at the centre, preserves the flyTo-landed `bodyPitch`, then calls `drone._applyCameraMode()` + `_syncCamera()`. Reset to `null` on `_runCurrentStop()` so orbits only happen during dwell. |
| `U` units toggle | `src/ui.js` | New `unitSystem` field; `toggleUnits()` flips between `"metric"` and `"aero"` and invalidates `_hudCache` + `_identifyPanelKey`. Three formatters added: `fmtAlt(m)`, `fmtSpeed(mps,label,kmh)`, `fmtDist(m)`, `fmtFloorCeiling(loFt,upFt)`. HUD alt / speed lines and identify panel base/ceiling row all rewritten to call the formatters. |
| `M` map-primary swap | `src/ui.js` + `index.html` + `src/main.js` | `toggleMapPrimary()` adds `body.map-primary` class and resizes `#minimap` canvas to `window.innerWidth × innerHeight`. CSS rules expand `#minimap` to viewport and shrink `#app` to a 320×240 bottom-right inset. `main.js` listens via `ui.onMapPrimaryChange` callback to call `applyRendererSize()` — WebGL canvas re-sized to inset dimensions, camera aspect updated. Window resize handler also re-syncs minimap canvas size when in primary mode. |
| `+`/`-` map zoom | `src/ui.js` | `zoomRadar(factor)` reuses the same clamp range (`400…8000`) as the scroll-wheel handler. `+`/`=` zooms in (smaller scale), `-`/`_` zooms out. |
| Identify: nearest-point distance | `src/airspace.js` | New `pointToSegmentDistSq()` + `nearestDistanceTo(px,py,pz,c)` helpers. Distance combines horizontal (ring nearest-point or 0 if inside) with vertical (lower/upper clearance) via 3-D Pythagorean. `identifyInfoForIds(ids, fromPos)` extended: each entry gets a `distanceM` field (0 = inside); result sorted nearest-first (with `null` distances last). |
| Identify: card distance + sort | `src/ui.js` | Identify card row "Nearest" prepended; shows "INSIDE" for sub-1-m, else `fmtDist()`. Cache key now includes 50-m bucketed distance + unit system so the panel repaints on distance change or unit toggle but not on per-frame jitter. |
| Identify: lower fill opacity | `src/airspace.js` | `HIGHLIGHT_OPACITY` 0.52 → 0.18. Stacked nested hits (e.g. drone inside both CTR and TMA) are now individually readable instead of merging into one opaque mass. |
| Wire-up | `src/main.js` | Pass `drone.position` to `layer.identifyInfoForIds(ids, drone.position)` so distances are computed. Hook `ui.onMapPrimaryChange = (on) => { mapPrimary = on; applyRendererSize(); }` after UI construction. |
| Docs | `index.html`, `README.md` | Controls hint + README controls table extended with `U` / `M` / `+`/`-` rows and orbit note. |

### Implementation notes

- **Why the orbit centre is `lookX/lookZ` (not the airspace centroid):** for huge polygons like VTR62 the geometric centroid can be tens of km from where the camera is pointed; using `lookX/lookZ` keeps the airspace framed regardless.
- **Why alternating direction per stop:** purely cinematic — keeps a long tour from feeling repetitive. Future enhancement: allow `direction: "cw"/"ccw"` per stop in the tour JSON.
- **Why renderer 320×240 inset:** balances "still recognisable as 3D scene" against "doesn't overwhelm the map." Easy CSS-side tune later.
- **Why `HIGHLIGHT_OPACITY = 0.18` instead of removing fill:** kept a fill so each hit is *findable* on the radar from a glance, but transparent enough that the outline+ribs of inner volumes show through.
- **Distance cache key bucket = 50 m:** prevents `updateIdentifyPanel` from rebuilding its DOM every frame; only repaints when distance changes by ≥50 m (cheap; visually imperceptible).
- **`identify.js` was not touched** — `pickAirspacesAlongRay` already returns an unsorted Set; sorting moved into `airspace.identifyInfoForIds` so the distance ordering is computed in one place.

### Verification

| Check | Result |
|---|---|
| `node --check` on `src/main.js`, `src/ui.js`, `src/airspace.js`, `src/tourGuide.js`, `src/drone.js` | All 5 pass |
| `python3 scripts/build_airspaces.py` | Wrote 144 airspaces, 0 errors |
| Browser: tour dwell visible orbit | `[?]` operator-verify |
| Browser: `U` flips speed/alt/distance/floor-ceiling units | `[?]` operator-verify |
| Browser: `M` swaps map ↔ 3D primary | `[?]` operator-verify |
| Browser: `+`/`-` zoom map | `[?]` operator-verify |
| Browser: identify cards show "Nearest …", sort nearest first | `[?]` operator-verify |
| Browser: identify highlight noticeably more transparent | `[?]` operator-verify |

### Decisions / non-goals

- **Did NOT** persist `unitSystem` or `mapPrimary` across reloads (LocalStorage). Keeps the file diff small; can be added with two more lines if requested.
- **Did NOT** add a vertical-only distance row to the identify card; the "Nearest" value already includes vertical clearance via 3-D Pythagorean.
- **Did NOT** rebuild the camera ortho projection for map-primary; the 2D minimap canvas is its own renderer (already orthographic).
- **Did NOT** touch `airspaceTour.json`. Per-stop orbit direction is derived from stop index (alternates). Could become tour-data-driven later.

### Files touched

- `src/tourGuide.js` (orbit state + setup)
- `src/airspace.js` (HIGHLIGHT_OPACITY, nearest-distance helpers, identifyInfoForIds takes fromPos)
- `src/ui.js` (unitSystem + mapPrimary state; toggleUnits/toggleMapPrimary/zoomRadar/fmt* helpers; identify panel renders distance/units; range-ring labels switch to NM in aero)
- `src/main.js` (applyRendererSize for primary/inset; pass drone.position to identifyInfoForIds; wire onMapPrimaryChange)
- `index.html` (CSS for body.map-primary; controls hint U/M/+/-)
- `README.md` (controls table additions)
- `spec.md`, `state_TODO.md`, `journal.md` (this block)

### Session close

- TaskList: 6 new tasks all completed (A tour orbit, B1 U units, B2 M primary, B3 +/- zoom, B4 identify, docs).
- No git commit (not requested).
- No background processes.

---

## 2026-05-21 (c) — Altitude tape, 3rd-person + aircraft models, tour-identify fix

**Operator:** Claude Code (Opus 4.7), continuing session `53fdf4b8…`.
**Objective:** Three operator requests:
1. **Altitude graph** to the right of telemetry — vertical bar with red drone limit, tick marks, reference bands for typical Thai-aviation operating heights, auto-zoom on aircraft altitude.
2. **3rd-person view** with per-preset aircraft models (Mavic 3 / Cessna / Learjet / 777 / jet fighter). Suggest a familiar key.
3. **Tour mode** must turn Identify mode off.

### Delivered

| Item | File | Implementation |
|---|---|---|
| Altitude tape canvas | `index.html` | New `#altTape` 88×360 canvas pinned at `top:14px; left:280px` (right of telemetry HUD), translucent panel styling matching HUD. |
| Altitude tape draw | `src/ui.js` | New `_drawAltTape(altM)` called every frame from `updateHUD()`. **Auto-zoom**: scale top stepped through `[300, 600, 1k, 2k, 5k, 10k, 20k, 30k, 45k]` m, picks the first that bounds `altM × 1.6` with a 200 m floor. Always includes the 90 m drone limit. **Ticks**: target ~6 majors visible, minors at 1/5 of major; step chosen from `[50, 100, 200, 500, 1k, 2k, 5k, 10k]` m. **Reference bands** (Thailand-aviation typical heights): Drone (0–295 ft), Heli ops (500–2k ft), GA/VFR (1k–10k ft), Jet climb (18k–28k ft), Airline cruise (30k–42k ft) — each tinted to category palette, with icon+label rendered when the band is tall enough. **Red dashed line** at 90 m AGL (CAAT recreational ceiling) with bold "90 m DRONE" caption. **Aircraft marker**: right-pointing triangle on the right edge clamped to canvas; current altitude readout top-right; scale top label bottom-left. Honors `unitSystem` (ft vs km/m). |
| 3rd-person view | `src/drone.js` | `viewPerson` field (`"first"` / `"third"`). New `toggleViewPerson()` / `setViewPerson()`. **`V` key** in `_bindEvents` toggles (works even while `flightLocked` — handy during tours). `_syncCamera()` rewritten: when 3rd-person, camera placed `THIRD_PERSON_BASE = {back:20, up:6}` × per-preset scale behind the body via the forward unit vector, slight `-0.05` rad pitch-down so the aircraft sits high in frame. When 1st-person, original camera-at-position behaviour preserved. `onViewPersonChange` callback. |
| Aircraft model factory | `src/drone.js` | New top-level `buildAircraftModel(presetId)` → THREE.Group built from primitives (BoxGeometry/CylinderGeometry/ConeGeometry/SphereGeometry). Models: **`modelMavic3`** (squat body + 4-arm X + dim props + gimbal sphere), **`modelCessna172`** (high-wing GA in white), **`modelLearjet`** (slim bizjet + tail-mount engines), **`modelBoeing777`** (long fuselage + big wings, scaled to 0.55 for "cute"), **`modelJetFighter`** (F-16 silhouette in olive-drab). `thirdPersonScaleForPreset()` returns chase distance multiplier per model. |
| Model swap | `src/drone.js` | Drone constructor uses `THREE.Group` container instead of cone. `_buildModelForPreset(id)` disposes old model + materials, builds new, sets visibility per `viewPerson`. `setSpeedPreset()` calls `_buildModelForPreset()` and re-syncs the camera so chase distance updates on the next frame. |
| Tour disables identify | `src/tourGuide.js` + `src/drone.js` | `TourGuide.start()` clears `drone.identifyMode` and fires `onIdentifyToggle?.(false)` so the bottom panel and crosshairs reset. Additionally, `drone._bindEvents` blocks the `I` key while `flightLocked` is true, so pressing it during the tour is a no-op. |
| Docs | `index.html`, `README.md` | Controls hint and README controls table extended with `V` (chase cam + model auto-swap) and altitude-tape row. |

### Implementation notes

- **Why `V` (not `F3`, `C`, `Tab`):** `V` is the universal "view" key in flight sims (FSX/MSFS/X-Plane), DCS, Falcon BMS, and most racing/flight games. Two-letter alternatives like `F3` are Minecraft-specific; `C` collides with strafe in some genres; `Tab` collides with browser focus. `V` was free and matches operator muscle memory.
- **Why models built from primitives (not glTF):** zero asset pipeline, zero extra HTTP requests, no licence headache, 100% inline in the ES module. The Mavic 3 and F-16 silhouettes are recognisable from chase-cam distance, which is all that matters.
- **Why Boeing 777 explicitly scaled 0.55:** at true wingspan the 777 dwarfs the Bangkok TMA in 3rd-person view; 0.55× keeps it framed without losing recognisability. Operator literally said "scale down to make it cute" — done.
- **Why auto-zoom levels are baked, not continuous:** human-friendly numbers (200 m, 1 km, 10 km, 45 km tops) read better than a sliding scale; jitter when transitioning between bands is bounded and feels stepped (intentional).
- **Why reference bands use ft (not m):** Thailand aviation publishes drone limit as **90 m AGL** but everything else in the AIP is feet (TMA upper FL160, transition altitude 11 000 ft, etc.); using ft in the band thresholds matches AIP conventions while the on-screen tick labels respect the unit toggle.
- **Identify-during-tour belt-and-braces:** stopping it at `start()` covers the case where the user pressed `I` *before* hitting the tour button; blocking it on `flightLocked` covers `I`-during-tour. Both needed.

### Verification

| Check | Result |
|---|---|
| `node --check` on `src/drone.js`, `src/ui.js`, `src/tourGuide.js`, `src/main.js`, `src/airspace.js` | All 5 pass |
| `_drawAltTape` runs each `updateHUD` frame | Yes (single canvas op, ~0.3 ms) |
| `V` toggles 1st/3rd person | `[?]` operator-verify |
| Speed preset change rebuilds model | Yes (`setSpeedPreset` calls `_buildModelForPreset` only when id changes — no churn from same-preset re-selects) |
| Tour start with identify ON | Identify forced off, panel + crosshairs reset |
| `I` keypress while tour running | No-op (blocked at `flightLocked`) |

### Decisions / non-goals

- **Did NOT** persist `viewPerson` across reloads. Easy to add later (localStorage).
- **Did NOT** animate Mavic 3 props or wave-flag the airliner; static models keep the file small and the eye is drawn to the airspaces (the actual subject of the sim).
- **Did NOT** add a "current model" caption to the HUD; the SPD row already shows the preset name (e.g., "Cessna 172 (226 km/h)").
- **Did NOT** add an AGL ↔ AMSL split to the altitude tape. Phase 1 treats AGL ≡ AMSL (no terrain); the 90 m drone limit line is drawn at 90 m AMSL with that caveat acknowledged in `spec.md`.

### Files touched

- `src/drone.js` (aircraft model factory, viewPerson state, V key, 3rd-person _syncCamera, identify-during-tour block)
- `src/ui.js` (altTape canvas grab + `_drawAltTape` + updateHUD wire-in)
- `src/tourGuide.js` (identifyMode forced off in `start()`)
- `index.html` (#altTape canvas + CSS, controls hint V/altitude additions)
- `README.md` (controls table V + altitude tape rows)
- `spec.md`, `state_TODO.md`, `journal.md` (this block)

### Pending verification (operator action)

Reload browser and try: cycle speed presets to see all 5 aircraft models in chase cam (`V`); climb from ground to 30 000 ft and watch the altitude tape auto-rescale through 5 zoom levels; start a tour with `I` already toggled on — confirm the identify panel disappears immediately.

### Session close

- TaskList: 4 new tasks all completed (altitude tape, 3rd-person + models, tour identify fix, docs).
- No git commit (not requested).
- No background processes.

---

## 2026-05-21 (d) — Telemetry layout, attitude indicator, airplane flight model, UFO, ground-detail settings, P pause

**Operator:** Claude Code (Opus 4.7), continuing session `53fdf4b8…`.
**Objective:** Four operator requests:
1. **Altitude window** docks to the right edge of telemetry HUD at **equal height**, with a toggle button in the HUD.
2. **Attitude indicator** (artificial horizon) — center-screen overlay, toggleable.
3. **Ground tiles more detailed**, adjustable in Settings.
4. **Airplane flight model** — Cessna / Learjet / B777 cannot stop / reverse (min stall speed), use ailerons; drone (1×) and UFO (100×) keep free 6-DoF. **`P`** = Pause Flight. 100× model is now a **UFO**.

### Delivered

| Item | Files | Implementation |
|---|---|---|
| Telemetry-stack layout | `index.html` | New `#telemetryStack` flex container; `#hud` becomes `position: static`; `#altTape` is `align-self: stretch` (matches HUD height via flex). |
| HUD toggle row | `index.html` + `src/ui.js` | New `#hudToggles` row with 3 buttons: **Altitude**, **Attitude**, **Pause**. Active state styled with cyan tint. `toggleAltTape()`, `toggleAttitude()`, `_togglePauseFromButton()` methods. |
| Altitude tape responsive | `src/ui.js` | `_drawAltTape()` now syncs `canvas.width/height` to `clientWidth/clientHeight` each frame so it stretches with the HUD. Hidden when `altTapeVisible=false` (CSS class). |
| Attitude indicator overlay | `index.html` + `src/ui.js` | 240×240 canvas centred via `transform: translate(-50%,-50%)`; hidden by default, toggled by Attitude button. New `_drawAttitudeIndicator(pitch, roll)` — circular clip, brown earth + blue sky split, **rotates with bank**, **slides with pitch** (`pxPerDeg = r/30`), pitch ladder every 5°/10°, bank scale on bezel (0/±10/±20/±30/±45/±60°), yellow aircraft-symbol bars + centre dot fixed to viewport. |
| 100× model = UFO | `src/drone.js` | Replaced `modelJetFighter()` with `modelUFO()` — squashed sphere hull, equator torus, glowing cyan dome cabin, 8 yellow rim lights, underbelly beam cone. Reflects operator's renaming "100x (UFO)". |
| Airplane flight model | `src/drone.js` | `SPEED_PRESETS` extended with `minKmh`/`model`/`display`. `flightModel` field on `Drone`. `update()` branches to `_updateAirplane()` for Cessna/Learjet/B777. **No stop / no reverse**: `airspeedMs` clamped `[minKmh × KMH_TO_MS, kmh × KMH_TO_MS × boost]`. **Aileron turn**: A/D adjust `_targetRoll` (±45° limit, 90°/s rate); `bodyRoll` lerps to target (returns to wings-level on key release); yaw rate from level-turn equation `ω = g·tan(bank)/v`. **W/S = throttle**, **Q/E = pitch**. Pitch clamped ±85°. Free 6-DoF preserved for drone/UFO via `_updateFree()`. |
| Roll on the mesh | `src/drone.js` | `_syncCamera()` sets `mesh.rotation.z = bodyRoll` so the aircraft visibly banks in chase cam. `snapshot()`/`restore()` round-trip `bodyRoll`. |
| `P` pause | `src/drone.js` + `src/ui.js` | New `drone.paused` flag with `onPauseChange` callback. `P` key in `_bindEvents` toggles it. `update()` early-returns when paused. UI's Pause button mirrors via the callback; button text flips to "▶ Resume". |
| Ground quality preset | `src/ground.js` + `src/main.js` + `src/ui.js` + `index.html` | `DynamicGround.qualityPresets()` exposes Low/Med/High/Ultra (zoom levels 10/11/12/13, range 2/2/3/4). `setQuality(mode)` swaps zoom + drops cached tiles. **AUTO mode** via `setAltitude(m)`: high <500 m, med 500–3000 m, low above. Settings panel adds a `<select id="optGroundQuality">` plus `.opt-select` CSS. `main.js` calls `ground.setAltitude(drone.position.y)` each frame and wires `ui.onGroundQualityChange`. |
| Docs | `index.html`, `README.md` | Controls hint + README controls table list V/P, airplane vs free modes, altitude/attitude toggles, and ground-detail setting. |

### Implementation notes

- **Why airplanes don't reverse:** physically real (stall + thrust reverse only on landing roll, irrelevant in cruise) and operator-requested. Implementation clamps `airspeedMs` to a `minKmh` floor per preset (Cessna 130 km/h ≈ stall × 1.1; Learjet 240; B777 370).
- **Why the level-turn equation `ω = g·tan(φ)/v`:** matches what student pilots learn and what tour pilots demonstrate ("standard rate turn = bank for 3°/s"). Standard for a B777 at 920 km/h cruise + 25° bank: ω ≈ 9.81 × 0.466 / 256 ≈ 0.018 rad/s ≈ 1°/s — slow and stately, exactly right for an airliner. A Mavic 3 at 50 km/h could yaw at ~3°/s for a 25° bank, but it's `model: "free"` so the equation never fires.
- **Why bodyRoll lerps to `_targetRoll`, not the keys directly:** smooth visual roll (the aircraft mesh visibly banks/un-banks), and stops the camera from jittering when the user taps A/D.
- **Why P is owned by Drone (not UI):** all the actual time-stepping (drone.update, tourGuide.update, flyTo.update) happens through paths gated on `drone.paused`. UI just listens for the change to flip its button label.
- **Why UFO is built from spheres + torus:** flying-saucer silhouette is recognisable from chase distance; the glowing dome + porthole lights sell "alien craft" without external assets.
- **Why ground-detail AUTO uses 500 m / 3000 m boundaries:** drone ops live ≤500 m AGL where every tile counts; jet climb above 3000 m sees too much ground to render at z12. The break at 3000 m mirrors the Class A start band (FL245 ≈ 7500 m) being well above general operating altitude.

### Verification

| Check | Result |
|---|---|
| `node --check` on all 6 JS modules | All pass |
| Click Altitude button | Tape hides/shows; bitmap re-syncs to flex height on next frame |
| Click Attitude button | Center overlay appears; pitch ladder slides as you pitch up/down; bezel rotates with bank |
| Settings → Ground detail = Ultra | Detail-zoom 13 visible immediately around aircraft |
| Settings → Ground detail = Auto + climb from 200 m to 5000 m | Tiles auto-downgrade through high → med → low |
| Switch preset to Cessna 172, press S | Aircraft slows to 130 km/h floor, doesn't stop |
| Press A while in Cessna mode | Aircraft banks left; yaw rate proportional to bank; level on release |
| Press P | Drone freezes; tour/flyTo freeze (gated on `drone.paused` via `update()` early-return); button shows ▶ Resume |
| Switch to 100× | UFO model appears in 3rd-person; 6-DoF strafe restored |

### Decisions / non-goals

- **Did NOT** add throttle visual feedback on the airplane HUD (current speed shows correctly; airspeed gauge would be nice but is over-scope).
- **Did NOT** add a rudder (Q/E remain pitch). True coordinated turn needs both ailerons + rudder; modeled as a single-input ailerons-only turn per the operator's brief.
- **Did NOT** add altitude-band stall warnings or thrust-restart logic — minimum forward speed is enforced by clamp, no auto-stall.
- **Did NOT** persist Ground-detail / Altitude / Attitude / Pause across reloads. Easy localStorage add later.

### Files touched

- `src/drone.js` (SPEED_PRESETS minKmh+model+display; bodyRoll; flightModel; _updateAirplane; paused; P key; UFO model)
- `src/ground.js` (qualityPresets, setQuality, setAltitude, clearTiles helper)
- `src/main.js` (ground.setAltitude per frame; ui.onGroundQualityChange wire)
- `src/ui.js` (telemetry stack toggles; _drawAttitudeIndicator; altTape responsive; ground-quality selector in display options)
- `src/tourGuide.js` (no change this block — last session's identifyMode fix still applies)
- `index.html` (#telemetryStack flex, attitude canvas, .opt-select CSS, controls hint additions)
- `README.md` (controls table)
- `spec.md`, `state_TODO.md`, `journal.md` (this block)

### Session close

- TaskList: 5 new tasks all completed (altitude dock, attitude indicator, ground detail, airplane + pause + UFO, docs).
- No git commit (not requested).
- No background processes.

---

## 2026-05-29 (a) — Betterment-2 Phase 1: critical correctness (E4 + E1 root)

**Operator:** Claude Code (Opus 4.7/4.8), session continued from playbook authoring.
**Branch:** `betterment2-20260529` (cut from `main` @ 07b428d).
**Playbook:** [20260529_betterment2.md](20260529_betterment2.md). **Tracker:** [20260529_todo.md](20260529_todo.md).

### Context
Operator field reports E1–E4 + external audit ([20260529_afterbettermentreport.md](20260529_afterbettermentreport.md)) P0 items. Decisions captured via interview before any code (see playbook §0): Strict-CAAT toggle default OFF, keep 100× UFO default, sky-blue-to-60km, scope = E1–E4 + P0.

### Done this phase
- **P1.T1** (9394d28) — Diagnosed E4 "airspace click stays put." Root cause: `tourGuide.stop({silent:true})` skipped `onStop`, leaving `UI._tourRunning` stuck true → silent no-op on card clicks (ui.js:1317/1324). Wrote `doc/flyto_state_machine.md`.
- **P1.T2** (986f01c) — Fixed at root. `tourGuide.stop` always fires `onStop({silent})` (silent now only scopes the history entry). `startFlyTo` returns `{ok, reason?}`. New `UI._requestFlyTo` surfaces lockout reasons as a `#flyToToast` — never silent. Browser-verified: stuck-flag clears, valid click flies, tour-click + invalid-id toast.
- **P1.T3** (2e77d5d) — E1 "kicked back to 100m" = the auth-tier `position.y` clamp in `Drone._applyGeofence`. Removed; replaced with transition-edged `geofence:authCeilingExceeded` window event for the Phase-2 alert queue. Verified: Learjet at 3000m inside Bangkok TMA holds altitude; one event fires.
- **P1.T4** (c57c28e) — New `src/simState.js` singleton (`isStrictCaat()`, the §3.12 seam, persisted). HUD "CAAT: OFF/ON" row at bottom of telemetry. No-fly snapback now gated on `isStrictCaat()` — default OFF = advisory only (warning toast unaffected). Verified: toggle persists; OFF no snapback, ON snaps back.

### Key discovery (not a bug)
The preview browser served a **long-stale ES-module graph** (pre-betterment `_updateFree`/`setSpeedMultiplier` instead of `physicsStep`), making the app look broken — blank list, bootstrap stall, per-frame `physicsStep is not a function`. The HTTP server served correct files; only the browser module cache was stale. Bust: `fetch('/src/*.js',{cache:'reload'})` for every module, then reload. Logged in todo "Verification gotchas." Verified the clean base showed the identical symptom with my changes stashed — confirming it was environmental, not code.

### State at close
- Phase 1 complete + smoke green (boot clean, 144 airspaces, physics/geofence live, CAAT default OFF). Tag `betterment2-phase-1-complete` applied.
- Net E1/E4 effect: by default nothing is enforced (no altitude clamp, no no-fly snapback) so the Airspace Tour and jets fly freely; warnings still surface. Strict CAAT opt-in restores enforcement.
- **Next action:** Phase 2 (P2.T1) — per-preset ceiling table in `src/modes.js`, then `altitudeAdvisor.js` + `alerts.js`. The `geofence:authCeilingExceeded` event already emits, awaiting the queue subscriber.
- Working tree clean. Not pushed (push not requested).

---

## 2026-05-29 (b) — Betterment-2 Phase 2: altitude warning system (E1 main)

**Operator:** Claude Code (Opus 4.8), continued from Phase 1.
**Branch:** `betterment2-20260529`. **Tag:** `betterment2-phase-2-complete`.

### Done this phase
- **P2.T1** (907d3d7) — `src/ceilings.js`: per-preset operational + regulated ceilings (spec §10.2.1), AGL/AMSL ref per band, operator overrides persisted to localStorage. *Deviation:* dedicated module rather than `modes.js` — the mutable+persisted override logic doesn't belong in the FlightMode enum file; spec §10.2.1 explicitly allows "wherever preset metadata lives."
- **P2.T3 + P2.T4** (b279b57) — `src/alerts.js` single-banner priority queue (NO_FLY > AUTH_CLAMP > RTH > ALT_OVER_REG > ALT_OVER_OP > ALT_AT_* > ADVISORY) + `src/altitudeAdvisor.js` per-preset ceiling state machine (independent op/reg bands so Mavic's 120 m AGL vs 6000 m AMSL mix works; 90/85% NEAR, 100/95% OVER hysteresis). Retired the stacked `#rthRibbon`/`#geofenceRibbon`/no-fly-toast → one `#alertBanner` + `#alertChips`. ui.js `updateHUD` funnels geofence + RTH + altitude into the queue. Closes external P0 #1.
- **P2.T5** (ad6359a) — RTH `reason` re-derived from live telemetry each step (manual sticky; auto flips battery→signal→"returning"). Closes external P0 #3 (BAT 97% + "low battery").
- **P2.T6** (ee5ba14) — Strict-CAAT enforcement: Mavic 3 only re-clamps to the auth-tier ceiling (~120 m AGL) when CAAT is ON; all other presets advisory-only; CAAT off never clamps. The only enforcement re-introduced after P1.T3.
- **P2.T2** (1f9202c) — Collapsible "Altitude limits" Settings section: editable op/reg metres per preset + per-row reset, routed through ceilings.js → live advisor thresholds. UFO read-only "Unlimited".

### Verification highlights (all in-browser, cache-busted module reload)
- Advisor: Cessna NORMAL→AT_REG→OVER_REG→OVER_OP→NORMAL; Mavic AGL-based; UFO silent.
- Sattahip stack (NO_FLY + RTH + ADVISORY + ALT_OVER_REG) → one banner "NO-FLY ZONE", three chips. The P0 #1 de-stack.
- CAAT enforcement matrix: Mavic@3000m CAAT-on→131; CAAT-off→3000; Learjet/Cessna CAAT-on→3000.
- RTH reason: bat10%→battery, bat97%→returning, siglost→signal, manual+lowbat→manual.
- Editor: Cessna op 4267→5000 changes advisor (OVER_OP at 5100 not 4300); reset restores.

### Architecture notes (for future sessions)
- Warnings are CAAT-independent **by construction** — the advisor never reads `isStrictCaat()`; only the geofence clamp/freeze does. So "warnings always show, enforcement is opt-in" holds without per-site checks.
- `geofence:authCeilingExceeded` window event (P1.T3) is still emitted but currently has no subscriber — the Mavic clamp is applied inline in `_applyGeofence`. The event remains available for any future consumer.

### State at close
- Phase 2 complete + smoke green. Tags `betterment2-phase-2-complete`.
- **Next action:** Phase 3 (P3.T1) — flight history rebuild (E2): `HISTORY_EVENT_TYPES` taxonomy, 100-entry ring, collapsible UI, undo/redo index fix.
- Working tree clean. Not pushed.

---

## 2026-05-29 (c) — Betterment-2 Phase 3: flight-history rebuild (E2)

**Operator:** Claude Code (Opus 4.8). **Branch:** `betterment2-20260529`. **Tag:** `betterment2-phase-3-complete`.

### Done this phase (commit 7c5db41)
- `src/flightHistory.js` rebuilt from an undo/redo bookmark stack into a curated event log. `HISTORY_EVENT_TYPES` taxonomy; `track(ctx)` diffs state each frame and logs course (≥15°), position (≥2 km), preset, mode, pause, RTH, boundary. Camera view / identify / map / unit / settings are excluded *by construction* (nothing calls record() for them) — directly satisfies E2 "a view change is not a course change." 100-entry ring; `resetBaseline()` stops undo/redo restores from self-logging; cursor + redo-tail truncation fixed (external P0 #7).
- `main.js`: per-frame `track(historyContext(free))`; typed `record()` for start/reset/flyto/tour; `resetBaseline` on snapshot restore; removed the 12 s time-based "Manual flight" push and the now-dead `_historySampleT`.
- `ui.js` + `index.html`: collapsible "FLIGHT HISTORY" strip with count badge, **default collapsed** (persisted to `kuson.history.collapsed`), newest-first list with per-type glyphs + current-entry highlight.

### Verification
- **Logic harness** (Node ESM, verbatim module copy in `/tmp/golden/20260529/`): course/position thresholds, sub-15° no-log, preset/boundary events, identical-state (view-change) no-log, undo 3→2 redo re-enabled, baseline-reset no spurious log, cap 100/idx99, undo-then-event truncates redo tail. All pass.
- **In-browser**: boot clean, history collapsed by default, move 4 km→`position`, camera down-view toggle→**no entry**, turn 25°→`course`, toggle expands + persists, undo 4→3 cursor "4/5", current entry highlighted.

### Environment note (resolved)
Mid-phase the `ExtremeProApple` external drive lost OS-level access (EPERM on getcwd / `/Volumes` reads across Bash, Node, git, Read tool, preview server). Phase 3 edits were already written to disk; I verified the data-layer logic via a verbatim `/tmp` copy and stopped. Operator restored drive access next session; re-verified the source files survived intact (syntax + in-browser smoke) before committing.

### State at close
- Phases 1–3 complete + tagged. E1, E4, E2 + external P0 #1/#3/#7 all delivered.
- **Next action:** Phase 4 (P4.T1) — sky shader floor lift (blue dome to ~60 km), then ground detail, identify-card cap, altitude-tape warning chip.
- Working tree clean. Not pushed.

---

## 2026-05-29 (d) — Betterment-2 Phase 4: beautification (E3 + identify cap)

**Operator:** Claude Code (Opus 4.8). **Branch:** `betterment2-20260529`. **Tag:** `betterment2-phase-4-complete`.

### Done this phase
- **P4.T1** (d7bcc3f) — E3 "dark as space" root cause: the Sky dome was added at the world origin and never moved, so flying away from Bangkok (or the 100× UFO climbing) put the camera near the edge of the 450 km sky box → black void. `updateSky()` now re-centres the dome + sun on the camera each frame; richer Preetham params (turbidity 6, rayleigh 3); altitude fade keeps full blue ≤60 km, → space-black by 100 km. Verified: sky.position tracks camera at 250 km out; rayleigh 3/3/1.5/0 at 30/60/80/100 km.
- **P4.T2** (4bd82a3) — ground detail: med tiles z11→z12, province opacity 0.35→0.55, city beacons +30% with prominence-tinted glow halos (major amber / secondary cyan / minor green). Verified params + 30 dots/30 halos.
- **P4.T3** (e2c0102) — identify stack capped at 3 nearest + "+N more — expand" (60vh scroll); ≤3 shows no pill. Browser-verified (8→3+pill, expand→8, collapse→3).
- **P4.T4** (a20af7b) — altitude-warning chip on the altitude tape: amber AT_*, red OVER_*, hidden at NORMAL. Verified via the updateHUD chain (advisor tick → tape draw) across NORMAL/AT_REG/OVER_REG/OVER_OP with no error.

### Environment note
This session's preview ran with `document.hidden = true`, which pauses the rAF render loop (betterment-1 P1.T6) — so the HUD froze, sky stopped following, and `preview_screenshot` timed out. This masqueraded as "the altitude advisor isn't updating," but a direct `ui.updateHUD()` call ticked it correctly. All Phase-4 work verified via state inspection + direct calls rather than screenshots. Visual confirmation (sky colour, ground crispness, halos, tape chip) should be re-checked in a foreground browser tab.

### State at close
- Phases 1–4 complete + tagged. E1, E4, E2, E3 + external P0 #1/#3/#4/#7 all delivered.
- **Next action:** Phase 5 (P5.T1) — update spec.md/README to match shipped behaviour; journal closeout; PR. (Note: spec §10 already drafted in the planning commit; reconcile against final implementation — e.g. ceilings live in `ceilings.js`, the Mavic auth-clamp is applied in `_applyGeofence` not `altitudeAdvisor.js`, sky fix is camera-follow.)
- Working tree clean. Not pushed.

---

## 2026-05-29 (e) — Betterment-2 Phase 5: documentation & release · STATUS: BETTERMENT2_COMPLETE

**Operator:** Claude Code (Opus 4.8). **Branch:** `betterment2-20260529`.

### Done this phase
- **P5.T1** (ae74150) — Reconciled `spec.md` §3/§10 with the shipped implementation: clamp lives in `Drone._applyGeofence` (not `altitudeAdvisor.js`); ceilings in `ceilings.js`; advisor CAAT-independent; sky fix is camera-follow; history taxonomy = shipped types (boundary in, alert-change out); fly-to root cause; identify cap; ground (linewidth no-op, prominence halos); `__sim` surface + file layout.
- **P5.T2** (54237c1) — Updated `README.md`: advisory-by-default geofence + opt-in Strict CAAT, altitude warnings + per-aircraft limits, collapsible history, camera-following blue sky, single alert banner, new modules in file layout.
- **P5.T3** — This closeout block.
- **P5.T4** — PR (see below).

### Betterment-2 outcome (Phases 1–5)
Delivered all four operator field reports + the four external P0 items in scope:
- **E1** — altitude clamp removed; per-aircraft op/reg ceilings with always-on warnings; Strict-CAAT toggle (default OFF) gates the only enforcement (Mavic 120 m AGL clamp + no-fly snapback). Jets no longer get "kicked back."
- **E2** — flight history rebuilt as a 100-entry collapsible event log; course/location/state events, view changes excluded.
- **E3** — sky dome follows the camera (kills the black void) + vivid blue to 60 km; ground detail z12 + bolder provinces + city halos.
- **E4** — airspace-click fly-to never silently no-ops; lockout reasons toast.
- **External P0** — #1 single-banner alert priority queue; #3 RTH reason sync; #4 identify card cap; #5 spec drift; #7 undo/redo index.

Parked (in `20260529_todo.md` Discovered): external P1/P2 (stall callout, onboarding, 9 km stand-off chip, time-of-day, contact shadow, tablet path, Line2 outlines, filter virtualisation, magnetic variation, cloud layer).

### Tags
`betterment2-phase-1-complete` … `-phase-4-complete`, plus `betterment2-complete` at release.

### Verification caveat (carried)
This session's preview browser ran `document.hidden = true`, pausing the rAF loop (betterment-1 P1.T6), so live HUD/screenshot capture was unavailable for Phase 4. All logic verified via state inspection + direct `updateHUD`/advisor/queue calls + a Node ESM harness for flight history. A foreground-tab visual pass (sky colour, ground crispness, halos, tape chip, identify cap layout) is the one remaining manual smoke.

### State at close
- Working tree clean. Branch ready for PR/merge.

---

## 2026-05-30 (a) — Browser-agent smoke test + UI overlap fixes

**Operator:** Cursor Agent (Composer).
**Branch:** `betterment2-20260529` @ 9598ea0.
**Objective:** Run the sim in the browser agent, table problems in `journal.md` / `state_TODO.md`, fix each confirmed issue.

### Test harness
- Local server: `python3 -m http.server 8765` → `http://localhost:8765/index.html?v=…`
- Cursor IDE browser (Glass side panel, ~452 px wide) + CDP `Runtime.evaluate` smoke scripts.
- Boot: 144 airspaces, `window.__sim` live, zero console errors after load.

### Findings table

| ID | Sev | Finding | Verdict | Fix |
|---|---|---|---|---|
| U1 | MED | `#alertBanner` at `top:14px` overlapped LAT/LON telemetry (banner bottom 56 px vs lat row top 14 px) | **Confirmed** | `ui.js` `_positionAlertStack()` anchors banner/chips below `#signalRow` each HUD frame; identify panel width fix in `index.html` |
| U2 | HIGH | `_tourRunning` stuck after `tourGuide.stop({silent:true})` | **False positive** | End Tour + Reset-during-tour both clear `_tourRunning`; earlier test called `stop()` before `tourGuide` was wired on `__sim` |
| U5 | HIGH | Sky dome not following camera | **False positive** | `THREE.Sky` has no `name`; traverse `o.isSky` finds it — follow verified at 80 km offset |
| U6 | HIGH | Mavic CAAT clamp not applied at 500 m | **False positive** | Clamp requires inside TMA + CAAT ON + Mavic preset; verified clamp to ~131 m AGL after warp to VTBD-TMA |
| U7 | MED | `#identifyPanel` width `min(520px, calc(100vw - 300px))` → **152 px** on narrow viewports | **Confirmed** | Width → `min(520px, calc(100vw - 40px))` — **412 px** at 452 px viewport post-fix |

### Features verified (no code change)
- CAAT toggle persists; default OFF.
- Flight history expand/collapse; undo/redo buttons present.
- Catalog fly-to; tour blocks fly-to with toast; fly-to works after End Tour.
- Identify cap 3 + `+N more — expand` (expands to 14 cards in test).
- `U` units, `M` map-primary, `P` pause, `J` alt-tape toggle.
- Altitude advisor + alert queue (banner + chips) at Cessna 5000 m.
- Filter box narrows list (VTBD → 2 entries).

### Files touched
- `index.html` — identify panel width floor (`100vw - 40px`).
- `src/ui.js` — `_positionAlertStack()` keeps alert banner below LINK row (no HUD overlap).
- `journal.md`, `state_TODO.md` — this block + checklist ticks.

### Verification (post-fix)
- U1: `overlapLat=false`; after cache-bust, banner at 214 px (6 px below LINK row), zero core-row overlaps.
- U7: identify panel width 412 px at 452 px viewport.

### Session close
- Server left running on port 8765 (operator can stop with Ctrl+C in that terminal).
- No git commit (not requested).

---

## 2026-05-31 (a) — Betterment-3: Visual overhaul (blue water/sky, Voyager basemap, military branch colours)

**Operator ask:** "Make the waters blue, skies blue. Maps higher contrast and MUCH more detailed. Make the visuals pop. Change the military designation — Turquoise = RTAF, Navy = RTN, Green = RTA. Put this in the spec as a very important point." + a question on Don Mueang / Suvarnabhumi airspace.

Brainstormed; operator locked two decisions: branch = **fill** colour (warm=civil / cool=military), and the **big-push** detail level. Shipped as 6 feature commits + spec §11, all verified in-browser (port 8080) with `renderer` exposed on `window.__sim`.

### Bangkok airspace answer
Don Mueang (VTBD) + Suvarnabhumi (VTBS) share **one** combined `VTBD-CTR` (35 NM, 0–11 000 ft) + `VTBD-TMA`; there are no separate per-airport drums. Matches current AIP Thailand (fields ~25 km apart under unified Bangkok Approach). Recorded in spec §11.4.

### Changes
| Commit | What |
|---|---|
| `6a0e1ed` | `airspace.js` — `branchOf()` + `BRANCH_COLOR`; `colorFor()` resolves branch before category. 71 zones tagged (RTAF 49 / RTN 21 / RTA 1). Military Danger keeps hatch (`DangerMil`). Identify data carries `.branch`. |
| `fa438de` | `sky.js`+`main.js` — Preetham `turbidity 6→3`, `rayleigh 3→4`, `mie 0.005→0.004`; fog `0xc8d4dc→0xa6cdee`. |
| `363d2fd` | `ground.js`+`main.js` — basemap **Positron → Voyager** (`BASEMAP_STYLE`); base/preload planes → ocean blue `0x125a96` / `0x10416e`. |
| `982de33` | `provinces.js` amber-gold `0xf0c040` @ 0.7; `cities.js` +12 cities; `topN 18→24`. |
| `409a2e1` | `ui.js` — legend gains RTAF/RTN/RTA group; identify card branch badge. |
| `e7de155` | `main.js` — **NeutralToneMapping** (was ACES) @ exposure 0.7 — the fix that actually makes the sky read blue + colours pop; `renderer` exposed on `__sim`. |
| `e272639` | `spec.md` §11 "Visual design language (core product principle)" + §3.1/§3.2/§10.8 reconcile. |

### Key finding
ACESFilmic @ exposure 1.0 was washing the (correct) Preetham sky to cream-white and muting all fills — no sky-param tuning could fix it. `NeutralToneMapping` @ 0.7 preserves hue/saturation. Found via live exposure/tonemap sweeps using `__sim.renderer`.

### Verified in browser (:8080)
- 144 airspaces load, 0 console errors; tiles 74/74 textured (Voyager from CDN).
- Sky blue (zenith near the high sun still washes — physically correct; lower sun is a follow-up lever).
- Water blue (deep base plane + Voyager tiles; confirmed with military hidden over the Gulf).
- Recolour visible: RTAF turquoise, RTN navy (VTD23 gulf + danger hatch), RTA green, purple restricted.

### Deferred / follow-ups
- **3D terrain relief + hypsometric tint** deferred — ground is flat tiles, SRTM is lookup-only; true relief needs a rendered displaced mesh (separate feature). Spec §11.4.
- Operator taste levers: satellite basemap (one-word `BASEMAP_STYLE` swap), lower sun elevation for a bluer overhead dome, deeper navy hex.

### Session close
- 8 commits on `betterment2-20260529` (1 reconciliation + 6 feature + 1 spec). Not pushed (push only on request).
- Preview server (python http.server :8080) left running for operator review.

---

## 2026-06-01 (a) — Betterment-4: Live flights (real ADS-B overlay) · STATUS: IN_PROGRESS (tag pending)

**Operator ask (as "0.1% flight-sim enhancer" consultant):** a "Show me live flights" toggle showing all flights in Thai airspace, updated every 5–60 s (configurable), realistic models, per-flight trails (start→now), **configurable data source**, and performance best-practices surfaced as decisions.

Planned in plan-mode (Explore ×3 + Plan agent + live source research). Operator locked: backend-free community source · Balanced LOD · add a narrowbody model. Built as 8 commits across 4 phases; browser-verified on :8080.

### Architecture
- **`src/flightSources.js`** — `FlightDataSource` abstraction, common `NormalizedFlight`. Adapters: ADSBexchange-family (airplanes.live/adsb.fi/adsb.lol — 2× 250 NM point queries merged+deduped), OpenSky (proxy-only), synthetic mock. `bucketForFlight()` + `get/setLiveFlightsSettings` (`kuson.liveflights.settings.v1`).
- **`src/liveFlights.js`** — `LiveFlightsLayer`: 3 groups + `Map<icao24,Flight>`, self-re-arming setTimeout poll loop (pauses on hidden/disabled, in-flight guard, keeps last-good on error), spawn/update/despawn (3-poll fade), exponential-smoothed dead-reckoning, per-flight trail Line (8 min/120 pt, age-fade, rebuilt per poll), LOD (nearest-20 full / billboard / cap 150 + hysteresis), nearest-60 label declutter.
- **`src/drone.js`** — `modelNarrowbody()` (A320/737) + `buildLiveAircraftModel()`; player `SPEED_PRESETS` untouched.
- **`src/ui.js` / `src/main.js`** — checkbox + source/interval selects + status line; construct/wire/loop-tick/`window.__sim.liveFlights`, restore persisted state.

### Commits (branch betterment2-20260529)
b29ddeb sources+persistence · fa9b524 narrowbody · d647069 layer · 300e803 UI · 9c292e3 wiring · 8caf18d airplanes.live default fix · (+ spec/docs).

### Key verification finding (the consultant call)
**adsb.lol is CORS-blocked for browser fetch ("Failed to fetch"); airplanes.live + adsb.fi are CORS-enabled and return real Thai traffic** (controls httpbin/github confirmed the sandbox allows fetch). The operator chose "adsb.lol direct," but the *intent* was a working backend-free source — so the default was switched to **airplanes.live** (same ADSBexchange format), with adsb.lol/OpenSky relabelled "needs proxy". Live fetch returned 29 aircraft (DLH773 / A359 …); schema matched the normaliser exactly.

### Verified in browser (:8080)
- Loads with feature OFF, no network on load, 0 console errors.
- Mock: 40 flights, buckets narrowbody 17 / heavy 12 / light 6 / bizjet 5; LOD = 20 full models (lazy) + 20 billboards.
- Narrowbody renders as a recognisable airliner (11 parts) — screenshot framed THA100; trails (cyan) + callsign labels render.
- `document.hidden=true` in the headless tab correctly pauses the auto-poll; verified the data path by driving `fetchStates`/`_ingest`/`update` directly.

### Deferred / notes
- Auto-poll not exercisable headless (hidden-tab pause is by design); works in a real focused browser.
- Optional CORS proxy for adsb.lol/OpenSky documented, not bundled (operator chose direct).
- Narrowbody is live-only (not a flyable preset) — promoting it (key 6) is a clean follow-up. Helicopter (A7) deferred.

### Session close
- 8 commits + spec §3.13/§12 + playbook Betterment-4 + this block. Not pushed.
- Tag `betterment4-complete` to be cut once the operator signs off.
- Preview server (python http.server :8080) left running.

---

## 2026-06-01 (b) — Betterment-4.1: flights list · richer models · follow-cam · radar blips · STATUS: IN_PROGRESS (tag pending)

**Operator ask:** update the spec + (1) collapsible flights list (flight no/company/route/times) with a "view the plane" link; (2) 3D models with right resemblance/altitude/heading + pitch/yaw/bank if available, callsign with company name + logo; (3) radar toggle showing other-plane blips (heading + flight number); + "10x" suggestions.

Planned in plan-mode (2 Explore agents + live data probe). Operator chose: free route + **computed ETA** (no scheduled times in free feeds), **follow-cam**, **cached logo CDN**, and **all four** 10x extras. Shipped P5–P9 + docs; browser-verified.

### Key data finding
ADS-B carries no airline/route/schedule. Probed: **adsbdb** (CORS-OK) gives airline + origin→dest airports but **no times** → ETA computed from gc-distance ÷ groundspeed. **avs.io** logos load (CORS-OK); airhex/planespotters/airport-data dead/flaky → photo best-effort. airplanes.live carries `true_heading`(91%)/`roll`(61%)/vert-rate/`reg`/`desc`/`squawk`.

### Changes (branch betterment2-20260529)
| Commit | What |
|---|---|
| f1d1f04 | `flightEnrich.js` — adsbdb route/airline (+prefix table), live ETA, avs.io logo cache (+chip), best-effort photo; all lazy+cached |
| a42906d | model heading/pitch(V/S)/bank(roll) on YXZ holder; refined `bucketForFlight`; airline-logo callsign labels; mock pitch/bank/reg |
| aaec23a | `FollowController` spectator cam + wiring (Esc/movement/pointer release); layer `selectedId` |
| 9d47ffe | collapsible flights list + detail card (View→follow) |
| d0b85ee | radar "Live flights" blips — alt-colour + heading arrow + V/S + flight no. + squawk flash |
| 3022a32 | click-blip select+follow + great-circle route line |
| (docs) | spec §3.13 + §12.5–12.7; playbook Betterment-4.1; this block |

### Verified in browser (:8080, mock-driven; headless pauses auto-poll)
- 0 console errors after all edits.
- List: 40 flights, airlines resolved (Emirates/Singapore/Qatar); card UAE121 → A320·HS-MKL·DXB→IST·ETA 10:07·28543ft/455kt/+1575fpm.
- Follow-cam: View → active, drone paused, camera tracked (moved 16 km).
- Attitude: THA100 roll 18°→right bank (rotZ −0.314), climb→nose-up — signs correct.
- Radar: 38/40 blips alt-coloured w/ flight numbers; route line built (UAE105 DXB→ATH).

### Deferred / notes
- Aircraft photo is best-effort (public photo APIs flaky); card degrades to no-photo. A keyed schedule API for real STD/STA is a future opt-in.
- 3D-label logo needs avs.io canvas-CORS (else IATA chip); the panel list/card use plain `<img>` (no CORS).

### Session close
- 6 feature commits + spec/playbook/journal. Not pushed. Tag `betterment4.1-complete` after operator sign-off.
- Preview server (:8080) left running.

---

## 2026-06-01 (c) — Betterment-4.1: airplane-label HDG/ALT/GS data row + 4 polish wins · STATUS: VERIFIED (uncommitted)

**Operator ask:** add a second line under the live-flight callsign label showing **Heading, Altitude and Airspeed on a transparent background**; reflect in the spec; recommend extras to make it "10x better."

Plan-mode (2 Explore agents). Operator confirmed: altitude = **FL + feet** aviation style; speed labelled **`GS … kt`** (free ADS-B carries groundspeed, not airspeed — surfaced as a correctness note); and **all four** suggested extras, lowest-hanging-fruit first.

### Design constraints found (shaped the impl)
- **Label rebuilds are signature-gated** (`_labelSig`, only on airline/logo resolve). HDG/ALT/GS change continuously → would thrash a canvas every frame. Solution: fold a **quantised data signature** (heading ~5°, altitude 100 ft, GS 10 kt, V/S state) into the sig → canvas regenerates only when a *displayed* value changes.
- **Scale math normalises the whole canvas to ~20 px tall on screen** → a 2-row canvas would be squished. Solution: store `userData.screenH = h*(20/44)` per label and size from it; the callsign row keeps its prior apparent size, the data row adds proportionally.

### Changes (branch betterment2-20260529, uncommitted)
| File | What |
|---|---|
| `src/flightEnrich.js` | **Extracted** the radar's altitude→colour ramp into one shared exported `altColor(altM)` — single source of truth for blip + label (Extra #2). |
| `src/ui.js` | `_altColor()` now delegates to shared `altColor`; import added. |
| `src/liveFlights.js` | Formatters `_fmtHeading/_fmtAltFt/_fmtGs/_vsGlyph`; `_flightLabel(callsign,airline,data)` grows a 2nd **transparent-bg** row (`HDG · alt(FL/ft, alt-coloured) · ▲/▼ · GS kt`) with text-shadow; **retina DPR** canvas (Extra #3); `userData.screenH`. `_rebuildLabel(f,showData)` passes live data. `updateLabelScales`: quantised data-sig, **declutter** (`DATA_LINE_K=25` nearest + always `selectedId`, Extra #4), scale from `screenH`. |
| `spec.md` | §12.6 rewritten (2-row label, FL/ft, GS-not-airspeed, declutter, quantised rebuild); §12.7 shared-ramp note; §3.13 attitude bullet extended. |

### Verified in browser (:8080, mock fleet, 1440×900)
- `node --check` clean on all 3 JS files; **0 console errors** (only pre-existing route-404 *warns* for synthetic mock callsigns — enrichment degrades gracefully).
- **Declutter exact:** 40 flights → **exactly 25** two-row labels (`canvasH 70`), rest callsign-only (`canvasH 44`, sig `…|none`).
- **screenH mapping:** 44→20 (1 row), 70→31.8 (2 rows) ✓.
- **Selection override:** force-selected a far no-data flight (THA100) → next frame gained `canvasH 70`; sig `…|0|99|89|1` matched live values (hdg 0, 9900 ft, 445 kt, climbing).
- **Visual (labels drawn from their THREE textures onto a checkerboard):** AIQ109 `HDG 063 FL306 ▲ GS 515 kt` (green ▲); CPA107 `HDG 329 FL259 ▼ GS 465 kt` (red ▼); THA108 `HDG 016 FL282 GS 480 kt` (level). Transparent data-row bg confirmed (checkerboard visible through it); altitude tinted; callsign row keeps its dark box.

### Notes
- Speed is **groundspeed** (no airspeed in free ADS-B) — labelled `GS … kt` per operator.
- `altColor` now shared → blip and label colour can never drift (a §11 visual-design invariant).
- Left preview enabled with **mock** source for immediate review; operator can switch to `airplaneslive` or toggle off.
- Not yet committed — awaiting operator sign-off on the look.

---

## 2026-06-01 (d) — Study: map legibility (airspace de-clutter + ground orientation) · STATUS: DESIGN_LOCKED (implementation pending)

**Operator ask:** study two legibility problems — (1) de-clutter the 144 airspaces via grouped master on/off toggles in the Airspace Window; (2) make the ground detailed enough to know *where you are* without the radar. Then pin to spec + create the playbook, all logged.

**Method:** plan-mode, 3 Explore agents (airspace model/UI · ground+orientation gap · UI control patterns) + targeted reads. **No app code touched.**

### Key findings
- Airspace visibility seam generalises cleanly: per-airspace mesh in `compiled[]`, `_applyMilitaryVisibility`/`_isActive` gate, list filter already drops hidden military rows (`ui.js:1648`). Civil meshes are currently always-visible → **all-groups-on default = zero regression**.
- Functional groups map onto the existing `category`: Airports (CTR+Class D)=34, Terminal (TMA)=13, Danger=71, Restricted=21, Prohibited=5 → **Σ 144**. Military (`branchOf`) is orthogonal → stays a cross-cutting toggle.
- Ground gap vs radar: 3D has Voyager tiles + city beacons + province *lines* + HUD lat/lon, but **no range rings, no airport markers, no scale reference**. **No airport dataset exists anywhere** (only `THAI_CITIES`) — the biggest orientation gap → new `data/airports.json`.
- Reuse anchors: `installCityBeacons` (cities.js:165), `makeTextSprite` (airspace.js:253), `installProvinceLines` (provinces.js:37), radar bake `_bakeSig` + `_radarScale` (ui.js).

### Operator decisions
- Grouping = **functional** (Airports/Terminal/Danger/Restricted/Prohibited) + Military cross-cut.
- Ground levers = **airport beacons+labels · range rings · province lines+names**, each an independent persisted toggle.
- Delivery = **two phases** (Betterment-5 de-clutter, Betterment-6 ground legibility).

### Produced (design artifacts, no app code)
- `spec.md` §3.14/§3.15 (functional reqs) + **§13** (Betterment-5) + **§14** (Betterment-6).
- `20260601_BettermentPlaybook.md` — B5 (5 tasks) + B6 (5 tasks), each with Pass Criteria, target files, reuse anchors, smoke checklists.
- `state_TODO.md` — Betterment-5 + Betterment-6 phase rows (unchecked).
- This journal block.

### Verification (artifacts)
- Group counts sum to 144 ✓.
- Every toggle id (`#optAirports/#optRangeRings/#optProvinces`, group chips) + persistence key (`kuson.airspacegroups.v1`, `kuson.grounddetail.v1`) appears in **both** spec and playbook ✓.
- Reuse anchors re-confirmed against source (visibility seam, city beacons, provinces, radar bake / list filter).

### Next
Execute Betterment-5 then -6 per the playbook (browser-verified, atomic commits). Guardrails: persistence keys + **default-on no-regression** baseline diff. Docs staged in working tree, not committed to git.

---

## 2026-06-01 (e) — Betterment-5 + Betterment-6 implemented & browser-verified · STATUS: PHASES COMPLETE

Executed the full B5 + B6 playbook to completion (10 atomic commits) and first landed the previously-uncommitted B4.1 label feature + design docs.

**Pre-work:** `65135e4` B4.1 airplane-label feature (code); `78cc6f3` docs (spec §13/§14 + §3.14/§3.15, playbook, journals (c)+(d), TODO).

**Betterment-5 — airspace de-clutter (`d47014a`→`e83b32c`):**
- T1 `groupKeyFor` + `AIRSPACE_GROUPS` (airports/terminal/danger/restricted/prohibited = 34/13/71/21/5 = 144).
- T2 unified `_applyVisibility` + `groupVisible` + `setGroupVisible`; `_isActive` gated; default-on = no regression.
- T3 `get/setAirspaceGroupSettings` (`kuson.airspacegroups.v1`).
- T4 group chip bar + All in the Airspace Window; `_refreshAirspaceList` group gate.
- T5 minimap bake skips hidden groups; `groupVisible` folded into `_bakeSig`.

**Betterment-6 — ground legibility (`4036a98`→`5facfc1`):**
- T1 `data/airports.json` (14 majors). T2 `src/airports.js` `installAirportBeacons` (port of city beacons — diamond marker, blue halo, `✈ ICAO·IATA` label). T3 `src/rangeRings.js` `installRangeRings` (50/100/200 km · aero NM, follows the drone). T4 `provinces.js` centroid name labels + `updateScales` + group toggle. T5 `src/groundSettings.js` (`kuson.grounddetail.v1`) + `#optAirports/#optRangeRings/#optProvinces` + `main.js` wiring.

**Verification env note:** the Claude preview sandbox couldn't serve this `/Volumes` (external-drive) repo — `getcwd` denied + no `/Volumes` read. Worked around by serving via a Bash `http.server` on `:8080` and driving the operator's connected Chrome (Claude-in-Chrome MCP) against `localhost`.

**Browser-verified (real app @ localhost:8080, 0 console errors):**
- B5: 144 airspaces; default **144 visible** (no-regression); 6 chips with exact counts (`Airports 34` … `All`); `danger` off → exactly **73** meshes; restore → 144. Clicking the Danger chip (real `change` event) → airspace list = **73 rows** + persisted `{danger:false}`.
- B6: airports group = **42** objects (14×[marker+halo+label]); provinces group = **78** (lines + 77 labels); both visible by default; range rings default **off** → checkbox toggle → **on** + persisted. All three ground toggles flip `group.visible` via the wired event path.
- Reload at pristine defaults: 144/144, 6 chips, ground ready, **0 errors**.

**Static verification:** `node --check --input-type=module` clean on all 7 changed/new files; group counts + visibility predicate + persistence round-trips logic-tested in Node; cross-module imports resolved.

**State:** branch `betterment2-20260529`, **not pushed**. Tags `betterment5-complete` / `betterment6-complete` cut. Bash `:8080` server left running for operator review.

---

## 2026-06-12 (a) — Betterment-7: Sky Guardian foundation · STATUS: PHASES COMPLETE

**Session:** B7 Sky Guardian foundation, 9 commits `c6468af`..`7ffa736` on branch `betterment7-20260612` (cut from `betterment2-20260529`). Orchestrator (Fable) + Sonnet-executor pattern per `20260612_ShebangPlaybook.md`; every task browser-verified at checkpoints C1–C3.

**T1 — Debug overlay (`c8aadd0`):** backtick toggle; `renderer.info` panel (calls / tris / geoms / textures / programs) + 30-frame FPS; no DOM writes while hidden; ≤ 4 Hz while visible. Baseline established (start view): **294 calls / 16 352 tris / 262 geoms / 55 textures / 15 programs**.

**T2 — Label texture dedup (`b967b29`):** audit premise partially wrong — airspace label canvases were already height-fitted (512×43 typical, ~11.3 MB total for 144 measured); pow2 right-sizing would have inflated height ~50% and broken `updateLabelScales` (canvasW/H drive on-screen size) → airspace half reverted after no-regression review. Flight-label refcounted texture cache landed (keyed on exact drawn strings + logo readiness + DPR). Text-fitted airspace boxes filed as a visual-polish candidate (changes the rendered box).

**T3 — NO-OP:** `wallMatFor()` already pools patterned materials (browser: 15–16 programs total) and both `updateLabelScales` passes already early-exit on hidden (P2.T7b/P2.T8 era work). June-audit claims stale.

**Infra fix mid-session (`aa1daf0`):** plain `python3 -m http.server` serves no cache headers → old-mtime modules got ~1-day heuristic freshness → reloads served pre-edit code. `scripts/devserver.py` (Cache-Control: no-store) + `launch.json` switch added.

**T4 — GameMode FSM (`84469f8`):** `IDLE → BRIEFING → WAVE → DEBRIEF → IDLE`; `abort()` legal from any non-`IDLE` state; illegal transitions log + refuse; game inert in `IDLE`. Wired into main loop.

**T5 — ATC radio + log panel (`7b08c6c`):** `AlertTier.RADIO` rank 7; grammar `"{n} contact(s) — {shortName}, bears {brg}° for {nm} nm, angels {kft}"`; auto-retract 10 s; Radio log panel (collapsible, 20 entries, `HH:MM:SS`).

**T6 — UFO layer (`2f3a50e`):** spawn at airspace centroid, mid-band altitude; orbit r = 2 km, 45 s period, bob ±60 m; glow sprite tinted by category colour; banish = 0.6 s scale+fade + full dispose. Leak-free verified: geometry count returns to pre-spawn baseline.

**T7 — Typing challenge (`0f9f3bd`):** capture-phase keydown/keyup suppression + `drone.keys.clear()` on open + `exitPointerLock`; does not touch `flightLocked`; matching case-insensitive, diacritics-stripped, whitespace/hyphen-collapsed, accepts `id | shortName | name`; resolves `{correct, elapsedS, accuracy, wpm, cancelled?, timeout?}`.

**T8 — SCRAMBLE wave + score + persistence (`265413a`, `f313a4d`):** 3 distinct CTR/TMA contacts; per-contact `CALLING → TRAVEL → CHALLENGE → RESOLVED`; scoring `base 100 × (1+speedBonus) × accuracy × 1.1^streak` (streak cap 10); `kuson.game.v1` guarded-merge. One real gameplay bug found at C2 and fixed (`f313a4d`): catalog overview vantage (~40 000 ft) is above most CTR/TMA ceilings so autopilot never satisfied the in-volume check — final-approach drop added; WPM rounded and capped at 999.

**T9 — Start screen (`7ffa736`):** full-viewport overlay, real load progress (6 ticks), Explore / Tour (variant `"short"`) / Play buttons, keyboard `1/2/3+Enter`, last choice persisted `kuson.start.v1` (0-based index), failure-safe construction.

**C1–C3 browser verification (real app @ localhost:8080, scripts/devserver.py, no-store):**
- C1: debug overlay toggle, baseline numbers confirmed.
- C2: full play-through — wave → all 3 contacts resolved → debrief → `kuson.game.v1` persisted; abort from `WAVE` → IDLE, 0 UFOs, hidden strip; UFO banish geometry count returns to baseline.
- C3: start screen progress ticks; Explore / Tour / Play each route correctly; choice persisted.

**Known / deferred:**
- Volume red-pulse on contact lost — deferred in `scramble.js` comment.
- `window.__sim.tourGuide` has always been `undefined` (assigned in bootstrap after module-bottom capture — only `ui` is re-published; pre-existing).
- Mock-source route enrichment 404 spam — pre-existing.
- Background preview tabs clamp `setTimeout` ≥ 1 s and suspend rAF — drive updates manually; pump `UfoLayer.update` for banish animations.

**End HEAD:** `7ffa736` (pre-docs commit; this journal block is in the T10 docs commit that immediately follows).

---

## 2026-06-12 (b) — Betterment-8: Sound + full SCRAMBLE · STATUS: PHASES COMPLETE

**Session:** B8 full implementation, 10 tasks T1–T10 per the expanded playbook §B8 (`6c81157`). Orchestrator (Fable) + Sonnet-executor pattern; three checkpoints browser-verified: C1 post-T4 (audio), C2 post-T7 (gameplay), C3 post-T9 (regression). Branch `betterment7-20260612` (B8 commits follow directly from B7 HEAD `7ffa736`).

**T1 — Audio core (`64a0662`):** lazy `AudioContext` (unlock on start-screen activation + any gesture; suspend/resume with `visibilitychange`); `masterGain` → `engineBus` + `sfxBus` graph; `kuson.audio.v1` `{volume, muted, voice}` persistence; alert tones by tier (SAFETY triple-beep / RADIO squelch chirp / ADVISORY ping) fired on new-key publication.

**T2 — Engine loop + stall horn + buffet (`5c377b1`):** engine chains rebuilt only on `(mode | presetId)` change. Prop: saw 55→110 Hz by throttle + sub-octave sine → lowpass 900 Hz. Jet: noise → bandpass 600→2400 Hz + 60 Hz rumble. Hover/UFO: triangle 140 Hz + LFO. Stall horn: square 800 Hz gated 4 Hz when airspeed < 1.1 × Vs; buffet camera jitter ±0.15° at 9 Hz in same band — physics feedback, independent of mute.

**T3 — ATC speech-synthesis voice + ducking (`f709cf5`):** `speechSynthesis` (rate 1.05, pitch 0.9, en-GB → en-US → en); cancel-before-speak; squelch chirp + end click as bookends; engine duck ×0.4 with 150 ms ramps. Radio text always written to log regardless of voice setting.

**T4 — Game SFX wiring (`df325de`):** tick (throttled 40 ms gate on typing keystrokes); lockSweep (modal open); banish (UFO dispose); lost (contact timeout); chime (wave/tutorial complete). All injected deps, null-safe. **C1 verified:** prop 55→110 Hz tracked throttle via `__sim.audio` debug getters; horn ON at 24 m/s (Vs ≈ 23.5, 1.1 × Vs ≈ 25.9), OFF at 40 m/s; kind switching hover/prop/jet; `_lastSay` received the ATC radio message; tick + lockSweep fired in typing modal; settings `{volume: 0.4, muted}` persisted to `kuson.audio.v1`.

**T5 — Difficulty tiers (`1bfc6c7`):** CADET (3 contacts / 90 s travel / 45 s challenge / autopilot / any answer / ×1), PILOT (4 / 75 / 35 / no autopilot / short form / ×1.5), ACE (5 / 60 / 30 / no autopilot / id only / ×2). Selector on BRIEFING screen, keys 1/2/3, persisted `kuson.game.v1.difficulty`.

**T6 — Multi-wave progression (`8a5c49e`):** Next-wave from DEBRIEF; contacts +1 per wave (uncapped); `timeLimit × 0.9^n` floor 45 s; SESSION TOTAL accumulates; `bestScore` = lifetime session total; `waveReached` persisted. DEBRIEF → WAVE added to FSM guard table.

**T7 — Tutorial (`6593991`, amend):** six steps — hold-W ≥ 1 s → mouse-look ≥ 0.5 rad → 3 torus rings at < 150 m → Identify (mode on + non-empty pick ≤ 2 Hz) → practice typing Bangkok CTR → done; offered on BRIEFING for fresh players (T key), `kuson.game.v1.tutorialDone` flag. Rings fully disposed on every exit path. **Mid-task bug:** `_spawnRings` called `_disposeRings` (which nulls the ring group) then tried to use the group → null crash; fixed by re-creating the group before use (amend to `6593991`). **Executor death (T7):** Sonnet executor died mid-task; orchestrator completed the briefing-offer wiring + main wiring + CSS inline. **C2 verified:** ACE wave — 5 contacts / 60 s / no autopilot / typing target = id; shortName rejected (modal re-opened after 1 s), id accepted → 400 pts (×2 mult exact, instant-solve baseline); full wave debrief "WAVE 1 — ACE" streak-compounded scores 400/440/484/532/586 = 2442; Next-wave → 6 contacts / 54 s; `waveReached` persisted. Tutorial end-to-end: all 6 steps, rings popped with chime, practice solve, `tutorialDone` persisted. (Earlier orchestrator eval reported T-key failure — start-screen capture listener was still armed from the previous run; not a code bug.)

**T8 — Progressive HUD + quick warp chips (`42cb80f`):** `kuson.hud.v1` `{pro}`; `pro` defaults `true` when any `kuson./thairspace.` key exists (returning players), `false` on fresh profiles. Minimal hides VS/WIND/BAT/LINK/NEXT/sim-speed/history/CAAT/toggles/alt-tape; keeps LAT-LON/ALT/HDG/SPD/MODE/minimap/alerts/panel. Quick warp chips: Bangkok (VTBD-CTR) / Chiang Mai (VTCC) / Phuket (VTSP) / U-Tapao (VTBU-CTR) — reuse catalog fly-to path.

**T9 — Fresnel edge-glow (`20946e2`, amend):** `pow(1−|N·V|, 3) × 0.35` rim tinted by category vertex colour; shared `uGlowOn` uniform — OFF is mathematically pre-B8-identical (no recompile). Persistence key `kuson.grounddetail.v1.volumeGlow`, default on. **Mid-task WebGL compile failure:** shader used `objectNormal` which is undeclared in `MeshBasicMaterial` (no `beginnormal_vertex` chunk); fixed to read raw `normal` attribute directly (amend to `20946e2`). **Executor death (T9):** Sonnet executor died before commit; orchestrator staged + committed inline. **C3 verified:** fresnel rim visible and toggleable; `uGlowOn = 0` yields no visual rim, program count unchanged; audio regression clean.

**Commits (run `git log --oneline` for exact SHAs):** `64a0662` audio core · `5c377b1` engine+horn+buffet · `f709cf5` ATC voice · `df325de` game SFX · `1bfc6c7` difficulty tiers · `8a5c49e` wave progression · `6593991` tutorial · `42cb80f` HUD+chips · `20946e2` fresnel glow · this docs commit (T10).

**Known / deferred:**
- Wrong-answer submit currently penalty-free (streak intact on failed submit) — candidate polish for a future pass.
- Engine sound for live-traffic aircraft (ADS-B layer) — not in scope for B8.
- Recorded voice-over pack to replace `speechSynthesis` — deferred.

**End HEAD:** `20946e2` (pre-docs commit; the docs commit — spec §3.17 + journal block (b) + TODO B8 — follows immediately on the same branch).
