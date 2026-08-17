---
id: 20260702_FaceliftPlaybook
title: Facelift Playbook — Betterment-11 (UI customization · mode grouping · graphics · declutter)
class: spec
version: 1.0.0
status: active
updated: 2026-07-02
owner: kuson
applies_to: []
supersedes: []
superseded_by: []
---
# Facelift Playbook — Betterment-11 (UI customization · mode grouping · graphics · declutter)

**Companion to:** `20260702_FaceliftReport.md` (evidence + locked design), `spec.md` (§3.19 to be written in B11.T15), `journal.md`, `claude.md` (operator guide).
**Audience:** executor subagent sessions implementing tasks, orchestrated by a Fable 5 main session.
**Status:** design locked (report Part 3), **implementation pending**.
**Branch:** `betterment11-20260702` — created per B11.T0 reconciliation policy below.

This playbook is **stop-and-resume safe**: every task ends at an atomic commit; any fresh session resumes from `journal.md` (last block) + `state_TODO.md` (first unchecked B11 row) + this file's matching task.

---

## 0. Operator protocol (read every session start)

Follow the canonical protocol in `claude.md §1` and `20260528_BettermentPlaybook.md §0` (session open/close, atomic conventional commits). The global regression checklist (`20260528_BettermentPlaybook.md §0.5.2`) applies at every checkpoint.

**Serve & verify:** `python3 scripts/devserver.py 8080` (or `python3 -m http.server 8080`) from repo root → `http://localhost:8080`. Per touched file: `node --check src/<file>.js`. Per checkpoint: browser console clean + the smoke list for that checkpoint.

**Hard rule — defaults-off = pixel-identical:** with every new toggle at its legacy value (`Classic` theme, declutter OFF, interior fade OFF, enhanced graphics OFF, terrain shading OFF, all registry entries at defaults, no mode entered), the sim must render and behave **identically to pre-B11** — except the four §0.4 bug fixes, which are individually listed and verified. Capture baseline screenshots at T0; diff at each checkpoint.

**Scope discipline:** one task per dispatch. No refactors, no docstrings on untouched code, no extra features. Tempting improvements → new row in `state_TODO.md §3`.

### 0.1 Model orchestration protocol

| Role | Model | Duties |
|---|---|---|
| **Orchestrator** (main session) | **Fable 5** | Dispatch one executor per task with the task's contract pasted verbatim + the §0.5 design-note subsections it cites; review every diff before the next dispatch; run browser verification at checkpoints C1–C4; implement **B11.T11 inline** (pre-routed); design-review B11.T4 before its commit; write journal blocks; own all git operations at phase boundaries. |
| **Executor** (per-task subagent) | **Sonnet 4.6** (default) | Implement exactly the task contract; `node --check` every touched file; self-verify the task Pass criterion where it doesn't need a browser; commit with the specified message. |
| **Mechanical executor** | **Haiku 4.5** (only where a task is marked `model: haiku-ok`) | Only for mechanical, fully-specified text work (B11.T15 journal/TODO/README subtasks; T12's data-file regeneration run). Orchestrator reviews haiku diffs line-by-line; **any judgment call or logic → re-dispatch to Sonnet.** |
| **Escalation** | Fable 5 | A task failing its Pass criterion **twice** under Sonnet is implemented inline by the orchestrator. Pre-flagged risks: **T3** (canvas palette hooks), **T7** (input suppression — B7.T7 precedent), **T8** (per-volume material state), **T13** (tile-pipeline touch). **T11 is Fable-inline from the start.** |

Rules (unchanged from B7–B10, they paid for themselves):
- Executors never start the dev server or do browser verification — that is orchestrator work at checkpoints.
- Executors receive: this file's §0 + §0.5 subsections cited by their task + their single task section + the cited source lines. Not the whole report.
- Haiku is **never** routed frame-loop, input, shader, or persistence-shape code (B7 §0.1 rule stands; the `haiku-ok` marks above are the only exceptions).
- Sequential execution T0→T15. `ui.js`, `index.html`, `main.js` are shared touch-points — no parallel dispatch without worktree isolation. (If the orchestrator wants wall-clock back, the only safe pair is T12∥T13 in worktrees: disjoint files — merge T12 first.)

### 0.2 Checkpoints (orchestrator browser smoke)

- **C1** after **T4** — UI core (registry + View panel + themes + panel IA). Defaults-parity screenshot diff; every panel control walked once; theme cycle ×4 with canvas widgets verified recolored; reload persistence pass.
- **C2** after **T7** — mode grouping. Scripted mode walk (explore → tour → end → briefing → wave → abort → debrief path → explore); per-mode UI matrix asserted via `__sim.uiPrefs.snapshot()`; input-storm test in each mode; exact-restore verified (snapshot equality pre/post mode).
- **C3** after **T10** — clutter. Interior-fade in/out over Bangkok CTR (screenshot pair); staged-altitude declutter asserts (500 m / 3 km / 8 km); focus mode on/off; declutter-OFF parity diff.
- **C4** after **T14** — graphics + regression. Day-parity diff with composer ON; night showcase screenshots (light carpet + stars + moon + bloom); frame time ≤ 4 ms on M1 with everything ON (record `~` overlay numbers in journal); §0.4 bug repros re-run; **full global regression** (§0.5.2 list + B5/B6/B7/B8/B9/B10 smoke lists). Then T15 docs.

### 0.3 Verification-harness notes (binding — lessons paid for in B7–B10)

- Preview tab is backgrounded between tool calls: **rAF suspended, `setTimeout` clamped ≥ 1 s**. Drive the sim via `__sim` handles; flush promises with chained `Promise.resolve()`; `preview_screenshot` wakes the tab for real frames.
- **Dismiss the start screen before any keyboard-driven test** — its capture listener swallows all keys while visible.
- Console buffer **persists across reloads** — judge by entry-count deltas.
- **Any new/modified shader (T8, T11, T12, T13) must include `logdepthbuf` chunks** (`#include <logdepthbuf_pars_vertex>` etc.) — the renderer runs `logarithmicDepthBuffer: true`; omitting them renders zero pixels (B10 city-lights post-mortem, commits `03bd1b7`/`2e04555`).
- Additive point layers follow the city-lights recipe: `transparent, depthWrite:false, depthTest:false, AdditiveBlending` — depthTest **false** because detail tiles carry polygonOffset.
- Point-raster visuals can silently fail under SwiftShader — composed-scene visual claims need the real-hardware session at checkpoints; instrument-level asserts (`renderer.info`, forced overdraw counts) are the in-harness evidence.
- Executor deaths mid-task happened 4× in B8–B10: a truncated report ⇒ run `git status` immediately, finish the remainder inline, note in journal.
- Time-of-day for staged shots: drive via the **select element + change event** (not `daynight.setMode` directly) so UI and engine stay in sync (§0.4-b is fixing the raw-call path).

### 0.4 Bug fixes riding along (from report §1.7 — fixed in B11.T14, verified individually at C4)

- (a) District label stale after teleport/fly-to arrival.
- (b) Time-of-day select ↔ engine state can desync (programmatic `setMode` doesn't update the select; reload once showed select=Night with a day scene — root-cause during fix).
- (c) Attribution footer collides with the panel (resolved structurally by T4's fixed footer; T14 verifies).
- (d) Alert banner and game TARGET strip overlap top-center during waves (alerts offset must account for the strip).

### 0.5 Binding design notes (orchestrator-authored — executors implement these, not their own designs)

#### 0.5.1 UI element registry (T1) — the canonical id list

`src/uiPrefs.js` exports `UI_ELEMENTS`: `{ id, label, group, sel | apply(visible), key?, default: true|false }`. Groups and ids (defaults all `true` unless noted):

| Group | ids |
|---|---|
| FLIGHT | `hudPanel`, `hudExtras` (the pro-mode extra rows — bridges `kuson.hud.v1`), `altTape` (key J), `attitude` (key H), `crosshair`, `simSpeed` |
| NAV | `minimap`, `radarOptions` (default **false** after T2 folds them into the ⚙ popover), `rangeRingsUi` *(3D layer stays in grounddetail)* |
| INFO | `panel` (key T), `quickWarpChips`, `flightHistory`, `identifyCard`, `liveFlightsSection`, `radioLog` |
| ALERTS | `alertBanner`, `alertChips` *(hideable but styled with a ⚠ row in the View panel; default true)* |
| HELP | `controlsHint` (key C), `districtLabel`, `debugOverlay` (key backquote, default false) |

Semantics: `getPrefs()` merges `kuson.uiprefs.v1` **sparse overrides** over defaults (`{global:{id:bool}, modes:{game:{…}, learning:{…}, freestyle:{…}}}` — `modes` filled by T6). `set(id, visible, {mode})` patches + persists + applies + emits. `apply()` sets/clears the `uiHidden` CSS class (`.uiHidden{display:none !important}` added once in index.html) or calls the element's `apply` fn (canvas widgets reuse their existing show/hide functions). Existing keyboard toggles (J/H/T/C/backquote) are rewired to call `uiPrefs.toggle(id)` so state never forks. Expose `__sim.uiPrefs` with `snapshot()` returning the effective visibility map (harness API).

#### 0.5.2 Theme tokens (T3)

- Extend `:root` with the missing tokens: `--accent2`, `--hud-bg`, `--chip-bg`, `--grid`, plus `--cv-accent`, `--cv-accent-dim`, `--cv-mute`, `--cv-marks`, `--cv-danger`, `--branch-rtaf`, `--branch-rtn`, `--branch-rta`.
- `src/theme.js`: `THEMES = { classic, daylight, nvg, amber }`; each = `{ label, vars: {…every token…}, canvas: { accent, accentDim, mute, marks, danger }, branch: { RTAF, RTN, RTA } }`. **`classic` must reproduce today's exact values** (copy them out, don't eyeball). `applyTheme(name)`: sets vars on `document.documentElement`, stores the palette on `theme.current`, persists `kuson.theme.v1`. Canvas draw functions (`drawHeadingCompass`, `drawAltitudeTape`, `drawAttitudeIndicator`, minimap accents) read `theme.current.canvas.*` instead of literals — they already redraw per frame, so no invalidation plumbing.
- Palette directions (orchestrator will fine-tune live at C1): `daylight` = light panel `rgba(240,244,248,.92)`, text `#10161e`, accent `#0b7f6a`; `nvg` = near-black `#050a05`, text/accent phosphor `#39ff5c`/`#9dffb0`, danger `#ffd23f`; `amber` = `#0d0800` bg, `#ffb000` accent family. All four keep `--danger` ≥ 4.5:1 contrast against `--panel`.
- Migrate the three inline-color sites (branch colors ui.js ~1258/1267 → `var(--branch-*)` spans; debugOverlay.js ~21 → vars; tour progress gradient index.html ~834 → vars).

#### 0.5.3 Mode profiles (T5/T6)

- `src/appMode.js`: `mode` ∈ `freestyle | learning | game`; `detail` ∈ `null | briefing | wave | debrief | tutorial`. Sources: startScreen callbacks; a minimal hook added in gameMode.js (`onState(cb)` invoked at every `_setState` — additive, no behavior change); `tourGuide` start/stop; tutorial start/finish/abort. Emits `change(prev, next)`; exposes `__sim.appMode`. Guards: `tourGuide.start()` refused unless game IDLE (returns false + alert chip "End the mission first"); game `begin` refused while tour running (chip "End the tour first").
- `src/uiProfiles.js`: `PROFILES = { learning: {...}, game_briefing: {...}, game_wave: {...}, game_debrief: {...} }`, each `{ hide:[ids], show:[ids], layers:{ labels?:bool, dangerGroups?:bool } }`. Defaults: **game_wave** hides `panel, quickWarpChips, flightHistory, identifyCard, radarOptions, controlsHint, simSpeed, districtLabel`, shows `radioLog` (floating mini-log variant is out of scope — the panel section simply stays reachable in debrief); **game_briefing/debrief** hide `quickWarpChips, flightHistory` only; **learning** hides `quickWarpChips, liveFlightsSection, radioLog, flightHistory, simSpeed`, sets `layers.labels = true` (formalizing what the tour already does).
- Apply algorithm (the B5 exact-restore pattern): on mode entry, snapshot the **effective** visibility map; apply profile (mode-scoped user overrides from `kuson.uiprefs.v1.modes[mode]` win over the profile); on exit, restore the snapshot verbatim. A manual toggle mid-mode edits the session state only, unless the user flips it inside the View panel's mode tab (which persists to `modes[mode]`).
- View panel grows tabs `[Auto | Freestyle | Learning | Game]` — Auto shows/edits global; the rest edit `modes[…]` overrides (T6).

#### 0.5.4 Input scoping (T7)

Single guard function `inputAllowed(action)` consulted by the existing handlers (do **not** rewrite the handlers): actions `layerToggles(U/M), historyUndo(Ctrl+Z/Y), identify(I/V), warp, viewToggles(J/H/K), pause(P)`. Matrix: WAVE blocks `layerToggles, historyUndo, identify, warp`; BRIEFING/DEBRIEF block `historyUndo, warp, identify`; typing-modal-open blocks everything except the modal (already mostly true — verify); learning blocks `warp, identify` while flight is locked; freestyle blocks nothing. Escape ladder (one keydown listener at capture phase, replacing the per-overlay scatter *only for Escape*): typing modal → challenge abort; wave → abort-confirm card; briefing/debrief → close; tour → End-tour confirm; else noop.

#### 0.5.5 Interior-fill law (T8)

Per volume in the already-computed containing set (the HUD-chip source): target `fillOpacityFactor = 0.15` (walls **and** floors; keep resulting opacity ≥ 0.03), outline + fresnel rim unchanged (rim carries the "cage" read). Ease factor toward target over 1.5 s in, 2.5 s out (per-volume scalar lerped in the existing per-frame airspace pass; no material recompile — opacity is a material prop, but **materials are pooled**, so implement via per-volume `material.clone()` on first fade *or* a per-instance opacity attribute — decide by measuring program/material counts with the `~` overlay; document choice in the commit body). Display option "Interior fade" in WORLD section, persisted in `kuson.grounddetail.v1.interiorFade`, **default ON** (this is the rare default-changing feature — §0's parity rule therefore tests OFF-state parity, and C3 signs off the new default visually). Highlighted (identify/tour) volumes are exempt while highlighted.

#### 0.5.6 Declutter laws (T9/T10)

`src/declutter.js`, one `update(camera, dt)` throttled to 4 Hz, all constants in a `LAWS` table at the top:

| Layer | Law |
|---|---|
| Province names | opacity 1→0 over camera-distance 60→90 km; also 0 when AGL > 6 km |
| Airport beacons + names | fade 80→120 km |
| Airspace labels | keep nearest **12** at full, fade others to 0.25; all fade to 0 beyond 150 km |
| Range rings | ×0.5 opacity above 5 km AGL |
| District label | hidden above 8 km AGL (registry-respecting) |
| Live-flight labels | existing K25 data-line rule; add fade 60→100 km for callsign-only sprites |

Master checkbox "Declutter" (WORLD section, `kuson.grounddetail.v1.declutter`, default ON — OFF restores today's always-on behavior; parity rule as in §0.5.5). Laws multiply *under* group toggles — a toggled-off layer stays off. **Focus mode (T10):** key F + View row; while active: volumes not in {containing set ∪ current fly-to/tour/game target} drop to fill 0.05/outline 0.3; labels only for the kept set; HUD chip of the target pulses (CSS class); auto-exits on mode change; state never persisted.

#### 0.5.7 Graphics pack (T11–T13)

- **T11 composer (Fable-inline):** vendor from three **r170** tag into `lib/postprocessing/` + `lib/shaders/`: `EffectComposer, RenderPass, ShaderPass, OutputPass, UnrealBloomPass, LuminosityHighPassShader, CopyShader` (+ their internal imports; add importmap entries). Pipeline: `RenderPass → UnrealBloomPass(strength .35, radius .4, threshold .85) → OutputPass`. Gate: "Enhanced graphics" checkbox (WORLD), `kuson.gfx.v1 {composer:true}` default **ON**, auto-disable on any composer construction error (try/catch → legacy path + console.warn once). OFF ⇒ exact legacy `renderer.render` call. Known trades Fable must measure at C4: composer bypasses canvas MSAA (evaluate: pixelRatio 2 is the de-facto AA here; if edges degrade, add vendored `SMAAPass` behind the same flag); tone mapping moves to OutputPass — verify NeutralToneMapping/exposure 0.7 survive; logdepth + additive points through render targets = the B10 risk zone, assert city-lights pixels via the bare-scene probe before/after.
- **T12 night sky + city constellations:** (i) `scripts/gen_city_lights.py` — reads `data/cities.json` (+ airports), emits `data/cityLightPoints.json`: per city `N = clamp(round(30 + weight*190), 30, 220)` points, gaussian scatter `σ = 1.2–6 km` by city size, per-point warm hue jitter ±8%, size 2–7 px, **fixed seed 20260702** (deterministic re-runs); airports stay single brighter points. (ii) `cityLights.js` consumes the JSON (one Points, aSize/aColor attributes — same material recipe, sizes small enough that near-camera domes cannot recur; cap point size 24 px). (iii) `src/nightSky.js`: ~1200-star Points on a 550 km dome (inside far plane), seeded PRNG, additive, `opacity = nightFactor`, hidden when `nightFactor < 0.05`; moon = existing sun-sprite recipe (128px canvas radial), positioned opposite the sun azimuth at 45° elevation, opacity `0.85 × nightFactor`. All three shaders carry logdepth chunks (§0.3).
- **T13 terrain shading + atmosphere:** during detail-tile displacement build (ground.js — the elevation-sampling loop), compute per-vertex normal from the **elevation grid** (central differences on grid neighbors — not tile-local mesh — so shading is seam-continuous), `shade = clamp(0.75 + 0.4 * dot(n, SUN_NW), 0.75, 1.15)` with `SUN_NW = normalize(-0.5, 0.8, -0.5)`; write `shade` into tile vertex colors; set `vertexColors: true` on tile materials **only when the toggle is on** (material pool key gains a flag). Base tiles get `anisotropy = 8` (parity with detail, ground.js ~224). Atmosphere: dusk fog color warm-shift already exists — tune per C4 eyeballing only if free; do not expand scope. Toggle "Terrain shading" (WORLD, `kuson.grounddetail.v1.terrainShade`, default ON; OFF ⇒ byte-identical tile build path — branch around the entire computation).

---

## Phase Betterment-11 — Facelift

**Goal (Pass Criterion for the phase):** From a fresh load: each of the three modes presents only its relevant interface and restores the user's layout exactly on exit; every HUD/panel element can be shown/hidden from one View panel (persisted); four selectable themes reskin the entire flying interface including canvas instruments; flying inside controlled airspace keeps the world readable (interior fade); night over Bangkok shows a carpet of city lights under stars, a moon, and gated bloom; mountains read as 3D from altitude; label/beacon density scales with range and altitude — all with defaults-off pixel-parity to pre-B11 and ≤ 4 ms/frame on the M1 (baseline 2 ms).

**New persistence keys:** `kuson.uiprefs.v1`, `kuson.theme.v1`, `kuson.panel.v1`, `kuson.gfx.v1`; `kuson.grounddetail.v1` gains `{interiorFade, declutter, terrainShade}`.
**New files:** `src/uiPrefs.js`, `src/theme.js`, `src/appMode.js`, `src/uiProfiles.js`, `src/declutter.js`, `src/nightSky.js`, `lib/postprocessing/*`, `lib/shaders/*`, `scripts/gen_city_lights.py`, `data/cityLightPoints.json`.

### B11.T0 — Branch reconciliation + baselines — model: fable (orchestrator, no dispatch)
- Reconcile: if `b10-terrain-fixups-20260613` is unmerged and `git merge-base --is-ancestor main b10-terrain-fixups-20260613` holds, fast-forward main to it and push; otherwise branch B11 **from the fixups branch** and leave main alone, flagging the merge in `state_TODO.md`. Then `git checkout -b betterment11-20260702 && git push -u origin betterment11-20260702`.
- Baselines (real-hardware Chrome preferred): screenshots — start screen; explore ground-level Bangkok; 1 200 m in-CTR (the purple wash); Chiang Mai vista 2 600 m; night Bangkok 1 100 m; SCRAMBLE briefing; mid-wave; tour stop 1. Record `~` overlay numbers (calls/tris/textures/programs, frame ms) day+night in the journal. These are the diff anchors for C1–C4.
- **Pass:** branch pushed; baseline set archived under `.scratch/facelift_20260702/` + journal note.
- **Commit:** none (git ops + scratch only).

### B11.T1 — UI visibility registry (`src/uiPrefs.js`) — model: sonnet
- Implement §0.5.1 exactly: registry, sparse-override persistence, `apply()/toggle()/set()/snapshot()/onChange()`, `.uiHidden` CSS rule, rewire J/H/T/C/backquote key handlers and the pro-chip (`hudExtras` bridges `kuson.hud.v1` — keep that key authoritative to avoid migrating existing users), expose `__sim.uiPrefs`. Wire `apply()` once post-init in `main.js`.
- **Pass:** console — `__sim.uiPrefs.set('altTape', false)` hides the tape; `snapshot()` reflects it; reload persists it; deleting the storage key restores defaults; J key round-trips through the registry (`snapshot()` flips). `node --check` clean.
- **Commit:** `feat(ui): unified visibility registry + sparse persistence (kuson.uiprefs.v1)`

### B11.T2 — View panel section + radar popover — model: sonnet
- New collapsible "VIEW" section at the top of `#panel` (house checkbox style): one row per §0.5.1 entry grouped FLIGHT/NAV/INFO/ALERTS/HELP, key hints right-aligned (`J`, `H`, …), `alertBanner`/`alertChips` rows carry a ⚠ prefix; "Reset layout" button (clears `kuson.uiprefs.v1.global`). Mode tabs come in T6 — build the tab strip disabled-stub now (`[Auto]` active only).
- Fold the four radar floater checkboxes into a ⚙ button on the radar frame opening a small anchored popover (same checkboxes, unchanged handlers); `radarOptions` registry default flips to false (the popover replaces the floaters).
- **Pass:** browser (orchestrator at C1 — executor verifies DOM wiring headlessly): every checkbox round-trips its element live; reset restores defaults; popover opens/closes; floaters gone from the viewport.
- **Commit:** `feat(ui): View panel (per-element visibility) + radar options popover`

### B11.T3 — Theme tokens + 4 themes (`src/theme.js`) — model: sonnet, escalation-watch (canvas palette hooks)
- Implement §0.5.2: token extension, THEMES data, `applyTheme`, canvas draw functions read `theme.current.canvas.*`, inline-color migrations (branch spans, debugOverlay, tour gradient), theme `<select>` in the View section, persistence + boot-apply before first paint (inline in index.html head to avoid flash).
- **Pass:** `classic` = screenshot-identical to pre-task (C1 diff); cycling themes recolors HUD panel, compass, alt tape, attitude ball, minimap accents, branch chips, debug overlay with **zero** stragglers (grep-audit the literals list from the report §1.3 — all gone); persists across reload; `node --check` clean.
- **Commit:** `feat(ui): theme token system + classic/daylight/nvg/amber reskins`

### B11.T4 — Panel information architecture — model: sonnet, **Fable design-review before commit**
- Move-only restructure of `#panel` into collapsible groups: TOUR · VIEW (T2's) · WORLD (display options incl. new B11 toggles) · TRAFFIC (live flights + radio log) · FLIGHT (input settings, altitude limits, sim speed if panel-hosted) · INFO (drone rules, legend, history). No control's id/handler changes; sections persist collapsed-state in `kuson.panel.v1`; fresh default: TOUR+WORLD expanded, others collapsed.
- Disclaimer/attribution: fixed 1-line footer strip bottom-right, always visible, outside the panel flow (text verbatim — non-negotiable per claude.md §7).
- **Pass:** every existing control still functions (walk list in commit body); collapsed states persist; footer never overlaps the panel at 1280×800 and 1920×1080; defaults-parity for a returning profile is **waived for layout** (this task intentionally regroups) but all *values* unchanged.
- **Commit:** `refactor(ui): panel IA — grouped collapsible sections + fixed disclaimer footer`
- **CHECKPOINT C1 (orchestrator):** §0.2 list.

### B11.T5 — App-mode manager (`src/appMode.js`) — model: sonnet
- Implement §0.5.3 first paragraph: mode+detail state, `gameMode.onState` hook (additive), tour/tutorial wiring, guards with alert-chip feedback, `change` events, `__sim.appMode`.
- **Pass:** scripted walk (console): explore→tour→end→briefing→wave→abort→explore emits the exact expected sequence (assert log); tour refused during WAVE and vice versa with chips; zero behavior change otherwise (no UI applied yet).
- **Commit:** `feat(modes): appMode source of truth + transition guards`

### B11.T6 — Per-mode UI profiles (`src/uiProfiles.js`) — model: sonnet
- Implement §0.5.3 profiles + snapshot/exact-restore + mode-scoped overrides + the View panel mode tabs (enable T2's stub: Auto/Freestyle/Learning/Game editing `modes[…]`); `layers.labels` formalization for learning (replace the tour's ad-hoc label flip with the profile, preserving its save/restore).
- **Pass:** mode walk shows/hides per the §0.5.3 defaults (assert `snapshot()` at each state); manual mid-wave toggle survives until wave end then restores; per-mode override set in the Game tab applies on next wave and persists; reload mid-tour recovers to a sane freestyle baseline.
- **Commit:** `feat(modes): per-mode UI profiles with exact-restore + per-mode overrides`

### B11.T7 — Input scoping + Escape ladder — model: sonnet, **escalate to Fable on 2nd failure**
- Implement §0.5.4. Touch the minimum: guard consults in existing handlers + one capture-phase Escape listener; remove the per-overlay Escape listeners it supersedes (list them in the commit body).
- **Pass:** input-storm script per mode (fire U/M/Ctrl+Z/Y/I/V/J/Escape synthetically): WAVE state-snapshot unchanged except legal keys; freestyle behavior unchanged; Escape ladder order verified in all five contexts; typing modal still swallows everything else.
- **Commit:** `feat(input): per-mode action guards + unified Escape ladder`
- **CHECKPOINT C2 (orchestrator):** §0.2 list.

### B11.T8 — Interior-fill law — model: sonnet, escalation-watch (pooled materials)
- Implement §0.5.5 (containment-driven fill fade, hysteresis, highlight exemption, WORLD toggle, measurement-driven clone-vs-attribute decision).
- **Pass:** console-staged: teleport into Bangkok CTR → containing volumes' fill opacity reaches 0.15× within 2 s (read material state), rim/outline unchanged, exit restores; toggle OFF ⇒ opacities byte-equal legacy; program count delta 0, material count delta recorded.
- **Commit:** `feat(airspace): interior-fill fade — world stays readable inside volumes`

### B11.T9 — Declutter laws (`src/declutter.js`) — model: sonnet
- Implement §0.5.6 table + master toggle; hook into the main loop at 4 Hz; laws write opacity/visibility only through each layer's existing setters (province sprites, beacon sprites, label sprites, rings, district DOM).
- **Pass:** staged asserts at 500 m / 3 km / 8 km AGL and 30/70/120 km from Bangkok: each law's opacity within ±0.05 of the table; master OFF ⇒ all layers at legacy values (snapshot equality); update cost < 0.3 ms at 4 Hz tick (overlay).
- **Commit:** `feat(world): altitude/distance declutter laws (toggleable)`

### B11.T10 — Focus mode — model: sonnet
- Implement §0.5.6 focus paragraph (key F via registry HELP group? No — action key, not visibility: wire in input.js with `inputAllowed('focus')` allowed everywhere except typing modal; View row shows state).
- **Pass:** F over Bangkok dims all but containing volumes (assert opacity sets); during a wave, target airspace stays lit and HUD chip pulses; F again / mode change restores exactly; no persistence.
- **Commit:** `feat(world): focus mode — dim all but current + target volumes`
- **CHECKPOINT C3 (orchestrator):** §0.2 list.

### B11.T11 — Postprocessing composer + night bloom — model: **fable, orchestrator-inline** (pre-routed: composer × logdepth × additive-points is the highest-risk integration; B10 precedent)
- Implement §0.5.7-T11: vendor r170 jsm set, importmap entries, gated pipeline, auto-disable, tone-mapping parity check, MSAA evaluation (SMAAPass contingency), bare-scene city-lights probe before/after.
- **Pass:** composer ON day scene visually ≈ legacy (diff at C4); night bloom visible on city lights/tracers/beacons/rim; OFF ⇒ code path is the legacy render call; frame ≤ 4 ms M1 everything-ON; console clean incl. shader compile; SwiftShader fallback verified (auto-disable path exercised).
- **Commit:** `feat(gfx): vendored postprocessing pipeline — gated night bloom`

### B11.T12 — Night sky + city-light constellations — model: sonnet (script regeneration re-run: haiku-ok under review)
- Implement §0.5.7-T12: generator script + JSON, cityLights.js cluster consumption (size cap 24 px kills the dome artifact), `src/nightSky.js` stars + moon. Day parity: all three layers fully gated by nightFactor.
- **Pass:** night Bangkok screenshot = carpet of discrete small lights (no domes — compare T0 baseline); stars+moon only at night; day screenshot-identical; draw calls +≤3; script re-run reproduces byte-identical JSON (seed fixed).
- **Commit:** `feat(sky): star field + moon + per-city light constellations (data-generated)`

### B11.T13 — Terrain shading + base-tile anisotropy — model: sonnet, escalation-watch (tile pipeline)
- Implement §0.5.7-T13: grid-based per-vertex hillshade into vertex colors behind `terrainShade` toggle; base-tile anisotropy 8; scope-guard on atmosphere tweaks.
- **Pass:** Doi Inthanon vista shows directional relief shading vs T0 baseline; Bangkok flats delta minimal; shared-edge shading continuous (probe adjacent-tile edge vertex colors, max delta ≤ 0.02); toggle OFF ⇒ tile build path byte-identical (code-inspect + screenshot); tile build time delta < 10 ms (log timing).
- **Commit:** `feat(terrain): elevation-grid hillshade baked into tile vertex colors + base-tile anisotropy`

### B11.T14 — Bug sweep (§0.4 a–d) — model: sonnet
- (a) call the district resolver on teleport + fly-to arrival; (b) `daynight.setMode` syncs the select (and root-cause the reload desync — fix at the true cause, document it); (c) verify T4's footer resolved the collision at both test viewports; (d) alerts top-offset accounts for the game strip height when visible.
- **Pass:** each §0.4 repro script fails pre-fix, passes post-fix (repro + result in commit body).
- **Commit:** `fix(ui): district-label refresh, time-of-day sync, banner stacking (Facelift sweep)`
- **CHECKPOINT C4 (orchestrator):** §0.2 list — full regression + perf numbers + showcase screenshots archived to `.scratch/facelift_20260702/after/`.

### B11.T15 — Docs — model: sonnet (spec §3.19 + acceptance rows); journal/TODO/README ticks: **haiku-ok** under orchestrator line-review
- `spec.md` §3.19 "Interface Facelift (Betterment-11)" — registry, themes, profiles, interior fade, declutter laws, graphics pack, all persistence keys; §6 acceptance rows (~12: one per C1–C4 gate item). `README.md`: View panel, themes, F key, new WORLD toggles. `journal.md` block 2026-07-XX per claude.md §5 with C1–C4 evidence + overlay numbers. `state_TODO.md` §0f B11 block ticked per verified criteria. Push.
- **Commit:** `docs: spec §3.19 Facelift + B11 journal/TODO/README`

---

## Cross-phase verification (before tagging B11 complete)

- Global regression checklist (`20260528_BettermentPlaybook.md §0.5.2`).
- B5 group toggles · B6 ground layers · B7/B8 SCRAMBLE + audio + tutorial · B9 INTERCEPT · B10 world layers — each smoke list still passes **with B11 defaults ON** and again with **everything B11 OFF** (parity run).
- Defaults-off parity: screenshot diff vs T0 baselines ≈ none (modulo §0.4 fixes).
- 3-minute mixed session (explore → tour → SCRAMBLE wave → abort → INTERCEPT wave → night explore) — console clean, frame ≤ 4 ms, exact-restore holds after every exit.
- Journal block appended; `state_TODO.md` ticked; branch pushed; merge to main + `betterment11-complete` tag = **user decision** (per B7 precedent).

## Deferred (filed, not in B11 scope)

- Label screen-space collision avoidance (spatial hash) — revisit after declutter laws land; may be unnecessary.
- Floating mini radio-log during waves; recorded voice-over pack (B8 carry-over).
- Per-layer opacity sliders (registry makes them cheap later).
- Cloud layer sprites; live-traffic shadow blobs (B9 carry-over, cost).
- Playwright smoke rig (state_TODO §3 row stands).
