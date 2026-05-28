# Betterment Report — Thailand Airspace Simulator

**Date:** 2026-05-28
**Reviewer:** triangulated synthesis of three independent technical passes
**Scope:** full read of `src/*.js`, `index.html`, `data/*.json`, `spec.md`, `README.md`
**Goal:** identify highest-leverage improvements across (1) educational drone simulator quality, (2) performance, (3) visual quality including ground-map clarity.

> Methodology: three independent agents performed a forensic code review with no knowledge of each other's findings (`.scratch/betterment_20260528/pass1.md`, `pass2.md`, `pass3.md`). This report consolidates them, weights items by **how many passes independently surfaced them**, and ranks by leverage × effort. Items marked **[3/3]** were independently identified by all three reviewers (strongest signal), **[2/3]** by two, **[1/3]** by one.

---

## Executive verdict

**Three reviewers reached the same headline diagnosis, in different words:**
this is a **strong educational airspace visualizer wearing flight-simulator clothing**. The AIP-derived 144-volume Thai airspace dataset, the heading/altitude/horizon canvas instruments, the auto-zooming altitude tape with Thai operating bands + 90 m drone line, and the tour-guide narrative are the codebase's best work. The actual flight model in [src/drone.js:1092-1175](src/drone.js:1092) is ~80 lines of kinematic forward-Euler with **no mass, no thrust, no drag, no inertia, no stall, no battery, no signal-loss, no geofence enforcement, no wind, no AGL awareness**. The "drone" preset is a 6-DoF strafing free-cam in which the Mavic 3 body never actually rolls or pitches (forced to 0 at [src/drone.js:1049](src/drone.js:1049)) — so the artificial horizon is *decorative* in the exact preset that the app is named after.

Performance is fine on desktop with the current 144-volume scene but has no headroom: the identify ray performs ~72 000 point-in-ring tests per frame ([src/identify.js:8-21](src/identify.js:8)), the minimap re-paths every airspace polygon every frame ([src/ui.js:1326-1351](src/ui.js:1326)), and hot loops allocate fresh `THREE.Vector3` instances per call ([src/drone.js:1019,1029,1097](src/drone.js:1019)).

Visual quality has two consistently-cited gaps: a flat-blue background ([src/main.js:14-16](src/main.js:14)) with no sky dome or sun makes mid-altitude flight feel like "floating in pastel soup", and the bare-OSM ground tiles at zoom 9-13 cannot answer the question "where in Thailand am I?" at cruise altitude — Chiang Mai is literally unreadable.

The good news: the codebase is clean, the per-subsystem `_safe()` wrapper at [src/main.js:326](src/main.js:326), the deterministic flight history, the dedicated `coords.js`, and the disciplined separation of `ground/airspace/flyto/tour/ui/drone` show a developer who knows what they're doing. The shortcomings are scope choices, not sloppiness. **The bones are there to grow this into something serious.**

---

## Top consensus findings (highest signal — all three passes independently agreed)

These items appeared in every pass. They are the single most reliable signal for "this is what matters most."

### Simulator quality
1. **[3/3] Replace the kinematic strafe with a real second-order flight model with mass, drag, thrust, and attitude dynamics.** [src/drone.js:1092-1175](src/drone.js:1092). Stick → desired tilt → actual tilt (lerp, τ ≈ 80 ms) → horizontal accel = g·tan(tilt). Vertical: throttle integrates against drag. Magnitude: foundational change; everything else (wind, gust, ground effect, prop spin animation, attitude indicator becoming meaningful) hangs off this.
2. **[3/3] Add battery / signal-loss / RTH / geofence as Thai-CAAT-authentic failure modes.** The CAAT exam syllabus *requires* lost-link and low-battery procedures. The codebase has no battery field, no signal model, no geofence enforcement — only a chip that turns red ([src/ui.js:1188-1199](src/ui.js:1188)). Every rule in the educational HTML is currently passive text. Make at least three of them *felt*: ceiling clamp on entry to Class D, freeze on Prohibited boundary, auto-RTH at 25 % battery.
3. **[3/3] The 90 m AGL line on the altitude tape ([src/ui.js:786](src/ui.js:786)) is computed against AMSL.** On a 300 m hill the line is wrong by 300 m. Thailand goes from sea level to 2 565 m at Doi Inthanon. Either add a terrain elevation lookup (free Terrarium tiles, or bake a per-airspace `ground_elevation_m`) or rename it honestly. As-is, the most prominent CAAT educational element is misleading.
4. **[3/3] Fixed-wing model has no stall, no energy-trade in turns, no pitch→airspeed coupling.** [src/drone.js:1126-1175](src/drone.js:1126) clamps airspeed to `minKmh` instead of triggering stall, so the Cessna's `minKmh = 130` is a hard speed-floor with no educational moment. Add: nose-drop + altitude loss below `1.05·Vs`; airspeed bled by load factor in turns; bleed by `g·sin(pitch)·dt` on climb. ~30 lines, makes every fixed-wing preset teach about energy.
5. **[3/3] No real input pipeline.** No deadzone, no expo, no rate-vs-angle modes, no gamepad, no Mode-1/Mode-2 stick mapping. `MOUSE_SENSITIVITY` is a module constant at [src/drone.js:7](src/drone.js:7) with no UI to tune it. A Gamepad poller is ~80 lines and a "I'd let a student log hours on this" upgrade.

### Performance
6. **[3/3] `pickAirspacesAlongRay` is the worst hot path.** [src/identify.js:8-21](src/identify.js:8) walks 500 samples (800 m step × 400 km) per frame, each calling `airspacesAt` which loops all 144 airspaces and does point-in-ring — worst case ~72 000 ring tests / frame at 60 Hz. Two fixes: (a) **precompute per-airspace AABB** (XZ + Y) at load and reject by box before `pointInRing`; (b) **throttle to ~10 Hz** instead of 60 Hz (the panel cache already buckets to 50 m). Bonus: an analytical ray-vs-cylinder / ray-vs-prism removes the 800 m step's miss-the-thin-volume artefact.
7. **[3/3] Minimap fully repaths all 144 polygons every frame.** [src/ui.js:1326-1351](src/ui.js:1326). The polygons never move — bake them to an offscreen world-canvas once, blit with a transform per frame. The string concat `"#" + c.color.toString(16).padStart(6,"0")` runs 8 640 times/sec. Precompute the CSS string per compiled airspace at load. Drops minimap CPU from ~1.5 ms to ~0.1 ms.
8. **[3/3] Per-frame `Vector3` allocations in hot paths.** [src/drone.js:1019,1029](src/drone.js:1019) (`forward()`, `right()`) and [src/drone.js:1097](src/drone.js:1097) (`move` in `_updateFree`) each allocate fresh `THREE.Vector3` instances. Hoist to `this._fwdVec`, mutate in place. Removes a recurring GC sawtooth that shows up as 50–100 ms hitches on Safari mobile.

### Visual quality
9. **[3/3] Flat-colour background + no sky dome.** [src/main.js:14-16](src/main.js:14) is `Color(0x89b4dc)` + fog. No sun disc, no horizon gradient, no atmospheric scattering. The single highest-leverage visual change in the codebase. Use Three.js `examples/jsm/objects/Sky.js`, place a 4 km sun-disc billboard at the directional-light vector, sample the sky at `y=0` for fog tint. With sky + sun, banking turns *read* as banks in third-person. Free educational hook: time-of-day slider (CAAT requires daylight VLOS — [src/ui.js:25](src/ui.js:25)).
10. **[3/3] Bare-OSM ground tiles cannot answer "where in Thailand am I?" at cruise altitude.** [src/ground.js:8-11](src/ground.js:8). OSM standard is styled for Western road maps and at z9 strips the place names. Switch to **Carto Positron** or **Stamen Terrain** for both 3-D ground and minimap. Bake **city-beacon sprites** at runtime for the ~30 Thai cities relevant to airspaces (Bangkok, Chiang Mai, Khon Kaen, Korat, Phuket, Hat Yai, U-Tapao, Hua Hin, Pattaya…). Add a province-boundary `LineSegments` overlay from one geojson fetch. Directly attacks the brief's "clarity of ground map".
11. **[3/3] Aircraft model props never spin, control surfaces never deflect, no nav lights blink.** The Mavic 3 props are static crossed `BoxGeometry` at [src/drone.js:118-132](src/drone.js:118). No prop spin, no aileron deflection on roll input, no rudder, no red/green wingtip lights. This is the change a viewer notices in the first 2 seconds. Add `props.rotation.y += dt * 40` in `Drone.update`, `surface.rotation.x = inputCmd * 0.4` for control surfaces, and `MeshBasicMaterial` blinkers gated by `Math.sin(t*5) > 0`.

---

## Dimension 1 — Educational Drone Flight Simulator

### Consensus diagnosis

| What the project advertises | What the code actually does |
|---|---|
| Educational drone flight simulator | Free-cam with WASD bound to a unit vector |
| Mavic 3 with realistic feel | Body never rolls; instant start/stop; no inertia |
| Cessna stalls below 130 km/h | Airspeed clamps to 130 km/h; no stall behaviour |
| Bank-induced turn (textbook ω = g·tan(φ)/v at [drone.js:1165](src/drone.js:1165)) | Correct yaw rate, but altitude is preserved in turns (no `1/cos(φ)` lift demand) — teaches *wrong* intuition |
| CAAT 90 m AGL ceiling | Drawn as AMSL line; not enforced; no AGL lookup |
| CAAT registration / VLOS / 9 km airport stand-off | Listed in HTML; never gated, never simulated |
| HUD with airspeed | No VSI; no AGL; no slip/skid; no g-load; no wind |

### Ranked improvements (with cross-pass votes)

| # | Change | File:line | Votes | Effort | Leverage |
|---|---|---|---|---|---|
| 1 | Second-order flight model (mass / drag / thrust / tilt-lerp) | [drone.js:1092-1175](src/drone.js:1092) | **3/3** | 1-2 days | Foundational |
| 2 | Battery + signal-loss + RTH + tiered geofence enforcement | new module, hook at [drone.js:update()](src/drone.js) | **3/3** | 1 day | Highest CAAT-educational value |
| 3 | AGL terrain lookup; relabel 90 m line correctly | [ui.js:786](src/ui.js:786) | **3/3** | 0.5 day | Fixes a misleading teaching artifact |
| 4 | Stall + energy-trade in turns + pitch→airspeed coupling | [drone.js:1126-1175](src/drone.js:1126) | **3/3** | 0.5 day | Cessna finally teaches something |
| 5 | Real input pipeline (deadzone, expo, gamepad, rate-vs-angle, Mode 1/2) | [drone.js:1007-1016](src/drone.js:1007), [drone.js:933-993](src/drone.js:933) | **3/3** | 0.5-1 day | Legitimacy |
| 6 | Wind model + crosswind crab + track ≠ heading on HUD/minimap | new module; [drone.js:1033](src/drone.js:1033) | **2/3** | 0.5 day | "Aha" moment |
| 7 | VSI (variometer) on HUD | [ui.js:1122-1211](src/ui.js:1122) | **2/3** | 1 hour | Standard six-pack instrument |
| 8 | Persistent "next airspace ahead in N seconds" chip with vertical clearance | [airspace.js:223](src/airspace.js:223), [ui.js:507](src/ui.js:507) | **1/3** | 0.5 day | Active vs passive learning |
| 9 | Per-preset boost cap (777 boosting to Mach 2.25 is silly) | [drone.js:5](src/drone.js:5), [drone.js:1132](src/drone.js:1132) | **3/3** | 5 min | Embarrassment fix |
| 10 | Magnetic variation (Thailand ~0-1°E) so HUD can distinguish HDG/MH/TH | [drone.js:1033](src/drone.js:1033) | **1/3** | 30 min | Aviation literacy |
| 11 | Spool-up curve per preset (777 takes 30 s to throttle; Mavic snaps) | [drone.js:1039,1132](src/drone.js:1039) | **2/3** | 1 hour | Auditory + visual realism |
| 12 | Hover should not be a hard freeze — show ATTI mode drift in wind | [drone.js:984,1100](src/drone.js:984) | **1/3** | 1 hour | Teaches a DJI distinction |

---

## Dimension 2 — Performance

### Consensus diagnosis

The render loop ([src/main.js:330-378](src/main.js:330)) runs every subsystem every frame with no dirty-flag, no idle gating, no LOD, no frame-budget bail. Three.js usage is modest (no shadows, mostly `MeshBasicMaterial`/`MeshLambertMaterial`, log-depth buffer on) but lacks instancing and material sharing. Performance is fine *now* with 144 volumes on desktop, but **has no headroom for growth**: more airspaces (pan-Indochina dataset), better aircraft models, particle effects, or a slower device will hit a wall fast.

### Ranked improvements

| # | Change | File:line | Votes | Effort | Win |
|---|---|---|---|---|---|
| 1 | Bake minimap polygons to offscreen world-canvas; precompute CSS color strings; repaint only on filter/highlight/pan-half-tile | [ui.js:1326-1351](src/ui.js:1326) | **3/3** | 0.5 day | -30-50 % minimap CPU |
| 2 | AABB per airspace + throttle identify ray to ~10 Hz; or analytical ray-vs-prism | [identify.js:8-21](src/identify.js:8), [airspace.js:443-451](src/airspace.js:443) | **3/3** | 0.5 day | -50× to -90× when identify is on |
| 3 | Hoist `forward()/right()/move` `Vector3` scratch; mutate in place | [drone.js:1019,1029,1097](src/drone.js:1019) | **3/3** | 30 min | Removes GC sawtooth |
| 4 | Share materials across airspaces by `(category, highlightState)`; merge ribs into `LineSegments` per category | [airspace.js:131-189](src/airspace.js:131) | **2/3** | 0.5-1 day | 2 500 → ~50 draw calls; load-time win |
| 5 | Lazy-build airspace fill `ExtrudeGeometry` only on first highlight | [airspace.js:165-170](src/airspace.js:165) | **2/3** | 1 hour | 200-500 ms load + ~MB heap |
| 6 | Skip `ground.updateAround` when drone moved < ½ tile | [ground.js:159-189](src/ground.js:159), [main.js:352](src/main.js:352) | **2/3** | 15 min | A few cycles per frame |
| 7 | Cache canvas gradients across frames (HUD redraws `createLinearGradient` every call) | [ui.js:593,717](src/ui.js:593) | **2/3** | 30 min | ~5 % HUD time |
| 8 | Pause `requestAnimationFrame` on `document.hidden`; reduce DPR dynamically on slow frames | [main.js:30,330](src/main.js:30) | **2/3** | 30 min | Laptop battery + slow-GPU resilience |
| 9 | Cap `MinimapTileCache` with LRU (currently grows unbounded) | [ground.js:188-219](src/ground.js:188) | **3/3** | 15 min | Long-session memory leak |
| 10 | Dispose `material.map` texture in tile material disposal | [ground.js:50,152](src/ground.js:50) | **2/3** | 5 min | GPU texture leak on quality change |
| 11 | Gate `_drawAltTape` / `_drawAttitudeIndicator` on actual pitch/alt change | [ui.js:689,843](src/ui.js:689) | **2/3** | 30 min | Idle-frame win |
| 12 | Finish caching `#alt / #speed / #latlon` element refs in constructor (`querySelector` per frame) | [ui.js:1122-1211](src/ui.js:1122) | **2/3** | 10 min | Trivial wins |
| 13 | `_refreshAirspaceList` rebuilds 144 cards on every filter keystroke; switch to one-time render + DOM show/hide | [ui.js:1006-1074](src/ui.js:1006) | **1/3** | 30 min | -10× on filter typing |
| 14 | Reduce horizon-compass sprites from 512×256 to 128×128 (rendered at ~80 px) | [main.js:97-115](src/main.js:97) | **2/3** | 5 min | -3/4 texture memory |
| 15 | Add fixed-step physics substep (1/120 s) inside the variable outer loop | [main.js:330](src/main.js:330) | **1/3** | 1 hour | Frame-rate independence (required by #1 above) |

---

## Dimension 3 — Visual Quality (including ground-map clarity)

### Consensus diagnosis

The HUD components (artificial horizon, altitude tape, heading compass) are the **best-designed surfaces in the project** — anti-aliased, double-stroked, with reference bands and the 90 m line. Aircraft models are charming hand-built primitive groups. But the *scene* surrounding them is flat:
- A constant blue background ([main.js:15](src/main.js:15)), no sky dome, no sun disc.
- OSM tiles in their standard style — green forests + yellow roads that **clash with airspace fills** (CTR yellow over road yellow becomes invisible).
- 144 airspaces drawn as wireframe rib cages with no shaded side walls; at Bangkok they pile into a tangled bird-cage.
- No shadows, no AO, no specular, no env-map; the Mavic 3 reads as a dark blob.
- Static props (never spin), no nav lights, no control-surface deflection.
- Colorblind-unsafe airspace palette: CTR red ≈ Prohibited red ([airspace.js:7-14](src/airspace.js:7)).

### Ranked improvements

| # | Change | File:line | Votes | Effort | Win |
|---|---|---|---|---|---|
| 1 | Sky dome + sun disc + fog tint sampled from sky horizon; ACES tonemapping; altitude-driven fog falloff | [main.js:14-75](src/main.js:14) | **3/3** | 0.5 day | Single biggest perceived-quality jump |
| 2 | Switch to Carto Positron / Stamen Terrain; add Thai city-beacon sprites; add province `LineSegments` overlay | [ground.js:8-11](src/ground.js:8), [ui.js:1217](src/ui.js:1217) | **3/3** | 0.5-1 day | Directly attacks "ground-map clarity" |
| 3 | Animate props, deflect control surfaces from input, add red/green nav lights with sine-modulated visibility | [drone.js:118-132](src/drone.js:118), [drone.js:1068](src/drone.js:1068), model factories | **3/3** | 0.5 day | Viewer notices in 2 seconds |
| 4 | Render airspaces as shaded translucent volumes (vertex-gradient walls, optional floor disk, depth-test on) instead of wireframe cages | [airspace.js:131-189](src/airspace.js:131) | **2/3** | 0.5-1 day | Volumes finally *read* as volumes |
| 5 | Depth-aware label fade + top-N visible cap + screen-space declutter (port `layoutIdentifyLabels` from [identify.js:30](src/identify.js:30)) | [airspace.js:96-127,507](src/airspace.js:96) | **2/3** | 0.5 day | Label legibility at country view |
| 6 | Colorblind-safe airspace coding: keep colors, add diagonal hatch on Prohibited, dots on Restricted (canvas texture diffuse maps) | [airspace.js:7-14](src/airspace.js:7) | **1/3** | 0.5 day | Accessibility + arguably clearer |
| 7 | Time-of-day slider (sun azimuth from date + lat/lon); golden-hour Bangkok dusk over the CTR | [main.js:14-75](src/main.js:14) | **1/3** | 1-2 hours | "Wow" moment; free educational hook (CAAT VLOS daylight rule) |
| 8 | Cloud-puff sprite ribbon at 1 500-3 000 ft AGL with "CB layer at X ft" HUD chip on bust | new | **1/3** | 0.5 day | CAAT teaches "no flight above cloud" |
| 9 | Replace hardware-1px outlines with screen-space line width (`Line2` / `MeshLineMaterial`) | [airspace.js:131](src/airspace.js:131) | **1/3** | 1-2 hours | Outlines visible at distance |
| 10 | Subtle 10 % black wash inside artificial-horizon bezel for bright-sky contrast | [ui.js:990-991](src/ui.js:990) | **1/3** | 5 min | Tasteful polish |
| 11 | Tighten fog: from 80-400 km to 150-250 km; use exponential fog | [main.js:16](src/main.js:16) | **2/3** | 5 min | Restore sense of distance |
| 12 | Split HUD speed row (IAS / VS) into two rows + bump font to 13/15 px | [ui.js:1172](src/ui.js:1172) | **2/3** | 30 min | Phone friendly; six-pack reading |
| 13 | Contact shadow under aircraft (dark CircleGeometry at y=0) in first-person low-altitude | new | **1/3** | 30 min | Depth perception |
| 14 | Skip bottom airspace outline when `lower ≤ 1 m` (ground-base volumes mix poorly with tiles) | [airspace.js:147-150](src/airspace.js:147) | **1/3** | 5 min | Cleaner ground-class reads |

---

## Bugs found in passing (consolidated)

Sorted by severity; vote count in parens is how many passes independently spotted each.

### High — user-visible or correctness issues
- **(3/3) `BOOST_FACTOR = 3` applied uniformly to all presets** ([drone.js:5,1132](src/drone.js:5)) — Boeing 777 boosts to 2 760 km/h (Mach 2.25). Per-preset cap or rename to "afterburner" with a hard ceiling.
- **(2/3) `restore()` ordering** ([drone.js:1195-1209](src/drone.js:1195)) — `cameraMode` is restored *before* `teleport`, so `teleport`'s `if (!this.cameraMode)` branch takes the wrong path for snapshots that had a camera mode set. Also `bodyRoll` is set before `teleport`, which then doesn't preserve it.
- **(3/3) Geofence visible-only evaluation** ([airspace.js:305,446](src/airspace.js:305) — `_isActive` test in `airspacesAt` means hiding military airspaces makes the inside-chip silent. You can fly through a hidden RTAF area with no warning. A teaching sim must *always* evaluate membership and decide display separately.
- **(3/3) `identifyLabelsGroup` added to scene but never populated** ([airspace.js:418](src/airspace.js:418), [main.js:249](src/main.js:249)) — `_ensureIdentifyLabel` has no caller chain through `setHighlighted`. Identify mode never shows the floating 3-D airspace name sprite that the code clearly intends.
- **(2/3) Tile material `map` texture not disposed on quality change** ([ground.js:50,60,152](src/ground.js:50)) — silent GPU memory leak.
- **(2/3) Mobile/touch path doesn't gate simulator** ([main.js:312-323](src/main.js:312)) — touch-only user sees mobile notice over an active scene they can't control. Either block or build a touch input path.
- **(1/3) Missing rib on closed polygon airspaces** ([airspace.js:148-159](src/airspace.js:148)) — rib loop iterates open `ring`, last rib between `ring[N-1]` and `ring[0]` is missing. Visible vertical strut gap.
- **(1/3) Identify ray 800 m step can miss thin volumes** ([identify.js:8](src/identify.js:8)) — R-areas at grazing angles can be skipped entirely.
- **(1/3) `_refreshLabelText` loses military-filter visibility** ([airspace.js:332-349](src/airspace.js:332)) — new sprites default to `visible=true`, ignoring `_applyMilitaryVisibility`. Toggling "label floor/ceiling" while military hidden re-shows them.

### Medium — confusing or fragile
- **(2/3) `cameraMode = "down"` in chase view has no effect** — `_syncCamera` ignores `cameraMode` ([drone.js:890](src/drone.js:890)); also `forward()` clamps pitch to 0 only in down view, breaking WASD's documented body-frame behavior ([drone.js:1021](src/drone.js:1021)).
- **(2/3) `flyTo.cameraMode = null` mutation bypasses change-callback** ([flyto.js:40](src/flyto.js:40)) — UI badge says "Down view" until next manual press.
- **(2/3) Dead/unused exports** — `identifyLabelsGroup`'s `layoutIdentifyLabels` ([identify.js:30-60](src/identify.js:30)), unused `yaw` local in [main.js:194](src/main.js:194), `setSpeedMultiplier` deprecated stub still referenced by `restore` ([drone.js:1062,1200](src/drone.js:1062)).
- **(2/3) `vantagePoint(id)` drops FOV parameter** ([airspace.js:531](src/airspace.js:531)) — alias of `overviewVantage` using defaults; framing wrong if camera FOV differs from 70°.
- **(1/3) `_refreshAirspaceList` runs full items.map even when empty-message will overwrite it** ([ui.js:1057](src/ui.js:1057)) — wasted work; move empty check above the map.
- **(1/3) `flyDurationForDistance(0)` → divide by 0** in `flyto.start` ([flyto.js:48](src/flyto.js:48), [tourGuide.js:8-11](src/tourGuide.js:8)) — works by luck of `smoothstep(Infinity)`.
- **(1/3) Heading compass wrap glitch at 359.997 ↔ 0.003** ([ui.js:1163-1166](src/ui.js:1163)) — `toFixed(2)` string compare misses redraw across north wrap.
- **(1/3) `requestAnimationFrame` runs in hidden tab** ([main.js:330](src/main.js:330)) — battery drain.
- **(1/3) DPR not re-applied on monitor change** ([main.js:30](src/main.js:30)) — dragging window between displays leaves stale pixel ratio.
- **(1/3) `coords.js:21-26` uses Bangkok cos(lat) reference for all of Thailand** — ~0.2 % equirect error at Betong. Acceptable but document.
- **(1/3) OSM tile policy compliance** — direct requests to `a.tile.openstreetmap.org` without User-Agent or attribution per OSM's tile usage policy; risk of HTTP 429 at scale. Consider routing through Carto / Stadia / MapTiler.

---

## Cross-cutting themes (3-way consensus)

1. **"Educational" is the project's identity, but only the *airspace* education is delivered. The *flight* education is not.** Every Top-5 simulator improvement is also pedagogical (stall, geofence, AGL, banking lift loss, battery, RTH). Align mechanics with the mission.
2. **Per-frame work is uncached when it could be cached.** Three obvious offenders: minimap polygon redraw, identify ray-march, airspace material opacity mutation. Each has a natural single-frame cadence and a natural single-event cadence — the codebase consistently picks per-frame. A `dirty` flag pattern across ground/minimap/HUD canvases would cut ~30-40 % of CPU on idle frames.
3. **No state machine for sim modes.** `flightLocked`, `paused`, `identifyMode`, `hover`, `tour.isRunning`, `flyTo.active` are six independent booleans that gate each other in ad-hoc ways. An explicit `mode: 'free' | 'flyingTo' | 'touring' | 'paused' | 'replay'` enum would dedupe the guards in [main.js:340-349](src/main.js:340).
4. **No instancing / merging despite obvious opportunity.** 144 airspaces × 18 line objects = 2 500+ outline draw calls. Mavic 3 has 60+ child meshes. Both are textbook merge candidates.
5. **Visual style is "technical-with-care" but lacks atmosphere.** Hand-built models, careful HUD typography, sprite-labels — every component is well-executed at the unit level. But perpetual daylight, no sky, no clouds, no shadows. **A 4-hour weekend on atmosphere would 5× the perceived production value** with no physics change.
6. **The codebase is unusually clean.** The `_safe()` per-system wrapper at [main.js:326](src/main.js:326), the deterministic flight history, the labeled `coords.js`, the disciplined separation of concerns — these are signals of an experienced developer. The shortcomings above are scope choices, not sloppiness. The bones are there to grow this into something serious.

---

## Suggested execution roadmap

Grouped by **strategic phase**, not by dimension. Each phase delivers a coherent step-change in user experience.

### Phase A — "Stop the embarrassment" (½ day, no design risk)
The cheap wins that all three reviewers flagged independently:
- Per-preset boost cap (777 ≠ Mach 2.25)
- Hoist `Vector3` scratch in `forward/right/_updateFree`
- Precompute CSS color strings for minimap polygons
- Cap `MinimapTileCache` with LRU + dispose `material.map`
- Pause `requestAnimationFrame` on `document.hidden`
- Tighten fog (`80-400 km` → `150-250 km`)
- Finish element-ref caching in `updateHUD`
- Skip `_refreshAirspaceList` body when filter is empty

### Phase B — "Atmosphere weekend" (1-2 days, all visuals)
The single highest perceived-quality jump in the report:
- Three.js `Sky` dome + sun disc + sampled fog tint
- ACES tonemapping
- Animate props, deflect control surfaces, red/green nav lights
- Switch ground tiles to Carto Positron; add Thai city-beacon sprites; province `LineSegments` overlay
- Render airspaces as shaded translucent volumes; depth-aware label fade
- Subtle bezel wash on artificial horizon

### Phase C — "Make the title earned" (3-5 days, the real simulator)
Earn the word "Simulator":
- Second-order flight model with mass / drag / thrust / tilt-lerp + fixed-step substep
- Mavic 3 body actually pitches/rolls; attitude indicator becomes real instrumentation
- Stall + energy-trade in turns + pitch→airspeed coupling for fixed-wing
- AGL terrain lookup; 90 m line becomes correct
- Battery + signal-loss + RTH + tiered geofence (advisory / authorisation / no-fly)
- Wind model + crab + track ≠ heading on HUD/minimap
- VSI on HUD; per-preset spool-up curve
- Input pipeline: deadzone, expo, gamepad, rate-vs-angle, Mode 1/2

### Phase D — "Scale to Indochina" (when the dataset grows)
Performance work that's optional today but blocking when airspaces 3-5×:
- AABB + analytical ray-vs-prism for identify
- Bake minimap polygons to offscreen world-canvas
- Share airspace materials by `(category, highlightState)`; merge ribs into `LineSegments`
- Lazy-build `ExtrudeGeometry` fill; dynamic DPR reduction on slow frames
- Explicit `mode` state machine

### Phase E — "Active pedagogy"
Convert text rules into felt experiences:
- Persistent "next airspace ahead in N seconds" chip + vertical clearance gauge
- Tiered geofence intervention with HUD ribbons matching real DJI behaviour
- Lost-link RTH demo as a tour stop
- Colorblind-safe hatch patterns on Prohibited / Restricted fills
- Time-of-day slider (CAAT VLOS rule)
- Cloud-puff ribbon at 1 500-3 000 ft AGL

---

## Appendix — files cited

- [src/main.js](src/main.js) — 380 lines — scene, render loop, sky/fog, horizon compass
- [src/drone.js](src/drone.js) — 1217 lines — flight model, aircraft factories, HUD instruments
- [src/ui.js](src/ui.js) — 1386 lines — HUD canvas, minimap, panels
- [src/airspace.js](src/airspace.js) — 526 lines — volume rendering, point-in-poly tests
- [src/ground.js](src/ground.js) — 220 lines — OSM tile loading, fallback plane
- [src/identify.js](src/identify.js) — ray pick into airspaces
- [src/flyto.js](src/flyto.js) — camera lerp
- [src/tourGuide.js](src/tourGuide.js) — narrated airspace tour
- [src/coords.js](src/coords.js) — geo↔world
- [data/airspaces.json](data/airspaces.json) — 144-volume AIP Thailand AIRAC 2025-08-07
- [data/airspaceTour.json](data/airspaceTour.json) — tour script

Per-pass detail reports in `.scratch/betterment_20260528/pass{1,2,3}.md`.
