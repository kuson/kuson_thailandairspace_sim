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
- [x] Re-publish `tourGuide` on `window.__sim` after bootstrap — FIXED in B10.T1 (`d7b59aa`).

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

## 0c. Betterment-9 — INTERCEPT combat mode (2026-06-12, browser-verified C1–C3)

> Playbook: `20260612_ShebangPlaybook.md §B9`. Journal: 2026-06-12 (c). Branch `betterment7-20260612`.

- [x] **B9.T1 Trail system** — preallocated 120-pt `Float32Array` buffers; in-place writes + `setDrawRange`; `frustumCulled = false`; trim caps n ≤ 120. Baseline: 346 calls / 19 218 tris at 200 m; per-group culling SKIPPED (measured threshold ~450 not exceeded). (`3f25b79`)
- [x] **B9.T2 Aim system** — FOV 70 → 58° ease ≤ 150 ms; rate per-instance from `origFov` (orchestrator fix: was 6.67°/s); fire gated to `drone.locked`; `F` autofire; listener-leak-safe. (`a597bef`)
- [x] **B9.T3 Weapons hit math** — `raySphereT` analytical quadratic (unit-dir; behind-camera reject; inside-sphere exit-point); nearest-first 4 000 m; module-scratch Vector3; 4-spark shield burst; ember-tint sparks; `play("fire")` per-shot. **C1 verified:** hit/miss/nearest-first/beyond-range correct; overheat at shot 13 (cap 100), recovery ≤ 1.6 s; 10 shots cycle 8-tracer pool; FOV ease and reticle show/hide; fire gated locked-only; dispose clean. Pixel-baseline pre/post-B9 identical (390 calls / 20 584 tris). (`cef1eab`)
- [x] **B9.T4 UFO combat AI** — `{combat, shielded, orbitRadius}` opts; SCRAMBLE spawn byte-identical; EVADE speed behaviour-based (not radius-coupled); ORBIT capped 180 m/s; ORBIT-resume angle reseed. Browser: shield glow ×1.6; shielded hit no-op; unshielded hp 2 + EVADE; 3rd hit → explode + geometry baseline restored. (`30c20ca`)
- [x] **B9.T5 Crawler layer** — 6 crawlers ring-spawned 10 000 m, 15 m/s convergence, terrain-follow ≤ 2 Hz, reach-base ≤ 500 m + despawn, hp 2 destroy path; shared module geometry + materials; radar blips via `setGameBlipProvider`. (`de1592c`)
- [x] **B9.T6 INTERCEPT wiring** — mode row SCRAMBLE|INTERCEPT (ArrowLeft/ArrowRight), `kuson.game.v1.mode` persisted; defended CTR from `airports.json`; raiders = shielded UFOs 8 km orbit + crawlers 10 km ring. `atc.call` positional→object args fix; `aim.offFire` per-wave leak fix. **C2 verified:** WIN score 875 exact; BASE OVERRUN at integrity 0 (no NaN); UFO spawn-at-origin fix (`b36850a`); dying-UFO targeting fix (`b89f081`); abort mid-fight clean; SCRAMBLE regression clean; `bestScore` 875 preserved across mode switch. (`22c270a`, `b36850a`, `b89f081`)
- [x] **B9.T7 Shadow blobs** — ONE shared 128² `CanvasTexture` + flat `PlaneGeometry`; per-blob cloned material; `k = 1 − clamp((agl−200)/1800,0,1)`; player 8 m / UFO 60 m / crawler 35 m; `shadowGroundY` forced-init fix; hidden-until-first-update fix. **C3 verified:** 14 entity blobs at correct terrain heights 162–175 m; idle 1.69 ms/frame vs 7.89 ms/frame combat (under 16.6 ms budget); draw calls 273 in-fight vs 335 idle; pre/post parity 390 calls / 20 584 tris; B5 toggle exact restore (335→205→335); console errors pinned at 96 (all pre-B9, zero attributable to B9). (`b14f160`)
- [x] **B9.T8 Docs** — spec §3.16 INTERCEPT subsection + §6 acceptance rows 45–52; journal 2026-06-12 (c); TODO §0c.
- [ ] Shadow blobs for live-traffic (ADS-B layer) aircraft — deferred, cost.
- [ ] Wave-1 CADET INTERCEPT mathematically unlosable (3×20 + 3×10 = 90 < 100) — acceptable ramp, noted only.
- [ ] Player shadow blob not verifiable in suspended-rAF harness — code-reviewed; verify in a live session.
- [x] `__sim.ground` bootstrap overwrite hides `DynamicGround` — FIXED in B10.T1 (`d7b59aa`): bag renamed `groundLayers`, `tourGuide` re-published.

---

## 0d. Betterment-10 — World Beauty (2026-06-12/13, browser-verified C1–C3)

> Playbook: `20260612_ShebangPlaybook.md §B10`. Journal: 2026-06-12 (d). Branch `betterment7-20260612`.

- [x] **B10.T1 __sim handles** — `__sim.ground` = DynamicGround (updateAround callable), bootstrap bag → `groundLayers`, `tourGuide` defined; old bag was write-only (grep evidence). (`d7b59aa`)
- [x] **B10.T2 Terrain relief** *(Fable inline)* — per-vertex CPU displacement from the AGL elevation grid at tile build; SEGS 24/24; `aSea` attribute; `onTerrainReady` rebuild-once; toggle OFF byte-identical (tris 25 908 exact). Doi Inthanon tile 591–2 533 m; +55 200 rendered tris at baseline view (≤ 85 k budget). (`9c027a2`)
- [x] **B10.T3 Objects on relief + drone clamp** — beacon relifts after terrain load (race orchestrator-flagged); rings ride cached ground elev ≤ 2 Hz; drone floor `elevationAt + 1.5` all modes + teleport/flyTo arrival resample. **C1:** seam max gap 0.0004 m / 20 pairs; clamp 500→2 496.9 at the summit; AGL 1.5 m steady; frame-ms delta ≈ 0 → SEGS_BASE stays 24. Executor died mid-task → finished inline. (`1b4a813`)
- [x] **B10.T4 Day/dusk/night** — §B10.0 ramp table; DAY short-circuit = byte parity; auto = Bangkok clock; `kuson.daynight.v1`. Orchestrator fixes: module-level TDZ boot crash; `getNightFactor` 0/0.6/1 (was 0 at dusk). Sky via Preetham params (no color uniforms in sky.js — approximation noted). (`6e79397`)
- [x] **B10.T5 Night city + airport lights** — ONE Points/texture/program, world-metre sizes by prominence, async airport fill, relift, opacity = nightFactor × 0.9. Orchestrator fixes: world-size shader (was sub-pixel), frustumCulled=false, zero-viewport guard, **logdepthbuf chunks** (logarithmic depth buffer silently kills custom-shader points). (`77a4154`, fix `03bd1b7`)
- [x] **B10.T6 Water shimmer** *(Fable inline)* — `onBeforeCompile` + `aSea`; two sine bands ≤ 0.05 amplitude; ONE shared uTime/uWaterOn; constant cache key (+1 program); OFF mathematically identical. **C2:** Gulf scroll 8 083 px; OFF 0 px; inland 0 px; program delta ≤ +2 total; DAY parity exact. (`97c5a1f`)
- [x] **B10.T7 Wind profile + crosswind HUD** — ×1.0/1.5/2.0/2.8 at ≤500 m/3 k/6 k/11 k, veer +15°/3 km above 500 m dead-band (surface bit-parity 3/3); chip `… · X 3.8L T 4.2` flips L/R+H/T on 180° reversal; browser ratio 2.00 + veer +30° at 6 km exact. (`0345578`)
- [x] **B10.T8 G-limits** — n = 1/cos(bank) + q·V/g published per step (drag stays turn-only — review fix); C172 +3.8/−1.5, Learjet +4.4/−1.8, B777 +2.5/−1.0; proximity buffet + one-shot 880→660 tone (0.85 hysteresis); ADVISORY "AIRFRAME OVERSTRESS" after 1.5 s cumulative, auto-retract (alerts-snapshot verified); G row in pro HUD; easy mode G 1.0 inert. Executor died mid-task → finished inline. **C3:** full B5–B9 regression green, console zero entries all session. (`c09b44a`, `c4d02f7`)
- [x] **B10.T9 Docs** — spec §3.18 + §6 rows 53–60; journal 2026-06-12 (d); TODO §0d.
- [x] Province LINES on relief — FIXED on branch `b10-terrain-fixups-20260613` (`446b40b`): per-vertex elevationAt lift (+12 m) at build + reliftToTerrain after grid load; labels lifted too. Verified vertices span 12 m → 1,715 m (74% > 100 m).
- [x] City lights composed-scene visual — cross-phase sweep on real M1 hardware (journal 2026-06-13 (e)) found the lights rendered ZERO px in the live app; root-caused (glow-tex RGB→0 + terrain polygonOffset depth bias) and FIXED (`2e04555`): tint from uColor + texture as alpha mask + depthTest:false. Verified night 916px / dusk 832px / day hidden + visual screenshot.
- [ ] Player shadow blob still needs a foreground session — its updater runs only in the live rAF loop (backgrounded automation tab keeps rAF paused); code path identical to B9-verified combat blobs.
- [x] flyTo/tour lerp can pass through a mountain mid-flight — FIXED on branch `b10-terrain-fixups-20260613` (`ba6130b`): per-frame transit clamp to elevationAt + 120 m clearance, eased to target on final approach. Verified 50 m warp rose to ~124 m mid-transit, landed at 50 m.

## 0e. B10 cross-phase verification sweep (2026-06-13, real-hardware Chrome)

> Playbook §385 gate. Journal: 2026-06-13 (e). Branch `betterment7-20260612`.

- [x] §0.5.2 global regression — load clean, 5 presets via 1–5, WASD moves, HUD fields + instruments, identify/pause/hover/units, frame 1.06 ms (~946 fps proxy). (V view-toggle inconclusive in hover state — pre-existing.)
- [x] B5/B6 smoke — danger toggle 341→201→341 exact restore; B6 layer toggles restore; quality switch; identify. Tour handle present (synthetic start needs UI path).
- [x] 2-min mixed session — IDLE→BRIEFING→WAVE→abort→IDLE→explore; console zero errors + zero warnings throughout.
- [x] City lights live-hardware visual — FIXED + verified (see §0d).
- [ ] Player shadow blob live-hardware visual — deferred to foreground session (harness rAF pause).
- [x] Merge `betterment7-20260612` → main + tag `betterment7-complete` — DONE 2026-06-13 (user-confirmed fast-forward; see journal S243 note).

---

## 0f. Betterment-11 — Facelift (2026-07-02/03, autonomous orchestration, gates C1–C4 passed)

> Playbook: `20260702_FaceliftPlaybook.md`. Journal: 2026-07-02/03 (h). Branch `betterment11-20260702` (off main @ cab0722).

- [x] **B11.T0 Reconciliation + baselines** — main ff'd 71c38dc→cab0722 + pushed; branch pushed; 6 baseline PNGs + notes in `.scratch/facelift_20260702/`.
- [x] **B11.T1 uiPrefs registry** (`d2fa09a`) — 20 ids, sparse `kuson.uiprefs.v1`, keys route through registry; attitude default corrected to parity.
- [x] **B11.T2 View panel + ⚙ radar popover** (`b6c24f0`) — rows w/ key hints, T/C keys added, reset, floaters folded (radarOptions default false).
- [x] **B11.T3 Themes ×4** (`3aef79f`, `e8f2634`) — classic byte-identical; canvas palettes; 53 literals → color-mix; contrast ≥4.5:1.
- [x] **B11.T4 Panel IA + disclaimer footer** (`52b1c89`, design-reviewed) — 6 groups, `kuson.panel.v1`, footer verbatim + wraps.
- [x] **C1 gate** — 0/921,600 px parity vs pre-B11 worktree; theme-swap repaint bug found+fixed (`02e4019`).
- [x] **B11.T5 appMode** (`9f08c27`) — mode/detail source of truth + transition guards w/ chips; exact emission sequence verified live.
- [x] **B11.T6 uiProfiles** (`21a5fc6`) — session layer, wave/briefing/debrief/learning profiles, per-mode overrides win, exact-restore proven.
- [x] **B11.T7 Input scoping + Escape ladder** (`14f3ac8`, `fb3aae1`, `98c253a`) — 79-cell matrix; V=viewToggles; C2 fixed ladder deadlock + overlay CSS.
- [x] **C2 gate** — WAVE input storm state-frozen; both confirm cards round-trip; briefing Esc closes.
- [x] **B11.T8 Interior-fill fade** (`4a75653`) — 0.15× (clamp 0.03) in 1.5 s/out 2.5 s; clone lifecycle; program-delta 0; WORLD toggle default ON.
- [x] **B11.T9 Declutter laws** (`6018486`) — LAWS table @4 Hz under owner passes; tick 0.043 ms; master toggle default ON. (Executor died at session limit; orchestrator reviewed+committed.)
- [x] **B11.T10 Focus mode** (`f88543e`) — F key session-only; 143 non-kept dim/restore exact; auto-exit on mode change.
- [x] **C3 gate** — staged declutter ladder exact; defaults-off parity hash `5733134d` bit-identical vs pre-B11.
- [x] **B11.T11 Gated bloom overlay** (`73733ba`, Fable-inline) — legacy-frame overlay architecture (linear chain measurably broke translucent compositing); night-gated; day 0-px diff.
- [x] **B11.T12 Night pack** (`f32829c`) — 3,160-point city constellations (seeded generator, byte-identical re-runs) + 1,200-star dome + moon; day byte-identical.
- [x] **B11.T13 Terrain hillshade** (`00d6786`) — elevation-grid normals baked to vertex colors; OFF = byte-identical build; live rebuild ~32 ms.
- [x] **B11.T14 Bug sweep** (`340fbd0`) — district-label jump refresh; daynight two-way sync + eager init; alert/TARGET-strip stacking; placeLabel/pill clearance. Footer arithmetic verified.
- [x] **C4 gate** — repros pass; night-blowout found+fixed (`9880eef`: spread-compensated point alpha + bloom retune); day 1.65 ms / night-all-ON 3.77 ms ≤ 4 ms; defaults-OFF bit-parity; B5–B10 smokes green; console clean of B11 errors.
- [x] **B11.T15 Docs** — spec §3.19 + §6 rows; journal (h); this block; README.
- [ ] Merge `betterment11-20260702` → main + tag `betterment11-complete` — **user decision** (per B7 precedent).
- [ ] Foreground-session visuals: focus-mode chip pulse; player shadow blob (carried from §0e).

---

## 0g. Path heatmap — Traffic heat (2026-07-29, `node --test` verified)

> Plan: `docs/superpowers/plans/2026-07-29-path-heatmap.md`. Design: `docs/superpowers/specs/2026-07-29-path-heatmap-design.md`. Journal: 2026-07-29 (i).

- [x] **PH.T1 Grid math + altitude bins** — `gridMath.js`, `altBins.js`, `scripts/path_heatmap_config.json`; bbox/cell/bucket/recordKey + FL bins 0–3. (`40cb68e`)
- [x] **PH.T2 Settings + IndexedDB store** — `kuson.pathHeatmap.settings.v1`, `kuson-path-heatmap` v1, `incrementMany` pre-aggregate, `sumRange`/`pruneOlderThan`/`clear`. (`1492602`, `002e1fa`)
- [x] **PH.T3 Browser collector** — `onPositions` hook on LiveFlights, Wake Lock + visibility pause, writer=`browser` only, status `off|recording|paused|blocked|error`. (`8a64864`, `7936517`, `de50731`)
- [x] **PH.T4 Window bake + colormap** — presets 1h/6h/24h/7d/all + custom range, `bakeDensity` → RGBA, empty-window guard. (`203bc08`)
- [x] **PH.T5 2D radar heat underlay** — `layer2d.js`, minimap blit, north-up row fix. (`81c3174`, `884f317`)
- [x] **PH.T6 3D ground heat plane** — additive `THREE.DataTexture` plane in scene. (`ebc3493`)
- [x] **PH.T7 Module façade + UI + main wiring** — `index.js`, Traffic heat controls in live-flights block, throttled rebake, clear/import, `uiPrefs` registry row. (`7e92164`, `ec2fcbb`)
- [x] **PH.T8 Sidecar + shard import** — `scripts/path_heatmap_sidecar.py`, `importShards.js`, JSONL merge, `.gitignore` shards. (`964e8d6`)
- [x] **PH.T9 Docs** — spec §3.13 Traffic heat, README bullet, journal (i), this block; regression checklist below.
- [ ] Altitude-stack 3D viz (bins collected; UI deferred per design).
- [ ] Dual-writer dedupe (browser + sidecar simultaneously — explicitly out of scope v1).

### Path heatmap regression checklist (manual)
- [ ] Live flights LOD unchanged (K=20 / cap 150; trails ~8 min).
- [ ] Heat off → collector idle, rebake throttle idle (no bake cost).
- [ ] Reload → `kuson.pathHeatmap.settings.v1` + IndexedDB density survive.
- [ ] Sidecar import round-trip (`.jsonl` → store → 2D/3D bake).

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
- [x] **2026-07-02:** Execute **Betterment-11 Facelift** — DONE 2026-07-03, gates C1–C4 passed; see §0f + `journal.md` (h). Branch `betterment11-20260702` pushed; merge = user decision.
- [ ] Root-cause the pre-existing `THREE PlaneGeometry computeBoundingSphere NaN` console errors fired by large teleports before terrain streams in (reproduced on pre-B11 main — suspect a plane/blob geometry built from NaN elevation during the gap; see journal (h) known-deferred).

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
