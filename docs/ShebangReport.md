---
id: 20260611_ShebangReport
title: 20260611 — The Whole Shebang Report
class: spec
version: 1.0.0
status: active
updated: 2026-06-11
owner: kuson
applies_to: []
supersedes: []
superseded_by: []
---
# 20260611 — The Whole Shebang Report
## Thailand Airspace Simulator: 10× Review + "Sky Guardian" Game Layer Design

**Date:** 2026-06-11 (Asia/Bangkok)
**Branch audited:** `betterment2-20260529` @ `ef85784` (clean tree)
**Method:** Four parallel audit agents (rendering/performance, realism, onboarding/UX, game-layer hook points), all findings cited as `file:line`.
**Author:** Claude (Fable 5), acting Flight Simulator Architect

---

# PART 0 — Executive Summary

The sim is in remarkably strong shape as an **educational airspace visualizer**: real CAAT AIP data (144 volumes, AIRAC 2025-08-07), a credible second-order fixed-wing physics model with stall/energy/bank-coupled drag, live ADS-B traffic with LOD, a real Thailand DEM already shipped in `data/terrain.bin`, and a mature alert/tour/fly-to infrastructure. The codebase is modular vanilla JS with no framework debt — ideal for layering a game on top.

The four biggest 10× levers, in order of payoff-per-effort:

1. **Use the DEM you already have.** `data/terrain.bin` (30 arc-sec Thailand elevation) is only used for AGL math ([terrain.js:1–80](src/terrain.js)). Displacing the ground tile meshes with it turns a flat blue plane into actual Thai mountains — the single largest visual jump available, and the data is already downloaded.
2. **Add sound.** The codebase has **zero audio** — no engine, no stall horn, no ATC. A small Web Audio layer (engine loop + warning tones + speech-synthesis ATC) is the largest *immersion* jump per line of code.
3. **Cut first-load chrome from ~55% to ~20% of the viewport** with a 3-button start screen (Explore / Tour / **Play**) and progressive HUD disclosure. Right now a new player faces 12+ shortcuts, a 360px panel, and a 147-item list before they ever fly.
4. **Ship the game layer.** Every load-bearing system the UFO-defense game needs already exists: airspace query + random pick, fly-to autopilot with `onComplete`, an entity layer to clone (liveFlights), an alert/priority message bus for the ATC radio, a UFO mesh preset in drone.js, and localStorage persistence patterns. Only five genuinely new systems are required (text-input capture, weapons, UFO AI, ATC sequencer, audio).

Proposed game: **Operation Sky Guardian** — two interlocking modes (SCRAMBLE typing-defense and INTERCEPT aim-and-shoot) built on a real rules-of-engagement framing: *you must correctly identify a contact before you are weapons-free*. The typing-tutor mechanic IS the identification step, which makes it educational *and* doctrinally authentic.

---

# PART 1 — Current State (what the audit found)

## 1.1 Architecture snapshot

| Layer | Implementation | Evidence |
|---|---|---|
| Engine | Three.js 0.170.0 via importmap/CDN, no bundler | index.html importmap |
| Renderer | antialias, log depth buffer, NeutralToneMapping, pixelRatio ≤ 2, no shadows, no post-FX | [main.js:171–185](src/main.js) |
| Lighting | HemisphereLight + 1 DirectionalLight; airspaces/ground unlit (MeshBasicMaterial) | [main.js:472–476](src/main.js) |
| Ground | Dual-zoom CARTO Voyager raster tiles (z9 base + z11–12 detail, ~50–100 meshes), flat 800×800 km fallback plane | [ground.js:404–428](src/ground.js), [main.js:509–520](src/main.js) |
| Terrain data | Real 30 arc-sec Thailand DEM, bilinear sampled — **used for AGL only, not rendered** | [terrain.js:1–80](src/terrain.js) |
| Airspaces | 144 CAAT AIP volumes → per-airspace Group (floor + 4 extruded walls + canvas-sprite label), procedural hatch/dot patterns for Prohibited/Restricted | [airspace.js:303–339, 466–481](src/airspace.js) |
| Physics | FixedWingModel (energy trade, stall at 1.05·Vs, load-factor drag, coordinated turn) + QuadrotorModel + Easy-Mode hovercraft | [physics.js:33–270](src/physics.js) |
| Aircraft | Procedural meshes: Mavic 3, C172, Learjet, A320-ish, B777, **UFO preset** | [drone.js:850–1400](src/drone.js) |
| Live traffic | 3 pluggable ADS-B sources, dead-reckoning + easing, LOD (20 full models / 150 cap), trails, labels with declutter | [liveFlights.js](src/liveFlights.js), [flightSources.js](src/flightSources.js) |
| Failures | Battery, RTH state machine, RadioLink dropouts, Geofence | [failures.js:1–350](src/failures.js) |
| Messaging | Priority alert queue (8 tiers), single banner + chip tray, key-upsert | [alerts.js:15–99](src/alerts.js), [ui.js:442–526](src/ui.js) |
| Tour | Scripted fly-to + 20s cinematic orbit dwell + narration overlay, EXPRESS/FULL variants | [tourGuide.js:44–151](src/tourGuide.js) |
| Audio | **None anywhere** | — |
| Mobile | Hard "Desktop required" stop | index.html:858–864 |

## 1.2 What's genuinely excellent (keep, build on)

- **Real data discipline**: airspace records carry `source: "AIP ENR 2.1"`, AIRAC date, `approximate` flags ([data/airspaces.json](data/airspaces.json)).
- **The physics core** is honest: stall + induced-drag-by-bank + spool time constants per type are the right second-order model for this scope ([physics.js:33–180](src/physics.js)).
- **The liveFlights entity lifecycle** (spawn on poll → ease → LOD promote/demote → fade-despawn → dispose) is a ready-made blueprint for any dynamic entity, including UFOs.
- **The alert queue** is exactly the message bus an ATC radio needs ([alerts.js:27–97](src/alerts.js)).
- **Tour guide** is 90% of a mission-scripting engine already (timed stops, fly-to, narration, skip).

---

# PART 2 — The 10× Plan

## 2.1 VISUAL — ranked by impact ÷ effort

| # | Upgrade | What/How | Impact | Effort |
|---|---------|----------|--------|--------|
| V1 | **Terrain relief from the existing DEM** | Subdivide ground tile planes (~32×32) and displace vertices via `elevationAt()` from [terrain.js](src/terrain.js); vertex-color a subtle hypsometric tint + slope shading baked into vertex colors (stays MeshBasicMaterial-cheap). Doi Inthanon, the Tenasserim ridge, and the Khorat Plateau become visible from altitude. | ★★★★★ | M |
| V2 | **Day/night cycle + night city lights** | Animate Preetham sun elevation by sim clock ([sky.js:66–205](src/sky.js)); at night dim hemisphere light, switch city beacons ([cities.js:1005–1062](src/cities.js)) to warm glow clusters, add star dome (cheap point sprites — the space-transition fade at 60–100 km already exists). | ★★★★★ | M |
| V3 | **Living water** | Replace the flat `0x125a96` fallback plane ([main.js:509–520](src/main.js)) with a Gerstner/normal-scroll shader for the Gulf of Thailand + Andaman Sea; specular sun glint. | ★★★★ | M |
| V4 | **Airspace volumes → "fields of energy"** | Keep extruded walls but add fresnel edge-glow + soft vertical gradient via onBeforeCompile (pattern infra already exists at [airspace.js:337–372](src/airspace.js)). Volumes stop reading as painted boxes. Doubles as UFO-game "shield" language. | ★★★★ | S |
| V5 | **Aircraft ground shadow blob** | Fake soft shadow disk projected to terrain height under each aircraft (incl. live traffic). Best altitude cue in any sim, no shadowMap cost. | ★★★ | S |
| V6 | **Airport runways** | Real runway outline geometry at the ~38 airports (OSM-derived, one-time bake into [data/airports.json](data/airports.json)); makes airports landable destinations, and INTERCEPT ground-target arenas. | ★★★ | M |
| V7 | **Selective bloom (quality-gated)** | Single UnrealBloom pass behind a "Quality: High" toggle — beacons, sun, UFO glow, tracers pop at night. First post-FX, keep it optional. | ★★★ | S |
| V8 | **Weather visuals** | Wind particle streaks near the aircraft; distant cumulus billboards over land in the afternoon (Thai monsoon flavor); rain curtain shader for storms. | ★★★ | L |

## 2.2 PERFORMANCE — top fixes (protects the 60 fps budget the game will spend)

| # | Fix | Evidence | Win |
|---|-----|----------|-----|
| P1 | **Pool/atlas label canvases.** 144 airspace + 24 city + up to 150 flight labels each own a 512×256 RGBA canvas texture (worst case ~100 MB+ GPU). Build a shared glyph atlas or at minimum pool canvases by size, dedup identical flight labels ([airspace.js:303–324](src/airspace.js), [liveFlights.js:855–908](src/liveFlights.js)). | Audit B-3, B-9 | up to ~100 MB VRAM |
| P2 | **Actually use `WALL_MAT_POOL`.** Declared at [airspace.js:369–372](src/airspace.js) but patterned airspaces still get per-mesh shader instances (~200–300 programs instead of 4). | Audit B-5 | shader compile + state changes |
| P3 | **Early-exit `updateLabelScales()` on invisible labels.** Five per-frame label-scale passes traverse everything ([main.js:617–623](src/main.js)); skip `visible === false` first. | Audit B-4 | 2–5 ms/frame back |
| P4 | **Frustum/distance-cull airspace groups.** 144 floors + ~576 walls render unconditionally ([airspace.js](src/airspace.js)). Cheap per-group bounding-sphere check vs camera. | Audit B-7 | draw calls at altitude |
| P5 | **Trail buffer reuse.** Preallocate one BufferAttribute per trail with `drawRange` instead of `new THREE.BufferAttribute` per poll ([liveFlights.js:435–436](src/liveFlights.js)). | Audit B-6 | GC churn |
| P6 | **Bound 3D tile texture memory + fix fog/camera-far mismatch** (`fog.far` can compute to ~833 km vs `camera.far` 600 km, [main.js:581–582](src/main.js)); clamp it. | Audit B-1, B-8 | memory + correctness |
| P7 | **Instrument it.** Debug overlay reading `renderer.info` (draw calls, textures, geometries) behind a `~` key. You cannot keep a budget you can't see — and the game layer will need this. | Audit D-10 | guardrail |

Budget rule for the game layer: **everything in Part 3 must fit inside ~4 ms/frame**, which P1–P5 buy back.

## 2.3 REALISM — top gaps (what a pilot notices first)

| # | Gap → Fix | Evidence |
|---|-----------|----------|
| R1 | **Silence.** No engine note, no stall horn, no ATC. Add a tiny `audio.js`: procedural engine loop pitched by RPM/throttle, gear/flap thunks later, two-tone stall warning at 1.1·Vs (currently stalls silently at 1.05·Vs, [physics.js:120–140](src/physics.js)), alert beeps tied to the existing alert tiers. | Realism audit #2, inventory #17 |
| R2 | **Stall buffet.** Pre-stall airframe shake (camera + control degradation) starting 1.1·Vs so the silent nose-drop stops surprising people. | [physics.js:120–140](src/physics.js) |
| R3 | **Wind doesn't vary with altitude.** Add a simple 3-layer profile (surface monsoon / 10 kft / FL300 jet-ish) interpolated by `y` — currently `currentWind` ignores altitude ([wind.js:60–80](src/wind.js)). Display head/crosswind components in the HUD (today it's met-direction only, [ui.js fmtWind](src/ui.js)). | Realism audit #4, #8 |
| R4 | **G-awareness.** Load factor `n` is already computed but never checked ([physics.js:100–110](src/physics.js)); add type G-limits (C172 +3.8/-1.52), overstress warning, brief control stiffening. Free realism — the number already exists. | Realism audit #3 |
| R5 | **ATC/transponder flavor.** Squawk code field + "radio" message log panel. This is shared infrastructure with the game's ATC (see 3.4) — build once, use twice. | Realism audit #5 |
| R6 | **Live traffic kinematics.** Ease velocity/altitude through realistic accel limits per bucket instead of stepping to each poll target ([liveFlights.js:75–130](src/liveFlights.js)). | Realism audit #7 |
| R7 | **Magnetic variation** (~0.8°E in Thailand) as a toggleable HDG mode; trivial, delights avgeeks. | Realism audit #10 |

## 2.4 EASIER TO START — onboarding overhaul

The audit's first-session walkthrough found: blank 2–4 s load with text-only indicator (index.html:723), **~55% of the viewport is chrome**, a 12-shortcut wall of text, the tour buried in a collapsible, and a 147-item airspace list as the primary affordance.

The fix is one principle: **the first 60 seconds should contain one choice and one success.**

| # | Change | Detail |
|---|--------|--------|
| O1 | **Start screen, 3 buttons** | Loading progress bar (assets are only ~112 KB JSON + tiles — show real progress) behind a Thailand-silhouette splash, then: **🗺 Explore** (current sandbox, minimal HUD) / **🎓 Tour** (straight into EXPRESS tour) / **🛸 Play** (Sky Guardian). Remembers last choice in `kuson.start.v1`. |
| O2 | **Progressive HUD** | Default to ALT + SPD + HDG + minimap only. Full telemetry, history, altitude-limits editor appear via a single "⚙ Pro panel" toggle. Chrome target: ≤20% of viewport. |
| O3 | **60-second interactive tutorial** | Replaces the passive hint-bar as the teaching device: "Hold W" → "Mouse to look" → "Fly through this ring" (3 rings) → "Press I and identify Bangkok CTR" → done, confetti, choose mode. Reuses tour overlay + fly-to + identify; ~1 day of work. |
| O4 | **Contextual hints instead of the wall** | Hint chips appear on first relevant moment ("near an airspace → 'Press I to identify'"), each shown once, persisted. Keep the full cheat-sheet behind `?`. |
| O5 | **"Where should I go?" quick chips** | Above the 147-item list: 4 curated chips — Bangkok CTR, Chiang Mai, Phuket, U-Tapao. Decision paralysis solved. |
| O6 | **Mobile: degrade gracefully** | Easy-Mode-only with twin virtual sticks + warp-to list. The hard "Desktop required" stop (index.html:858–864) throws away every phone-holding student the educational mission targets. (Phase it after the game ships.) |

---

# PART 3 — Operation Sky Guardian (the game layer)

## 3.0 Fantasy & framing

Thailand's airspaces are under incursion by unidentified craft. You are a Royal Thai Air Defense duty pilot. **Air control radios in contacts by airspace name** — your job is to get there, **identify** (type the designator — ROE: no weapons release without positive ID), and **intercept**. The typing mechanic isn't a gimmick: identification-before-engagement is real interception doctrine, so the educational mechanic and the fiction reinforce each other. Military operator colors already in the visual spec (RTAF turquoise / RTN navy / RTA green) become the faction language for who "owns" each defended zone.

## 3.1 Mode A — SCRAMBLE (typing defense / airspace-knowledge tutor)

**Loop (per contact):**
1. ATC radio (banner + voice + message log): *"Radar contact — unidentified craft over **Chiang Mai CTR**. Scramble and identify."* The airspace is **named, not shown** — the player must know/find it (the minimap and airspace list remain available; higher difficulties disable the list).
2. Player travels there: Easy difficulty offers "Autopilot" (reuses `FlyToController.start(vantage, {onComplete})`, [flyto.js:15–72](src/flyto.js) + `overviewVantage()`, [airspace.js:859–902](src/airspace.js)); Normal+ requires manual flight — this is where airspace *locations* get learned.
3. On entering the correct volume (`airspacesAt(x,y,z)`, [airspace.js:709–719](src/airspace.js)), the UFO becomes targetable and an **ID challenge card** opens: type the airspace designator/name (e.g. `VTCC-CTR` or "Chiang Mai CTR"). Per-glyph green/red feedback, WPM + accuracy tracked. Correct entry = blinding ID beam, UFO banished, score.
4. Wrong airspace? ATC corrects you ("Negative, that's Lampang TMA — contact bears 270, 40 miles"). Timeout? The airspace "falls" (volume pulses red for the rest of the wave) and the defense rating drops.

**Scoring:** base by airspace obscurity (Bangkok CTR = common = low; `VTD21-1` danger area = deep cut = high) × speed bonus × typing accuracy × combo streak. End-of-wave report doubles as a **study sheet**: which airspaces you knew, which you didn't.

**Why it teaches:** name→location (navigation), name→spelling (typing tutor), name→class/limits (the card shows floor/ceiling/class after each ID — spaced repetition for free).

## 3.2 Mode B — INTERCEPT (aim & shoot, air + ground)

**Air targets:** UFO saucers (reuse/restyle the existing UFO preset mesh, [drone.js:850–1400](src/drone.js)) orbit the target airspace centroid with simple behaviors: ORBIT → EVADE (when fired on) → ATTACK_RUN (dives toward the airport/city beacon) → RETREAT. Shields up until identified (Mode A's typing = shield-drop in combined mode; in pure-arcade INTERCEPT, a 2-second "ID lock" reticle hold substitutes).

**Ground targets:** landed saucers / crawler pods spawn at range-ring distance and converge on the defended airport beacon ([airports.js](src/airports.js)) — visible on the minimap as ground tracks. Strafing runs against ground targets teach energy management for free (dive, fire, climb, don't mush into the terrain — which now has relief, per V1).

**Weapons (hitscan first, projectiles later):**
- Cannon: camera-ray hitscan with cooldown + heat; tracer = fading `THREE.Line` + muzzle sprite; hit spark = 6-particle burst (one shared Points geometry, pooled).
- Later: missile with lock-on cone (reuses identify's analytical ray math, [identify.js:54–110](src/identify.js)) and a lead-pursuit indicator — the genuinely "flight sim" skill.
- Aiming camera: chase cam already exists (THIRD_PERSON_BASE, [drone.js:1–25](src/drone.js)); add a reticle + slight zoom on aim.

**ATC vectors mid-fight:** *"Two more contacts, Korat CTR, angels 12"* — pulls the player across the map; the wave is a route-planning problem, not a shooting gallery.

## 3.3 Difficulty & progression

| Tier | Travel | ID challenge | Enemies | Aids |
|---|---|---|---|---|
| Cadet | Autopilot offered | shortName, generous timer | 1 UFO/contact, no ground | list + minimap + highlighted target volume |
| Pilot | Manual flight | full designator | 2–3 UFOs, slow ground crawlers | minimap only |
| Ace | Manual + wind + fuel/battery | designator, phonetic-alphabet bonus rounds ("type: Victor Tango Bravo Delta") | evading UFOs, fast ground waves | radio bearings only ("bears 045, 60 nm") |

Waves of 5–8 contacts; between waves a debrief screen (score, accuracy, WPM, airspaces learned). Medals persisted to `kuson.game.v1` (same localStorage pattern as [simState.js:9–35](src/simState.js)). Optional daily-challenge seed (date-seeded RNG) for replay value.

## 3.4 ATC radio (shared with realism R5)

- **Transport:** the existing alert queue ([alerts.js:15–99](src/alerts.js)) gets a new `RADIO` tier + a scrollable message-log panel (collapsible-section pattern, 9/10 reuse score per audit).
- **Voice:** `speechSynthesis` with an English voice, slight rate-up, radio-filter trick (prepend chirp SFX, no actual DSP needed at v1). Free, offline, zero assets. Recorded VO can replace it later.
- **Grammar:** template strings over airspace records — *"{contact count} contact(s), {shortName}, {bearing from player} for {nm} miles, angels {alt/1000}"*. Bearing/distance computed from `geoToWorld(center)` ([coords.js](src/coords.js)).

## 3.5 What must be built from scratch (the honest list)

| New system | Notes | Size |
|---|---|---|
| `src/game/typing.js` | Modal text-capture: suspends drone/camera keys (flag checked in [drone.js](src/drone.js) input path — same suppression mechanism tour/fly-to already use), Enter/Esc, fuzzy match vs `shortName`/`id`, per-glyph render | S–M |
| `src/game/ufo.js` | Entity layer cloned from the liveFlights lifecycle (spawn/update/LOD/dispose), behavior FSM, health/shield | M |
| `src/game/weapons.js` | Hitscan ray vs UFO bounding spheres + ground targets, cooldown/heat, tracer + spark pools | M |
| `src/game/atc.js` | Mission/wave sequencer (JSON script: time, airspaceId, count, type), radio grammar, speech | M |
| `src/game/score.js` + debrief UI | Accumulator, combos, medals, localStorage, end-of-wave card | S |
| `src/audio.js` | Shared with realism R1 — engine loop, warnings, radio chirps, fire/hit SFX (procedural Web Audio first, samples later) | M |
| `src/game/gameMode.js` | Top-level FSM: IDLE → BRIEFING → WAVE → DEBRIEF; one `update(dt)` slotted into the main loop next to `drone.update(dt)` ([main.js](src/main.js) render loop) | S |

Everything else — random airspace pick, world position, fly-to, in-volume detection, highlight pulse, banner messaging, minimap markers, persistence, the UFO mesh itself — **already exists** and was verified with citations in the hook-point audit.

## 3.6 Spec integration

Per the repo's conventions: add **spec §3.16 "Game Mode: Sky Guardian"** (functional contract: modes, ATC grammar, scoring, persistence keys `kuson.game.v1`), extend §11 visual-design principles (threat colors map to existing category palette; UFO glow uses the airspace-class color of the violated volume), and a §15 implementation-architecture section mirroring §13/§14 structure. Acceptance criteria join §6 (suggate ~8 new user-facing tests: radio fires, autopilot honors lockouts, typing suspends flight input, score persists, etc.).

---

# PART 4 — Roadmap (Betterment-7 → 10)

Sequenced so every phase ships something playable, and the perf work lands *before* the game spends the budget.

### B7 — Foundation + First Playable (SCRAMBLE-lite) — ~1 week-equivalent
- P1–P3, P7 perf fixes (label pooling, material pool, label-scale early-exit, debug overlay)
- `gameMode.js` FSM + `atc.js` text-only radio via alert queue + message log panel
- UFO entity layer (static orbiting saucer, no weapons) + `typing.js` modal
- **Playable:** ATC names an airspace → warp/fly there → type to banish → score. The typing tutor works end-to-end.
- O1 start screen with Play button (even if Explore/Tour buttons just dismiss).

### B8 — SCRAMBLE complete + Sound — ~1 week-equivalent
- `audio.js`: speech-synthesis ATC voice, radio chirps, alert tones, engine loop, stall horn (R1, R2 buffet)
- Waves, difficulty tiers, combo scoring, debrief card, `kuson.game.v1` persistence
- O3 60-second tutorial + O2 progressive HUD + O5 quick chips
- V4 airspace fresnel glow (doubles as shield visual)

### B9 — INTERCEPT — ~1.5 week-equivalent
- `weapons.js` hitscan + tracers + sparks; UFO EVADE/ATTACK behaviors; ground crawlers vs airport beacons
- Combined mode (identify-then-engage ROE)
- P4–P5 (airspace culling, trail buffers) to hold 60 fps with 20+ entities
- V5 shadow blobs (targets need grounding)

### B10 — The World Gets Beautiful — ~2 week-equivalent
- V1 terrain relief from the existing DEM (do this *after* INTERCEPT so strafing runs immediately benefit)
- V2 day/night + city lights (night intercept missions!), V3 water, V7 optional bloom
- R3 wind-by-altitude + crosswind HUD, R4 G-limits, R6 live-traffic smoothing
- V6 runways; missile lock-on; daily challenge

Defer: O6 mobile touch controls, V8 weather, recorded VO, multiplayer leaderboards.

---

# PART 5 — Risks & guardrails

1. **Frame budget.** 20 UFOs + tracers + typing UI on top of 150 live flights and 144 airspaces will exceed budget unless P1–P5 land first. The roadmap orders them deliberately; the P7 overlay is the tripwire.
2. **Input collision.** Typing mode *must* hard-suspend flight keys (W/A/S/D/I/K all collide). Use the same input-suppression flag the tour/fly-to already asserts — verified to exist in the drone input path.
3. **speechSynthesis quirks.** Voices load async and differ per browser; always render the radio text in the log so voice is enhancement, not dependency.
4. **Scope discipline** (per operator guide): each Betterment keeps the one-task/one-commit/journal cadence; the game layer lives entirely under `src/game/` + `audio.js` so the educational core stays untouched and the game is one toggle away from off.
5. **Tone.** Keep the fiction clearly fantastical (UFOs, not real-world adversaries) — the sim carries real CAAT data and a real-military color taxonomy; saucers keep it unambiguously a game.

---

# Appendix A — Key citations index

- Renderer/lighting/fog: [main.js:158–185, 472–476, 581–582](src/main.js)
- Flat terrain plane (replace): [main.js:509–520](src/main.js)
- DEM sampling (exploit): [terrain.js:1–80](src/terrain.js)
- Airspace data/query/vantage: [airspace.js:463–1017, 709–719, 859–902](src/airspace.js); record schema: [data/airspaces.json](data/airspaces.json)
- Label cost centers: [airspace.js:303–324](src/airspace.js), [liveFlights.js:855–908](src/liveFlights.js)
- Physics (stall/G/spool): [physics.js:33–180](src/physics.js)
- Wind (altitude-blind): [wind.js:60–80](src/wind.js)
- Entity lifecycle blueprint: [liveFlights.js](src/liveFlights.js) (PROMOTE_RANK=20, MAX_RENDERED=150, DESPAWN_POLLS=3)
- Fly-to autopilot: [flyto.js:15–72](src/flyto.js)
- Identify raycast: [identify.js:54–110](src/identify.js)
- Alert bus: [alerts.js:15–99](src/alerts.js), renderer [ui.js:442–526](src/ui.js)
- Tour engine: [tourGuide.js:44–151](src/tourGuide.js)
- Onboarding chrome: index.html:723–880 (loading, HUD, panel, hints, mobile stop)
- Persistence patterns: [simState.js:9–35](src/simState.js), [input.js:19–48](src/input.js)

*Report generated 2026-06-11. Audit basis: branch `betterment2-20260529` @ `ef85784`.*
