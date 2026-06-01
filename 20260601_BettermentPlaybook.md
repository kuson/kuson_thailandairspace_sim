# Betterment-5 & 6 Playbook — Map legibility (de-clutter + ground orientation)

**Companion to:** `spec.md` §13 (Betterment-5) + §14 (Betterment-6), `journal.md` 2026-06-01 (d).
**Audience:** Sonnet/Opus sessions implementing this work.
**Status:** design locked, **implementation pending**.

This playbook is **stop-and-resume safe**: every task ends at an atomic commit; any fresh session resumes from `journal.md` (last block) + `state_TODO.md` (first unchecked) + this file's matching phase.

---

## 0. Operator protocol (read every session start)

Follow the canonical protocol in `CLAUDE.md §1` and `20260528_BettermentPlaybook.md §0` (session open/close, context budget, atomic conventional commits). The **global regression checklist** (`20260528_BettermentPlaybook.md §0.5.2`) still applies at every phase exit.

**Serve & verify:** `python3 -m http.server 8080` from repo root → `http://localhost:8080`. Per touched file: `node --check src/<file>.js`. Per phase: browser console clean + the phase smoke below.

**Hard rule for both phases — no-regression default:** with all new toggles at their defaults (all airspace groups on; airports on, provinces on, range-rings off), the scene must render **identically to pre-Betterment-5** (144 volumes, military per the existing toggle). Capture a baseline screenshot before touching code; diff after.

---

## Phase Betterment-5 — Airspace de-clutter (functional group toggles)

**Goal (Pass Criterion for the phase):** From the Airspace Window the operator can hide/show airspaces by functional group (Airports / Terminal / Danger / Restricted / Prohibited) and "All", with the existing Military toggle composing on top; hidden groups disappear from the **3D scene, the list, and the radar** together; selections persist across reload; default-on is a pixel-identical no-op.

**Spec contract:** `spec.md §13` + §3.14. **Persistence key:** `kuson.airspacegroups.v1`.

### B5.T1 — Grouping helper + metadata (`src/airspace.js`)
- Add + export `groupKeyFor(a)` mapping `category` → `airports` (CTR, Class D) / `terminal` (TMA) / `danger` / `restricted` / `prohibited`. Reuse `categoryKeyFor(a)` (line 191) so the Class-D special case stays consistent.
- Add + export `AIRSPACE_GROUPS = [{key,label,categories}, …]` (5 entries) for the UI.
- **Pass:** in a Node REPL, mapping every record in `data/airspaces.json` through `groupKeyFor` yields counts `airports 34, terminal 13, danger 71, restricted 21, prohibited 5` (Σ = 144), no `undefined`.
- **Commit:** `feat(airspace): functional group keys + AIRSPACE_GROUPS metadata`

### B5.T2 — Generalised visibility (`src/airspace.js` `AirspaceLayer`)
- Add `this.groupVisible = {airports:true, terminal:true, danger:true, restricted:true, prohibited:true}` in the constructor.
- Add `setGroupVisible(key, show)` → set flag → `_applyVisibility()`.
- Replace `_applyMilitaryVisibility()` (478) with `_applyVisibility()`:
  `const show = this.groupVisible[groupKeyFor(c.airspace)] && (!c.military || this.showMilitary); c.mesh.visible = show; c.label.visible = show && this.labelsGroup.visible;` — iterate **all** compiled, not just military.
- Point `setMilitaryVisible` (478) at `_applyVisibility`. Extend `_isActive(c)` (491) to also require `this.groupVisible[groupKeyFor(c.airspace)]`.
- **Pass:** with defaults, `compiled.every(c => c.mesh.visible === (!c.military || showMilitary))` (today's behaviour). Calling `setGroupVisible('danger', false)` hides exactly the 71 danger meshes + labels; identify ray over a hidden danger zone returns nothing.
- **Commit:** `feat(airspace): per-group visibility via unified _applyVisibility`

### B5.T3 — Persistence helpers
- Mirror `get/setLiveFlightsSettings` (`src/flightSources.js`): add `get/setAirspaceGroupSettings` (own module or alongside) keyed `kuson.airspacegroups.v1`, `DEFAULT = {airports:true,…}`, `{...DEFAULT, ...JSON.parse(raw)}` guard.
- **Pass:** set → reload → get returns the patched object; corrupt JSON falls back to defaults (no throw).
- **Commit:** `feat(airspace): persist group filter settings`

### B5.T4 — Airspace Window UI (`index.html`, `src/ui.js`)
- In `index.html`, above `#airspaceFilter` (after `<h3>Airspaces…</h3>`, line 806), add a `#airspaceGroups` chip bar container + an **All** control. Style with `.opt` tokens (new `.asgroup-chip` class if needed, matching panel CSS).
- Add `UI._buildAirspaceGroups()`: render one chip per `AIRSPACE_GROUPS` entry (label + live count from `layer`), restore persisted state into `layer.groupVisible` + chip `checked`, wire `change` → `setAirspaceGroupSettings(...)` → `layer.setGroupVisible()` → re-bake minimap (`this._minimapBake = null` or invalidate `_bakeSig`) → `_refreshAirspaceList()`. **All** toggles every chip + fires their handlers (reuse the live-flights select-all pattern).
- Extend `_refreshAirspaceList()` filter (1647): add `if (!this.layer.groupVisible[groupKeyFor(a)]) return false;` before the search test. Import `groupKeyFor`.
- Call `_buildAirspaceGroups()` from the same place `_buildDisplayOptions()` is invoked.
- **Pass (browser):** all 5 chips show correct counts; unticking **Airports** removes CTR/Class-D volumes from the 3D scene, drops them from the list, and clears them from the radar; **All** off → empty sky + "No airspaces match filter."; reload preserves state.
- **Commit:** `feat(ui): airspace group toggles in the Airspace Window`

### B5.T5 — Radar parity (`src/ui.js` minimap bake)
- In `_ensureMinimapBake`/`_bakeSig`, skip airspaces whose group is hidden, and include a hash of `layer.groupVisible` in `_bakeSig` so toggling re-bakes.
- **Pass:** toggling any group updates the minimap polygons on the next frame; no per-frame re-bake when nothing changed (verify `_bakeSig` stable across idle frames).
- **Commit:** `perf(radar): bake only visible airspace groups`

**Phase B5 smoke checklist (all must tick):**
- [ ] 5 group chips + All render with correct counts (34/13/71/21/5).
- [ ] Each group toggle hides/shows its volumes in 3D, list, and radar in sync.
- [ ] Military toggle still composes (military Danger zone hidden when either Danger **or** Military is off).
- [ ] State persists across reload; default-on diff vs baseline = none.
- [ ] `node --check` clean; no console errors.

---

## Phase Betterment-6 — Ground legibility (orientation layers)

**Goal (Pass Criterion):** A pilot can tell where they are over Thailand from the 3D view alone — airport beacons name the major fields, range rings give distance/scale, province names label the regions — each independently toggleable from Display options and persisted.

**Spec contract:** `spec.md §14` + §3.15. **Persistence key:** `kuson.grounddetail.v1` (`{airports, rangeRings, provinces}`; defaults airports/provinces on, rangeRings off).

### B6.T1 — Airport dataset (`data/airports.json`)
- Curate ~12–15 major Thai airfields: `{icao, iata, name, lat, lon, prominence}`. Seed set: VTBS/BKK Suvarnabhumi, VTBD/DMK Don Mueang, VTCC/CNX Chiang Mai, VTCT/CEI Chiang Rai, VTSP/HKT Phuket, VTSS/HDY Hat Yai, VTSB/URT Surat Thani, VTSG/KBV Krabi, VTUU/UBP Ubon, VTUD/UTH Udon Thani, VTUK/KKC Khon Kaen, VTSF/NST Nakhon Si Thammarat, VTSM/USM Samui, VTBU/UTP U-Tapao. Prominence by traffic (BKK/DMK = 3).
- **Pass:** valid JSON; every lat/lon inside the Thailand bbox; ≥ 12 entries.
- **Commit:** `feat(data): curated major Thai airports dataset`

### B6.T2 — Airport beacons module (`src/airports.js`)
- Port `installCityBeacons` (`src/cities.js:165`) → `installAirportBeacons(scene, {y, topN})` returning `{group, updateScales(camera, renderer)}`. Label text `ICAO·IATA` (e.g. `VTBS·BKK`) over name; a distinct marker glyph (runway tick / ▲) so airports ≠ cities; distance-fade by prominence.
- **Pass:** beacons appear at correct positions (BKK over Bangkok); labels stay ~constant px across altitudes; far airports fade.
- **Commit:** `feat(airports): airport beacons + labels (city-beacon pattern)`

### B6.T3 — Range rings module (`installRangeRings`)
- `installRangeRings(scene)` → `{group, update(dronePos, units)}`: `LineLoop`s at 50/100/200 km (aero: 25/50/100 NM), `y≈1`, faint material, re-centred on the drone each frame; distance labels via `makeTextSprite` (`airspace.js:253`). Reuse the radar's metric/aero unit flag.
- **Pass:** rings centre on the aircraft and follow it; labels read 50/100/200 km (or NM after `U`); sit above tiles, below city/airport labels (no z-fight).
- **Commit:** `feat(ground): range rings overlay on the basemap`

### B6.T4 — Province names + toggle (`src/provinces.js`)
- Keep `installProvinceLines`; add name labels at per-feature centroids (reuse city-beacon label + fade; low prominence). Confirm the province-name property key in `data/provinces.geojson` first. Make the whole overlay gated by `group.visible`.
- **Pass:** province names appear at centroids, low-key under airport/city labels; toggling hides lines + names together.
- **Commit:** `feat(provinces): province-name labels + visibility toggle`

### B6.T5 — Display-options toggles + wiring + persistence (`index.html`, `src/ui.js`, `src/main.js`)
- Add three `.opt` checkboxes `#optAirports`, `#optRangeRings`, `#optProvinces` to Display options. Add `get/setGroundDetailSettings` (`kuson.grounddetail.v1`, defaults above), restore on load.
- In `main.js`: instantiate the three layers in scene init; call their `updateScales`/`update` in the per-frame loop next to `cities` updates; wire each checkbox → `group.visible` (+ persist). Expose on `window.__sim` for verification.
- **Pass (browser):** each checkbox shows/hides its layer; state persists across reload; defaults match spec (airports/provinces on, rings off).
- **Commit:** `feat(ui): ground-detail layer toggles + persistence`

**Phase B6 smoke checklist:**
- [ ] Airport beacons name BKK/DMK/CNX/HKT at correct positions; labels crisp + scaled.
- [ ] Range rings follow the aircraft; correct km/NM labels under `U`.
- [ ] Province names render at centroids; toggle hides lines + names.
- [ ] All three toggles persist; defaults correct.
- [ ] From a cruise altitude over an unlabelled area, the operator can name their location from the 3D view alone (the phase goal).
- [ ] `node --check` clean; no console errors; framerate unaffected (layers are static geometry + per-frame label rescale only).

---

## Cross-phase verification (run before tagging each phase complete)
- Global regression checklist (`20260528_BettermentPlaybook.md §0.5.2`).
- `node --check` on every touched JS file.
- Browser console clean across a 2-minute session with toggles exercised.
- Journal block appended; matching `state_TODO.md` rows ticked only after browser Pass.
