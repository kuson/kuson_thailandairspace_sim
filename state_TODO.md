# Thai Airspace Sim — State & TODO (single source of truth)

> Update this file at the end of every session, after appending to `journal.md`. Tick a box only after the matching pass criterion has been verified (in browser for UI, in code review for logic).
>
> Conventions:
> - `[x]` — done and verified.
> - `[ ]` — open.
> - `[~]` — in progress / partial.
> - `[?]` — needs operator confirmation in a real browser.

---

## 0. Betterment-7 — Sky Guardian foundation (2026-06-12, browser-verified C1–C3)

> Playbook: `20260612_ShebangPlaybook.md`. Journal: 2026-06-12 (a). Branch `betterment7-20260612`.

- [x] **B7.T1 Debug overlay** — backtick toggle, `renderer.info` + FPS; baseline 294 calls / 55 textures / 15 programs recorded.
- [x] **B7.T2 Label texture dedup** — flight-label refcounted cache keyed on drawn content; airspace half reverted after no-regression review (canvases were already height-fitted — audit premise stale).
- [x] **B7.T3 Material pool + label-scale early-exit** — **no-op**: already implemented (P2.T7b/P2.T8); June-audit claims stale.
- [x] **B7.T4 GameMode FSM** — IDLE→BRIEFING→WAVE→DEBRIEF, inert when idle, wired into main loop.
- [x] **B7.T5 ATC radio** — RADIO tier (rank 7), bearing/nm/angels grammar, radio log panel; safety tiers preempt (verified: ADVISORY chip under RADIO banner).
- [x] **B7.T6 UFO layer** — spawn/orbit/banish over airspaces; leak-free dispose (geometry count returns to baseline).
- [x] **B7.T7 Typing challenge** — capture-phase suppression + `drone.keys.clear()`; zero flight-key bleed-through verified; per-glyph case/hyphen-lenient feedback.
- [x] **B7.T8 SCRAMBLE wave + score** — 3 CTR/TMA contacts, full play-through to debrief; `kuson.game.v1` persists; abort → IDLE with 0 UFOs. Autopilot final-approach fix (`f313a4d`) — overview vantage was above ceilings.
- [x] **B7.T9 Start screen** — real load progress, Explore/Tour/Play, `kuson.start.v1` last-choice highlight; Explore path renders identically to pre-B7.
- [x] **B7.T10 Docs** — spec §3.16 + §15 + acceptance rows; journal 2026-06-12 (a).
- [ ] Volume red-pulse on a lost contact (deferred from B7.T8, see `scramble.js` comment).
- [ ] Text-fitted airspace label boxes — visual change, B10 polish candidate (see journal T2 note).
- [ ] Re-publish `tourGuide` on `window.__sim` after bootstrap (has always been `undefined`; only `ui` is re-published).

---

## 0b. Betterment-8 — Sound + full SCRAMBLE (2026-06-12, browser-verified C1–C3)

> Playbook: `20260612_ShebangPlaybook.md §B8` (expanded at `6c81157`). Journal: 2026-06-12 (b). Branch `betterment7-20260612`.

- [x] **B8.T1 Audio core** — lazy `AudioContext`; `masterGain` → `engineBus` + `sfxBus`; alert tones by tier (SAFETY triple-beep / RADIO squelch chirp / ADVISORY ping); `kuson.audio.v1` persistence; Volume slider + Mute + Voice toggles in Display options. (`64a0662`)
- [x] **B8.T2 Engine loop + stall horn + buffet** — prop (saw 55→110 Hz / sub-octave / lowpass 900 Hz), jet (noise → bandpass 600→2400 Hz + 60 Hz rumble), hover/UFO (triangle 140 Hz + LFO); chains rebuilt on mode/preset change only. Stall horn: square 800 Hz gated 4 Hz at airspeed < 1.1 × Vs; buffet jitter ±0.15° @ 9 Hz, mute-independent. (`5c377b1`)
- [x] **B8.T3 ATC speech-synthesis voice + ducking** — `speechSynthesis` rate 1.05 / pitch 0.9 / en-GB→en-US→en; cancel-before-speak; squelch chirp + end click; engine duck ×0.4 / 150 ms ramps. Radio log always written regardless of voice setting. (`f709cf5`)
- [x] **B8.T4 Game SFX wiring** — tick (40 ms gate) / lockSweep / banish / lost / chime; all injected deps, null-safe. **C1 verified:** prop Hz tracked throttle via debug getters; horn ON/OFF at correct Vs thresholds; kind switching correct; log entry written; tick+lockSweep fired; settings persisted. (`df325de`)
- [x] **B8.T5 Difficulty tiers** — CADET (3/90 s/45 s/autopilot/any/×1), PILOT (4/75/35/no AP/short/×1.5), ACE (5/60/30/no AP/id only/×2); selector on BRIEFING, keys 1/2/3, persisted `kuson.game.v1.difficulty`. (`1bfc6c7`)
- [x] **B8.T6 Multi-wave progression** — Next-wave from DEBRIEF; contacts +1/wave; `timeLimit × 0.9^n` floor 45 s; SESSION TOTAL + `bestScore` + `waveReached` persisted; DEBRIEF → WAVE added to FSM guard. (`8a5c49e`)
- [x] **B8.T7 Tutorial** — 6 steps (hold-W / mouse-look / 3 rings / identify / type Bangkok CTR / done); T-key offer on BRIEFING for fresh players; `tutorialDone` persisted. Null-group crash on ring re-spawn fixed (amend to `6593991`). **Executor death mid-T7** — orchestrator completed briefing wiring + main.js + CSS inline. **C2 verified:** ACE wave 5 contacts/60 s, shortName rejected then id accepted (400 pts ×2 exact), full debrief 2442 pts streak-compounded, Next-wave → 6 contacts/54 s, `waveReached` persisted; tutorial all 6 steps, rings disposed, `tutorialDone` written. (`6593991`)
- [x] **B8.T8 Progressive HUD + quick warp chips** — `kuson.hud.v1 {pro}`; `pro` = true for returning players, false for fresh; minimal hides VS/WIND/BAT/LINK/NEXT/sim-speed/history/CAAT/toggles/alt-tape. Chips: Bangkok/Chiang Mai/Phuket/U-Tapao via catalog fly-to path. (`42cb80f`)
- [x] **B8.T9 Fresnel edge-glow** — `pow(1−|N·V|,3)×0.35` rim tinted by category vertex colour; shared `uGlowOn` uniform; OFF = pre-B8-identical (no recompile). Persistence `kuson.grounddetail.v1.volumeGlow`, default on. WebGL compile failure fixed (used raw `normal` attribute, not `objectNormal`). **Executor death mid-T9** — orchestrator staged + committed inline. **C3 verified:** rim visible and togglable, program count unchanged, audio regression clean. (`20946e2`)
- [x] **B8.T10 Docs** — spec §3.16 extensions (difficulty / wave / tutorial / wrong-answer / progressive HUD / warp chips / volume glow) + spec §3.17 Audio + §6 acceptance rows 37–44; journal 2026-06-12 (b); TODO §0b.
- [ ] Wrong-answer submit penalty (currently streak-intact on fail) — candidate polish for a future pass.
- [ ] Engine sound for live-traffic aircraft (ADS-B layer) — deferred from B8.
- [ ] Recorded voice-over pack to replace `speechSynthesis` — deferred from B8.

---

## 1. Current state (as of 2026-05-30, browser smoke)

### Browser smoke 2026-05-30 (Cursor IDE browser @ 9598ea0)
- [x] Boot clean — 144 airspaces, no console errors, `physicsStep` + alert queue live.
- [x] CAAT default OFF; toggle persists; Mavic clamp inside TMA when CAAT ON (verified after VTBD-TMA warp).
- [x] Tour End / Reset-during-tour clears `_tourRunning`; catalog fly-to works afterward.
- [x] Identify cap (3 + expand pill); flight history collapsible default.
- [x] **U1 fixed:** alert banner dynamically anchored below LINK row (`_positionAlertStack` in `ui.js`).
- [x] **U7 fixed:** identify panel usable on narrow viewports (`calc(100vw - 40px)` not `- 300px`).

---

## 1b. Prior state snapshot (2026-05-21, session d)

### Build & run
- [x] Single-page app, no build step. Open via `python3 -m http.server` (or any static server) and hit `index.html`.
- [x] Three.js r0.170.0 loaded via importmap from unpkg CDN.
- [x] ES modules: `main.js` → `drone.js`, `airspace.js`, `ui.js`, `coords.js`, `ground.js`, `geocode.js`, `geolocation.js`, `flyto.js`, `tourGuide.js`, `identify.js`, `flightHistory.js`.
- [x] Tour data: `data/airspaceTour.json` (short ~5 min + full country ~22 min).
- [x] Data loaded from `./data/airspaces.json` (**144 volumes** as of 2026-05-21, nationwide catalog incl. full ENR 5.1 P/R/D + RTAF/RTN military areas; 3 phantom CTRs removed 2026-05-21).
- [x] `scripts/build_airspaces.py` + source extracts for catalog regeneration. **Parser bug-fixed 2026-05-20** (radius token-ID confusion, decimal-second handling in vertex regex).
- [x] MIT license file present.

### Scene
- [x] Sky: flat `scene.background` + fog (no sky sphere).
- [x] Ground: zoom-9 base **7×7 following drone** + zoom-11 detail at Y=0.4 over base at Y=0; fallback plane follows drone.
- [x] Horizon compass: N/S/E/W sprites + poles at **200 km world-cardinal offset from drone**, updated each frame.
- [x] Fixed camera clip: near=2, far=600k.

### Airspaces
- [x] Wireframe cages + on-demand highlight fill (identify / catalog fly-to only).
- [x] Optional 3D sprite labels with floor/ceiling toggle; distance-scaled **14–28 px** clamp.
- [x] Identify mode (`I`): center-ray pick, volume highlight fill (now more transparent, 0.18), **bottom info cards** show distance to nearest point of each volume and sort nearest-first.
- [x] Point-in-volume hit-test; 40 000 ft overview fly-to.
- [x] Panel filter box for airspace list.
- [x] **Military airspaces (RTAF/RTN) shown by default** — display-option checkbox checked on load.

### Drone & input
- [x] 6-DoF + **absolute speed presets** (1×=50 km/h … 100×=10 000 km/h) + Shift boost ×3 + hover + pointer-lock.
- [x] Default preset **100×** on load.
- [x] **`↓` down**, **`←` left**, **`→` right** camera toggles (same key → front view); **`D` strafe right** restored.
- [x] `I` identify toggle; `flightLocked` during fly-to; camera modes cleared on fly-to start.
- [x] **`U`** toggle units (metric ↔ aeronautical: kt/ft/NM) — applies to HUD speed/alt, identify-card distance + base/ceiling, and radar range rings.
- [x] **`M`** toggle map-primary view — orthographic radar fills viewport; 3D scene shrinks to a 320×240 inset bottom-right.
- [x] **`+` / `-`** zoom map in/out (alongside scroll wheel).
- [x] **`V`** toggle 1st ↔ 3rd-person chase cam. Aircraft model auto-swaps by speed preset: **Mavic 3** (1×), **Cessna 172** (light GA), **Learjet** (bizjet), **Boeing 777** (scaled-down "cute" airliner), **UFO** (100× — flying saucer, was jet fighter pre-2026-05-21 (d)).
- [x] **`P`** pause / resume the simulation. Mirrors a HUD button (label flips to "▶ Resume").
- [x] **Airplane flight model** for Cessna / Learjet / B777 — always moving forward at `minKmh..kmh × boost`, **no reverse**, `A`/`D` = ailerons (bank → coordinated yaw via level-turn equation), `W`/`S` = throttle, `Q`/`E` = pitch. Drone (1×) and UFO (100×) keep the existing free 6-DoF strafe physics.

### Altitude reference
- [x] **Altitude tape** (HUD-right, **docked to HUD via flexbox at equal height**) — vertical canvas, auto-zoom around aircraft altitude (200 m → 45 km), red dashed line at **90 m drone limit (CAAT)**, major/minor ticks at human-friendly metric or aero steps, reference bands for Drone / Heli ops / GA-VFR / Jet climb / Airline cruise. Aircraft-position marker on the right edge; current altitude readout in canvas; scale-top label. **Toggle button** in HUD (Altitude).
- [x] **Attitude indicator** (center-screen overlay, toggle button in HUD) — 240×240 classic 6-pack artificial horizon, earth/sky split, pitch ladder + bank scale, yellow aircraft-symbol bars.

### Ground tiles
- [x] **Quality presets**: Low (z10), Medium (z11, default), High (z12), Ultra (z13), Auto (adapts to altitude: high <500 m, med <3000 m, low above). Settings dropdown in panel.

### Tour
- [x] **Cinematic orbit at each dwell stop** — aircraft slowly circles the airspace centre (1 rev / 90 s), direction alternates per stop; resumes after each fly-to lands.
- [x] **Identify mode forced off** at tour start; `I` keypress blocked while tour is running.

### HUD
- [x] Lat/Lon DMS; alt.
- [x] **Place label** — bottom-center transparent text (Amphoe, Province via Nominatim); removed from HUD panel.
- [x] **Horizontal slip HDG compass** — bottom cyan lubber triangle (no centerline), large cyan N/E/S/W cardinals, inertial smoothing (τ≈0.14 s), gradient housing, 30° numerals + digital readout.
- [x] **Identify bottom panel** — stacked category-colored cards (name, radius, base/ceiling) when `I` mode hits volumes.
- [x] Speed + preset label/target km/h; **flight history** Undo/Redo; inside chips (cached DOM).

### Startup
- [x] **GPS start** via `geolocation.js` when permitted and inside Thailand; fallback Bangkok 200 m AMSL.
- [x] Radar **map underlay on** and **center aircraft on** by default.

### Radar / minimap
- [x] Map underlay: per-tile bounds at zoom 8, circular clip.
- [x] **FOV cone** toggle (dashed triangle, 70° camera FoV, 80 km reach).
- [x] **Center aircraft** default on; drag-pan when off; scroll zoom; double-click recenter.
- [x] Nadir crosshair on radar when in down view.
- [x] **Identify / fly-to highlight** on radar — brighter fill, thicker stroke, dashed accent outline.

### Educational panel
- [x] **Live panel title** — current airspace name(s) from aircraft position.
- [x] **Airspace Tour Guide** — express (~5 min) and full country tour; takeoff → warps → Welcome to Explore; overlay narration + skip/end.
- [x] Display options; legend; **collapsible Thailand drone rules (default collapsed)**; warp fly-to list; filter box; reset; collapse.
- [x] **Resume flight removed** — replaced by HUD undo/redo.

### Render stability
- [x] Highlight fill only when active; fixed camera clip; detail ground at Y=0.4; `logarithmicDepthBuffer`.
- [x] Ground tiles follow drone nationwide.

### UX
- [x] Loading splash; controls hint (arrow views, `D` strafe, presets, radar center default); mobile fallback notice.
- [x] Crosshairs + nadir info + view-mode badge overlays.

### Documentation
- [x] `README.md`, `spec.md`, `journal.md`, `state_TODO.md`, `claude.md`.

---

## 2. Browser-verification checklist (run after every code-touching session)

Operator should walk through `spec.md §6` in a real browser. Until then these are `[?]`:

- [x] Loading splash disappears within ~2 s; GPS prompt handled. *(2026-05-30 browser smoke)*
- [?] OSM tiles render at GPS/Bangkok start; base + detail follow drone to Phuket/Chiang Mai warp.
- [?] Click → pointer-lock; WASD/QE move; mouse looks.
- [?] `Space` hover; `Esc` releases pointer.
- [?] Catalog warp + Undo/Redo; Reset clears history.
- [?] Alt+Tab no stuck-W.
- [?] Speed presets: 1× slow, 100× fast; preset name in SPD line.
- [?] `↓`/`←`/`→` view toggles + badge “press again for front view”; `D` strafes right.
- [?] HDG tape inertia visible when turning quickly; digital degrees immediate.
- [x] Identify mode (`I`): bottom stacked cards with category colors, radius, distance to nearest point, base/ceiling — sorted nearest-first; cap 3 + expand pill. *(2026-05-30 browser smoke)*
- [?] `U` flips speed/alt/distance/floor-ceiling between metric and aero (kt/ft/NM).
- [?] `M` swaps map ↔ 3D as primary view; inset shows the non-primary one.
- [?] `+`/`-` zoom map; `Esc` releases pointer.
- [?] Tour dwell phase orbits the airspace slowly, alternating direction per stop.
- [?] Tour with `I` already on: identify panel + crosshairs hide on tour start; `I` is a no-op while tour runs.
- [?] `V` toggles 1st/3rd person; cycling sim-speed presets swaps the aircraft model (Mavic 3 → Cessna → Learjet → 777 → F-16).
- [?] Altitude tape: red 90 m line visible near ground; auto-rescales (200 m → 45 km) as you climb; reference bands stay aligned with tick marks.
- [?] Horizon N/S/E/W follow aircraft position nationwide.
- [?] Radar center aircraft on by default; uncheck enables drag-pan.
- [?] Drone rules section collapsed by default; expands on click.
- [?] No flicker flying through nested CTR/TMA.
- [?] 3D labels toggle; height sub-toggle.
- [x] Panel title shows current airspace(s); filter box works. *(2026-05-30: VTBD filter → 2 entries)*
- [?] Movement works after catalog warp (hover not stuck).
- [?] Express tour completes in ~5 min; full tour visits north/south/east/west stops; finale returns to Bangkok; Skip/End work.

---

## 3. Open TODOs

### High value (next pass)
- [x] Expand ENR 5.1 coverage in `build_airspaces.py` — all VTP/VTR/VTD codes from AIP extract now parsed (147-volume catalog).
- [x] **2026-05-20:** Fix AIP parser radius/vertex bugs — 11 zones (VTD24/25/29, VTR3/5/6/12, VTP36/37, VTD34-1/-2) restored to authentic sizes. See `journal.md` 2026-05-20 (a).
- [x] **2026-05-21:** Removed 3 phantom CTR entries (`VTBS-CTR`, `VTCI-CTR`, `VTPR-CTR`) — duplicates/aliases/bogus ICAOs. Re-verified military classifier: 0 false positives, 0 false negatives. Reworded `VTUR-KKZ` (Korat RTAF) description. See `journal.md` 2026-05-21 (a).
- [x] **2026-05-21 (b):** Tour dwell-orbit + UX upgrades: `U` units (metric↔aero), `M` map-primary swap, `+`/`-` map zoom, identify cards show distance to nearest point + sort nearest-first, highlight fill 0.52→0.18 (more transparent). See `journal.md` 2026-05-21 (b).
- [x] **2026-05-21 (c):** Altitude reference tape with red 90 m drone limit + auto-zoom + Thai-aviation reference bands; 3rd-person chase cam (`V`) with per-preset aircraft models (Mavic 3, Cessna 172, Learjet, B777, F-16); tour mode now forces identify off. See `journal.md` 2026-05-21 (c).
- [x] **2026-05-21 (d):** Telemetry layout (altitude tape docked to HUD at equal height + Altitude/Attitude/Pause toggle buttons); attitude-indicator (artificial horizon) center overlay; **airplane flight model** for Cessna/Learjet/B777 (no stop, no reverse, ailerons turn via bank→yaw); `P` Pause; 100× model swapped from F-16 to **UFO**; ground-detail quality presets in Settings (low/med/high/ultra/auto). See `journal.md` 2026-05-21 (d).
- [ ] Re-verify VTR8 polygon against AIP ENR 5.1 DDMMSS source.
- [ ] Trace true Thai-Cambodian border for VTR62 polygon (currently straight-line closes through Cambodia — overstates area on that side).
- [ ] Sample arc segments for VTD34 / VTD58 / VTD17 instead of straight-line chord between endpoints.
- [ ] Add a smoke-test rig (Playwright or Puppeteer) covering the verification checklist in §2.

### Betterment-5 — Airspace de-clutter (✅ done + browser-verified 2026-06-01 (e); see `20260601_BettermentPlaybook.md` + `spec.md §13`)
- [x] **B5.T1** — `groupKeyFor(a)` + `AIRSPACE_GROUPS` in `airspace.js` (counts: 34/13/71/21/5 = 144).
- [x] **B5.T2** — `groupVisible` + `setGroupVisible` + unified `_applyVisibility`; extend `_isActive`.
- [x] **B5.T3** — `get/setAirspaceGroupSettings` (`kuson.airspacegroups.v1`).
- [x] **B5.T4** — Group chip bar + All toggle in the Airspace Window; extend `_refreshAirspaceList` filter.
- [x] **B5.T5** — Radar bake draws only visible groups; `groupVisible` in `_bakeSig`.

### Betterment-6 — Ground legibility (✅ done + browser-verified 2026-06-01 (e); see playbook + `spec.md §14`)
- [x] **B6.T1** — Curated `data/airports.json` (14 majors, `{icao,iata,name,lat,lon,prominence}`).
- [x] **B6.T2** — `src/airports.js` `installAirportBeacons` (port of `installCityBeacons`).
- [x] **B6.T3** — `src/rangeRings.js` `installRangeRings` (50/100/200 km · aero NM) following the aircraft.
- [x] **B6.T4** — Province name labels at centroids + visibility toggle (`provinces.js`).
- [x] **B6.T5** — `#optAirports/#optRangeRings/#optProvinces` toggles + `kuson.grounddetail.v1` persistence + `main.js` wiring.

### Medium
- [ ] Per-airspace teleport altitude clamp for very tall volumes.
- [ ] Indicate which tile failed to load (debug OSM rate-limiting).
- [ ] On-screen "approximate" reminder when inside an approximate volume.
- [ ] Bundle offline Amphoe/Province lookup table to avoid Nominatim dependency.

### Low
- [ ] Frame-budget logger behind `?debug=1`.
- [ ] `data/airspaces.schema.json` for IDE validation.
- [ ] Document local-tangent-plane math in `coords.js`.

### Out of scope for Phase 1 (parked)
- [ ] Terrain, AGL/AMSL split, FL conversion, NOTAMs, mobile/touch.

---

## 4. Known caveats (do NOT silently "fix" without re-spec)

- Flat tangent plane anchored at Bangkok; beyond ~300 km coordinates drift — catalog spans all of Thailand anyway.
- `lowerFt`/`upperFt` treated as metres above Y=0 regardless of ref tags.
- OSM + Nominatim depend on network and third-party policy.
- Wireframe-cage volumes trade solid fill for render stability — educational clarity preserved via ribs + optional labels.
- 132 of 144 catalog volumes are approximate (parsed ENR 5.1 arcs/coast segments, airport CTR/TMA overlays). 69 entries reference RTAF/RTN military operations.
- VTR62 EASTERN AREA (54 k km²) and VTD58 Surat Thani (35 k km²) are *correctly* parsed from the AIP — they are intentionally large training corridors. Their straight-line polygon closures (ignoring the Thai-Cambodian border / 30 NM arc segments) overstate area slightly; flagged `approximate: true`.

---

## 5. Recently-completed sessions (most recent first)

| Date | Operator | Focus | journal.md block |
|---|---|---|---|
| 2026-06-12 | Claude Code (Fable 5 orchestrator + Sonnet 4.6 executors) | Betterment-8: Sound + full SCRAMBLE — audio graph, engine/horn/buffet, ATC voice, game SFX, difficulty tiers, wave progression, tutorial, progressive HUD, warp chips, fresnel glow | 2026-06-12 (b) |
| 2026-06-12 | Claude Code (Fable 5 orchestrator + Sonnet 4.6 executors) | Betterment-7: Sky Guardian foundation — debug overlay, label dedup, GameMode FSM, ATC radio, UFO layer, typing challenge, SCRAMBLE wave, start screen | 2026-06-12 (a) |
| 2026-05-21 | Claude Code (Opus 4.7, session 53fdf4b8…) | Telemetry layout + attitude indicator + airplane flight model + P pause + UFO + ground-detail | 2026-05-21 (d) |
| 2026-05-21 | Claude Code (Opus 4.7, session 53fdf4b8…) | Altitude tape + 3rd-person/aircraft models + tour-identify fix | 2026-05-21 (c) |
| 2026-05-21 | Claude Code (Opus 4.7, session 53fdf4b8…) | Tour dwell-orbit + UX (U units, M map-primary, +/- zoom, identify distance/sort/transparency) | 2026-05-21 (b) |
| 2026-05-21 | Claude Code (Opus 4.7, session 53fdf4b8…) | Crowded-airspace audit — 3 phantom CTRs removed; military classifier re-verified | 2026-05-21 (a) |
| 2026-05-20 | Cursor Agent | Airspace Tour Guide (5 min + full country) | 2026-05-20 (d) |
| 2026-05-20 | Cursor Agent | PLACE bottom-center; HDG compass lubber/cardinals; military default on | 2026-05-20 (c) |
| 2026-05-20 | Cursor Agent | Radar identify highlight; PLACE moved to bottom-right overlay | 2026-05-20 (b) |
| 2026-05-20 | Claude Code (Opus 4.7, session 53fdf4b8…) | AIP parser radius/vertex bug fix — 11 oversized zones corrected | 2026-05-20 (a) |
| 2026-05-19 | Cursor Agent | Full ENR 5.1 military/P/R/D catalog (145 volumes) | 2026-05-19 (l) |
| 2026-05-19 | Cursor Agent | HDG compass polish + inertia; identify bottom panel | 2026-05-19 (k) |
| 2026-05-19 | Cursor Agent | Horizontal slip HDG compass (aviation tape style) | 2026-05-19 (j) |
| 2026-05-19 | Cursor Agent | Arrow camera views, HDG compass, horizon compass, radar default, collapsible rules | 2026-05-19 (i) |
| 2026-05-19 | Cursor Agent | Speed presets, D/B camera, radar center aircraft | 2026-05-19 (h) |
| 2026-05-19 | Cursor Agent | Flight history, GPS start, 68 airspaces, label scale, ground follow | 2026-05-19 (g) |
| 2026-05-19 | Cursor Agent | Radar zoom/pan, identify, fly-to, panel title | 2026-05-19 (f) |
| 2026-05-19 | Cursor Agent | E1/E2/E3 fixes: sky, ground z-fight, map tiles, pan flicker | 2026-05-19 (e) |
| 2026-05-19 | Cursor Agent | Sim-speed buttons (1–100×), movement flicker fixes | 2026-05-19 (c) |
| 2026-05-19 | Claude Code (Sonnet, session 53fdf4b8) | Consolidation, audit, 7 bug fixes, doc files written | 2026-05-19 (b) |
| 2026-05-19 | Claude Dispatch ×3 (web) | Initial build of Phase 1 | 2026-05-19 (a) |
