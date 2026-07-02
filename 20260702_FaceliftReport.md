# Facelift Report — UI customization, mode grouping, graphics & clutter (Betterment-11 planning)

**Date:** 2026-07-02 · **Operator:** Fable 5 (review session)
**Companion:** `20260702_FaceliftPlaybook.md` (execution contracts, model routing) — same-named pair per house convention.
**Method:** three parallel code audits (UI architecture · mode system · graphics/clutter, all findings file:line-cited) + a live-browser survey on the dev server (10 staged screenshots: start screen, ground-level explore, in-volume interiors ×3, clean-world vista, night, SCRAMBLE briefing, mid-wave, tour, exterior label field).
**Scope asked:** (1) a way to easily show/hide and reskin the flying interface, (2) UI grouping that fits the three modes (Game / Learning / FreeStyle — all already implemented), (3) make the graphics look even better, (4) manage 3D view clutter.

---

## Part 1 — Current state (evidence)

### 1.1 What the product already has (good bones)

- **Three-mode entry exists and is clean.** The start screen (`src/startScreen.js`) routes 1/2/3 → Explore / Tour / Play — exactly the FreeStyle / Learning / Game trio. The B8 progressive HUD (`kuson.hud.v1 {pro}`) proves the "profile of visible elements" concept already works in miniature.
- **A real settings culture.** 8 persistence keys (`kuson.hud.v1`, `kuson.grounddetail.v1`, `kuson.airspacegroups.v1`, `kuson.inputSettings.v1`, `kuson.audio.v1`, `kuson.start.v1`, plus panel-collapse keys). `src/groundSettings.js` get/set-patch pattern is the house template.
- **Partial theming substrate.** `index.html` `:root` already defines 11 CSS custom properties (`--bg --panel --panel-border --text --muted --accent --warn --danger --ok --shadow --mono/--sans`). DOM panels are ~80% themable today.
- **Declutter precedents.** B5 functional group toggles (airspace.js ~274–326, radar parity, persisted), B6 orientation layers, B7 label texture pooling, live-flights K20 LOD with hysteresis + 150 cap (liveFlights.js), province-name topN filter.
- **The exterior "colored cages" view** — volumes seen from outside/above — is genuinely striking and is the product's hero image. The bones are good; the problems below are about when/where those bones are hidden.

### 1.2 UI: visibility is scattered, keyboard-only, half-persisted

Full element inventory is in the playbook §0.5.1 registry table. The structural findings:

| Finding | Evidence |
|---|---|
| **No single place controls visibility.** | Toggles live in: keyboard shortcuts (J/H/M/T/C/K/`/P), radar floater checkboxes, panel checkboxes, the pro/minimal chip, and several elements with **no toggle at all** (alert banner, crosshair badge, quick-warp chips, controls hint pinned line). |
| **Keyboard-only = undiscoverable.** | Alt tape (J), attitude ball (H), map-primary (M), panel (T), controls hint (C) have no visible affordance unless the user opens the `?` legend. |
| **Persistence is inconsistent.** | HUD pro-mode, history collapse, airspace groups, ground detail persist; alt tape, attitude, map-primary, panel collapse, radar options do **not** — user loses layout every reload. |
| **The radar floater checkboxes** (Map underlay / Center aircraft / FOV cone / Live flights) sit as permanent furniture **on top of the 3D view** above the minimap. | Screenshot: every staged shot shows them; index.html `#radarOptions`. |

### 1.3 Reskin: ~80% ready, three hard blockers

1. **Canvas-drawn widgets hardcode colors.** Heading compass, altitude tape, attitude indicator paint literal `rgba(102,255,204,…)` / `rgba(255,64,64,…)` etc. inside `ui.js` draw functions (~1366–1568). A CSS-var theme will not touch them — the HUD would reskin except its most prominent instruments.
2. **Inline JS colors.** Branch ID colors (RTAF `#19c9c1`, RTN `#2b4cd8`, RTA `#33a83a`) are injected as `style="color:…"` (ui.js ~1258, 1267); debug overlay (debugOverlay.js ~21) and the tour progress gradient (index.html ~834) also bypass vars.
3. **`--accent` duplicated as literals** in several places (e.g. ui.js ~1430 altitude-tape accent `#66ffcc`).

Conclusion: a **token layer** (CSS vars extended + a JS-readable palette object for canvas draws) makes the whole flying interface reskinnable with data-only theme definitions. The repo's fixed convention — dark monospace HUD aesthetic — stays; themes are palette variants (classic teal, daylight high-contrast, NVG green, retro amber), not redesigns.

### 1.4 Modes: the FSM is sound; the UI ignores it

- **Mode model:** `gameMode.js` FSM (IDLE → BRIEFING → WAVE → DEBRIEF; abort → IDLE) is the game's single source of truth. Tour is an **orthogonal flag** (`tourGuide.running`); tutorial hands through BRIEFING→IDLE; FreeStyle is "IDLE and nothing running" — there is **no unified app-mode object** and no `onState` event hook to subscribe UI to.
- **What changes today on transitions:** briefing/debrief cards, wave HUD strip, typing modal, tour overlay + `flightLocked`, tutorial rings. Exit restoration is 85–95% clean (audit rated per mode) — but **only game-owned UI** is touched. The entire explore interface stays up.

**Observed mid-wave (screenshot):** educational panel fully interactive (Express tour one click away), display options togglable, flight history (with undo!) open, radar floaters live, TARGET strip stacking on top of the red advisory banner. Concrete conflicts confirmed in code:

| Conflict | Severity |
|---|---|
| Quick-warp chips + airspace-list warps clickable during WAVE — breaks wave/scoring | **HIGH** |
| `Ctrl+Z/Y` flight undo fires mid-wave | **HIGH** |
| Educational panel + history visible during combat (distraction, misclicks) | MED |
| `tourGuide.start()` has no `game.state` guard (tour during wave possible) | MED |
| U/M and I/V toggles fire during WAVE/BRIEFING | LOW-MED |
| No unified Escape policy (each overlay listens separately) | LOW |

**Learning mode is under-served too:** the tour enables 3D labels and locks flight — good — but the panel's game chips, traffic sections, and settings noise all remain; the tour card competes with the alert banner and district label for the bottom-center band.

### 1.5 Graphics pipeline: solid base, nothing above "correct"

- Renderer (`main.js` ~69–77): antialias on, pixelRatio ≤2, logarithmicDepthBuffer (600 km far plane), sRGB out, **NeutralToneMapping @ 0.7**, `sortObjects` for the translucent volumes. **No shadows, no postprocessing** (no composer anywhere). three.js **pinned 0.170.0**, vendored under `lib/`, importmap, zero build step.
- Lighting: 1 hemisphere + 1 directional (~122–125), tinted by `daynight.js`; tiles/volumes are MeshBasic (unlit **by doctrine** — claude.md §3); aircraft are Lambert.
- Sky: Preetham dome + altitude fade; fog color/near/far lerped by time-of-day; sun sprite.
- City lights: **one THREE.Points, one point per city/airport** (25+~14), additive, `depthTest:false`, opacity = nightFactor.
- Water shimmer (fragment inject), terrain displacement (CPU at tile build, 24 segs), detail tiles anisotropy 8 (**base tiles: none**).
- Perf: ~**2 ms/frame on Apple M1 (~946 fps)** — enormous headroom for quality work.

### 1.6 What the world actually looks like (live survey)

Numbered observations from the staged screenshots — these drive the design:

- **V1 — Interior wash is the #1 problem.** Inside Bangkok CTR/TMA the entire viewport is flat purple with hatching; inside Chiang Mai TMA, green; inside VTD18, orange. Over central Thailand you are **almost always inside something**, so the B10 "world beauty" work is hidden behind a colored film most of the time. Only exterior views look good.
- **V2 — Terrain reads flat.** At 2 600 m near Chiang Mai with relief ON, the massif is barely perceptible: displacement exists but tiles have no shading response (only the z11 basemap's faint baked hillshade). Horizon is a milky wash; sky pale.
- **V3 — Night city = 2–3 giant amber domes.** One glow sprite per city, near-camera it inflates into a huge fuzzy hemisphere. No light carpet, no texture. Night sky is an empty black void — no stars, no moon.
- **V4 — Label field overlaps.** With 3D labels on, dark label bars stack and collide along the horizon band; no collision or distance policy (visible from any range).
- **V5 — Banner fatigue.** The red ADVISORY/AUTHORISATION banner is up essentially permanently in normal explore flight over Bangkok, and stacks under the game TARGET strip mid-wave.
- **V6 — Right panel monolith.** Tour + display options + sound + controls + altitude limits + live flights + radio log in one always-expanded scroll, ~28% of screen width; attribution text collides with its bottom edge at some viewport sizes.
- **V7 — HUD chip growth.** Stacked volumes produce 5+ airspace chips in the HUD (Bangkok CTR · VTR2 · VTR82 · VTR83 · TMA).
- **V8 — Radar floaters** permanently occlude the lower-left 3D view (see 1.2).
- **V9 — Geofence freeze works** (teleport into VTD47/VTD18 froze at boundary with banner) — good; noted as regression-sensitive behavior for the clutter work.

### 1.7 Bugs noticed in passing (log-only here; fixed as B11.T14)

- **District label goes stale on teleport/fly-to** (showed "Phra Nakhon District" over Chiang Mai and "Mae Rim District" over Bangkok; updates only on its movement trigger).
- **Time-of-day select ↔ engine desync** observed once: programmatic `daynight.setMode('night')` leaves the dropdown on "Day"; after reload the dropdown read "Night" while the scene rendered day for a period. Needs root-cause during T14.
- **Attribution/panel collision** (V6).
- **Banner/game-strip stacking** offset (V5) — alerts renderer doesn't account for the game strip height.

---

## Part 2 — Gap analysis vs. the four asks

| Ask | Gap |
|---|---|
| **Show/hide everything, easily** | No visibility registry; ~40% of elements have no toggle; toggles that exist are scattered and half-persisted; nothing is discoverable in one place. |
| **Reskin the flying interface** | Token substrate 80% there (CSS vars) but canvas widgets + inline JS colors are hardcoded; no theme object, no picker, no persistence. |
| **UI grouped per mode** | No app-mode source of truth, no mode→UI profile mapping, no input scoping per mode, six concrete cross-mode conflicts (1.4), no exact-restore of UI state around modes. |
| **Better graphics** | No postprocessing (bloom), blob city lights, empty night sky, unshaded terrain, base-tile anisotropy off, atmosphere gradient untuned. All cheap given 2 ms frames. |
| **3D clutter** | No interior-fill policy (V1), no altitude/distance fade laws, no label collision handling, no focus mode, no per-layer opacity. Group toggles exist but are binary and manual. |

---

## Part 3 — Design (locked; contracts in the playbook)

**D1 — UI preferences registry** (`src/uiPrefs.js`). One declarative registry of every hideable interface element (id → selector/apply-fn, group, default, key binding, persist flag). Single storage key `kuson.uiprefs.v1` storing **sparse overrides only** (defaults stay forward-compatible). All existing shortcuts route through it. This is the substrate for D2–D4.

**D2 — View panel + reskin.** A "VIEW" section at the top of the right panel: grouped checkboxes for every registry element (FLIGHT / NAV / INFO / ALERTS / HELP), key hints shown inline, reset-to-defaults, and a **theme picker**. Theme system: extend `:root` tokens to cover 100% of UI color; `src/theme.js` defines 4 data-only themes (Classic teal = default & pixel-identical, Daylight high-contrast, NVG green, Retro amber); canvas widgets read a live palette object; branch/debug/tour colors migrate to tokens. Radar floater checkboxes fold into a ⚙ popover on the radar (declutters the viewport).

**D3 — Panel information architecture.** Move-only restructure of the monolith into collapsible groups with persisted state: TOUR · VIEW · WORLD (display options) · TRAFFIC (live flights + radio log) · FLIGHT (input, limits) · INFO (rules, legend, history). Fresh profile: TOUR + WORLD expanded, rest collapsed. Disclaimer/attribution moves to an always-visible fixed footer strip (non-negotiable text untouched).

**D4 — App-mode manager + per-mode UI profiles.** `src/appMode.js`: freestyle | learning | game(briefing/wave/debrief), wired to startScreen routing, a new minimal `gameMode.onState` hook, tour start/stop, tutorial. Per-mode **profiles** apply declarative show/hide sets *over* user prefs with **snapshot-and-exact-restore** on exit (B5 pattern). Defaults: GAME-WAVE hides panel (except radio log), warp chips, history, identify, radar floaters — shows game strip + ATC; LEARNING hides game/traffic noise, shows tour card + labels; FREESTYLE = pure user prefs. Users can edit per-mode overrides via mode tabs in the View section. Input scoping: central guard blocks U/M/Ctrl+Z/Y/I/V/warp during WAVE, guards tour↔game overlap, unified Escape ladder.

**D5 — Interior-fill law (the single biggest view win).** When the camera is inside a volume (the containment set already computed for HUD chips), fade that volume's fill to ~15% of base opacity (rim/fresnel + outline stay full) with ~2 s hysteresis. The world stays readable inside CTRs; the "cage" reads from its edges. Toggleable, default ON; OFF = today's behavior.

**D6 — Declutter laws** (`src/declutter.js`, one tunable policy module, ≤4 Hz): distance-fade for province names, beacons, airspace labels (keep nearest N, fade rest), ring opacity by altitude, district label hidden above threshold; **Focus mode** (F): dim everything except the containing + target volume. All laws sit *under* the existing group toggles; master "Declutter" checkbox, default ON.

**D7 — Graphics quality pack.**
- **Postprocessing bloom** (vendored jsm @0.170.0: EffectComposer/RenderPass/UnrealBloomPass/OutputPass) behind an "Enhanced graphics" toggle — tuned so **day is visually unchanged** and night city lights/tracers/beacons/fresnel rims glow. Composer×logarithmic-depth×additive-points interplay is the risk item → routed to Fable (B10's city-light depth saga informs this).
- **Night sky pack:** ~1200-star Points dome (night-gated, logdepth chunks per §0.3 lesson), moon sprite; **city-light constellations** replacing blob-domes: deterministic per-city scatter clusters (30–220 points by population weight, small sizes, warm hue jitter) generated to `data/cityLightPoints.json` by a committed script.
- **Terrain shading:** hillshade baked into detail-tile **vertex colors** at displacement time (normals from the elevation grid, fixed NW-high sun; MeshBasic + vertexColors keeps the unlit doctrine intact), continuous across tile edges; base-tile anisotropy 8; horizon haze/dusk fog gradient tune.
- spec.md gains §3.19 so the spec-first doctrine is honored.

**Constraints (binding):** no build step; three.js stays 0.170.0 (jsm vendored from the same tag); dark-monospace identity fixed (themes are palettes); defaults-off = pixel-identical to pre-B11 (except §1.7 bug fixes); disclaimer untouched; frame budget ≤4 ms on M1 with everything ON (2× today, half the 120 Hz budget); exact-restore doctrine for anything a mode touches.

---

## Part 4 — Priorities and expected effect

| Rank | Item | Why |
|---|---|---|
| 1 | D5 interior-fill law | Transforms the default flying experience everywhere over central Thailand (V1). Tiny code. |
| 2 | D1+D2 registry, View panel, themes | Directly the user ask; unlocks D4; makes every later layer user-controllable. |
| 3 | D4 mode profiles + input scoping | Fixes two HIGH conflicts; each mode finally *feels* dedicated. |
| 4 | D7 night pack + terrain shading | Biggest visible beauty jump per effort (V2, V3). |
| 5 | D6 declutter laws + focus | Compounds with D5; makes labels/beacons scale with context (V4). |
| 6 | D3 panel IA | Quality-of-life; halves persistent screen noise (V6). |
| 7 | D7 bloom composer | The "wow" layer; gated + riskiest, so it lands late with its own checkpoint. |

Execution order in the playbook is dependency-driven (registry → panel/theme → modes → clutter → graphics → docs), 16 tasks, 4 browser checkpoints, model routing Fable/Sonnet/Haiku per task. See `20260702_FaceliftPlaybook.md`.
