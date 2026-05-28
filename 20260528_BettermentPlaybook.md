# Betterment Playbook — Thailand Airspace Simulator

**Companion to:** [20260528_BettermentReport.md](20260528_BettermentReport.md)
**Audience:** Sonnet 4.6 / Opus 4.7 sessions implementing this work
**Tracking files (read first, write to last):**
- [20260528_journal.md](20260528_journal.md) — append-only session log
- [20260528_todo.md](20260528_todo.md) — single source of truth for task state

This playbook is **stop-and-resume safe**. Every phase fits inside a single context window. Every task ends at an atomic commit. Any session — fresh Sonnet or fresh Opus — can pick up by reading three things: this playbook, the journal's last block, and the todo's first unchecked item.

---

## 0. Operator protocol (read every session start)

### 0.1 Session opening (mandatory)

Run this in order, in your first 5 tool calls:

1. **Read [20260528_journal.md](20260528_journal.md)** — last block. Recover end-HEAD SHA, blockers, in-flight task ID, and the "next action" line.
2. **Read [20260528_todo.md](20260528_todo.md)** — find the first unchecked task in the current phase.
3. **Read this playbook's matching phase section** in full.
4. **Verify reality:** `git status && git rev-parse --short HEAD`. Reconcile against the journal's claimed end-state. If they disagree, **stop and write a `RECONCILE` block to the journal** — do not touch code until the operator confirms.
5. **Read the file(s) you're about to touch** end-to-end. Never edit a file you haven't fully read this session.

### 0.2 Session closing (mandatory)

Before declaring done or running out of context:

1. Append **one** block to [20260528_journal.md](20260528_journal.md) using the skeleton in §0.6.
2. Tick boxes in [20260528_todo.md](20260528_todo.md) **only for tasks whose Pass Criterion is verified** (browser smoke + commit landed).
3. Push the branch if the operator confirmed `git push` is in scope; otherwise note "ready to push" in the journal.
4. Leave the working tree clean. No `.scratch` artifacts in `git status` unless intentional and noted.

### 0.3 Context budget heuristic

If you're past **60% context** and the next task you'd start is >15 minutes:
- **Do not start it.** Write a CHECKPOINT block to the journal noting the next concrete action.
- Reason: the next session inherits clean context and produces better code than you would in the remaining 40%.

If you're past 80% and mid-task: **finish the atomic commit, journal, stop.**

### 0.4 Quality gates between phases

A phase is **not complete** until ALL of these are green. Don't start phase N+1 until phase N has its journal entry tagged `STATUS: PHASE_COMPLETE`.

| Gate | How to verify | Failure means |
|---|---|---|
| **Syntax clean** | Open each touched JS file in Node REPL: `node --check src/foo.js` | Stop and fix |
| **No console errors** | Open `index.html` in a browser, open DevTools console, load with no `?debug`; refresh; scan for red. | Stop and fix |
| **Smoke checklist** | Run the phase's smoke section in §0.5. Every box must be tickable. | Defer phase exit |
| **Regression check** | Run the global regression list in §0.5.2. | Defer phase exit |
| **Visual diff** | Take a screenshot at preset 1× Mavic, FOV 70, over Bangkok, third-person. Compare to `.scratch/baseline/phase0.png` (capture in Phase 0). | Note diff; only block if regression is unintended. |
| **Commits atomic + conventional** | `git log --oneline phaseStart..HEAD` should show one commit per task, message prefix in `feat|fix|perf|chore|refactor|docs(scope): …` | Squash or re-author before tagging phase complete |
| **Journal entry written** | Block in `20260528_journal.md` with `STATUS: PHASE_COMPLETE`. | Phase isn't done. |

### 0.5 Smoke checklists

#### 0.5.1 Per-phase smoke (the phase's own functionality)
Each phase below has a section "Phase smoke checklist" — run it before declaring the phase complete.

#### 0.5.2 Global regression checklist (run every phase exit, ≤2 min)
- [ ] App loads to default view without console errors
- [ ] All 5 aircraft presets selectable via 1-5 keys; each visible in third-person
- [ ] WASD moves the aircraft in the currently selected mode
- [ ] Mouse-look rotates the camera; right-click locks pointer
- [ ] HUD shows altitude, speed, heading, lat/lon
- [ ] Heading compass, altitude tape, artificial horizon all render
- [ ] Minimap shows airspaces and aircraft cursor
- [ ] Identify mode (I) shows a panel of nearest airspaces
- [ ] Tour (T) starts and plays through ≥3 stops
- [ ] Pause (P), View toggle (V), Hover (Space), Units (U) all work
- [ ] No regression in third-person framing on any preset
- [ ] Frame rate ≥45 fps in third-person Mavic 3 over Bangkok

### 0.6 Journal block skeleton

Append this to [20260528_journal.md](20260528_journal.md) at session end. **Append, never overwrite.**

```
─────────────────────────────────────────────────────────────────────
## Session YYYY-MM-DD HH:MM (model, session-id)
**Phase:** N — <phase title>
**Tasks attempted:** P{N}.T{n}, P{N}.T{n+1}
**Tasks completed:** P{N}.T{n}  (ticked in todo)
**Tasks deferred:** P{N}.T{n+1} — reason
**Start HEAD:** <short-sha>
**End HEAD:** <short-sha>
**Commits this session:**
  <sha>  feat(scope): …
  <sha>  perf(scope): …

**What I did:** <2-4 sentences>
**What I learned:** <surprises, code structure discoveries, bugs found>
**Pass Criteria verified:** <which gates green>
**Pass Criteria deferred:** <which gates not yet checked, why>
**Blockers:** <if any>
**Next action (for next session):** <one concrete sentence>

**STATUS:** IN_PROGRESS | PHASE_COMPLETE | BLOCKED | CHECKPOINT
─────────────────────────────────────────────────────────────────────
```

### 0.7 Todo file format

[20260528_todo.md](20260528_todo.md) is the **single source of truth** for task state. Bootstrap with §A at the bottom of this playbook. Each task line:

```
- [ ] P{N}.T{n} — <one-line task title>  [effort:S|M|L]
```

Tick `[x]` only when the task's commit has landed AND its Pass Criterion is verified by the smoke checklist. **No half-ticks.**

### 0.8 Commit conventions

```
feat(scope):    user-visible new capability
fix(scope):     bug fix (link bug ID from report when applicable)
perf(scope):    measurable performance change
refactor(scope): no behaviour change, structural improvement
chore(scope):   tooling, deps, file hygiene
docs(scope):    docs / journal / todo / playbook updates
```

Scopes: `physics | hud | airspace | ground | minimap | tour | input | mode | viz | perf | bug`

One commit per task. Co-author footer:
```
Co-Authored-By: Claude (Sonnet 4.6 | Opus 4.7) <noreply@anthropic.com>
```

### 0.9 Branching

Work on a long-lived branch `betterment-20260528`. Cut it from `main` in Phase 0. Do **not** merge to main until the operator approves. Phase tags: `betterment-phase-0-complete`, `betterment-phase-1-complete`, etc.

### 0.10 Files outside scope

Do not touch (without explicit operator approval):
- `data/airspaces.json` — sourced from AIP, regenerate via `scripts/build_airspaces.py` only
- `LICENSE`, `.gitignore`
- `journal.md`, `state_TODO.md`, `spec.md`, `claude.md` — existing project docs

Files this playbook **does** write:
- All `src/*.js`, `index.html`, new `src/modes.js`, new `src/physics.js`, new `src/terrain.js`, new `src/failures.js`, new `src/sky.js`, new `src/cities.js`
- `20260528_journal.md`, `20260528_todo.md`, this playbook
- `.scratch/betterment_20260528/*` (baseline screenshots, perf traces — gitignored)

---

# Phase 0 — Foundation: Mode Architecture + Hovercraft (Easy Mode)

> **Goal:** Establish the explicit flight-mode state machine and ship **Hovercraft mode as the easy-mode default**. Hovercraft is the existing kinematic strafe formalised as a first-class mode — no physics, no inertia, go in any direction, perfect for airspace exploration. The realistic Mavic 3 physics in Phase 3 will sit alongside it.
>
> **Why first:** Every subsequent phase touches the flight model. Without an explicit mode enum we end up with the current ad-hoc boolean tangle (`flightLocked`, `hover`, `paused`, `flyTo.active`, `tour.isRunning`). Mode-first means Phase 3's physics changes can't accidentally regress airspace-exploration UX.

**Effort:** ~1 day · **Context budget:** 1 session

### Prerequisites
- Branch `betterment-20260528` cut from `main`
- `20260528_journal.md` and `20260528_todo.md` bootstrapped from §A and §B at the bottom of this playbook
- Baseline screenshot saved to `.scratch/betterment_20260528/baseline_phase0.png`

### Tasks

#### P0.T1 — Cut branch + bootstrap tracking files
- `git checkout -b betterment-20260528`
- Create `20260528_journal.md` with header from §B.1
- Create `20260528_todo.md` from §B.2
- Verify `.gitignore` includes `.scratch/`
- **Commit:** `chore(docs): bootstrap betterment-20260528 tracking files`

#### P0.T2 — Capture baseline screenshots and perf snapshot
- Launch app via a static server (see §0.11). Open [index.html](index.html) in Chrome.
- Press 1 (Mavic), V to chase view, fly over Bangkok.
- Save screenshots to `.scratch/betterment_20260528/baseline_phase0.png` and `..._minimap.png`.
- Note in journal: current FPS at idle and during identify mode (use Performance tab).
- **No commit** (artifacts are gitignored)

#### P0.T3 — Add explicit `FlightMode` enum and central dispatcher
- **New file:** `src/modes.js`
- Export a frozen object:
  ```
  export const FlightMode = Object.freeze({
    HOVERCRAFT: 'hovercraft',  // Easy mode — kinematic 6-DoF strafe, any direction
    DRONE:     'drone',         // Phase 3 — second-order quadrotor physics
    AIRPLANE:  'airplane',      // Phase 3 — energy-aware fixed-wing
    UFO:       'ufo',           // Joke preset — kinematic, no constraints
  });
  ```
- Export `defaultModeForPreset(presetId)`:
  - `"1x"` (Mavic 3) → `HOVERCRAFT` (until Phase 3 promotes to `DRONE`)
  - `"5x"` (Cessna), `"20x"` (Learjet), `"50x"` (777) → `AIRPLANE`
  - `"100x"` (UFO) → `UFO`
- Export `EasyMode = { enabled: true }` — runtime flag overrides all preset defaults to `HOVERCRAFT` until the user opts in to realism. See P0.T6.
- **Commit:** `feat(mode): add explicit FlightMode enum and default-per-preset mapping`

#### P0.T4 — Refactor `Drone._updateFree` into `Drone._updateHovercraft`
- File: [src/drone.js:1092-1118](src/drone.js:1092)
- Rename method `_updateFree` → `_updateHovercraft`. Keep behavior identical.
- Add `this.flightMode = FlightMode.HOVERCRAFT` in constructor (import from `./modes.js`).
- In `Drone.update(dt)`, dispatch on `this.flightMode`:
  ```
  switch (this.flightMode) {
    case FlightMode.HOVERCRAFT:
    case FlightMode.UFO:
      this._updateHovercraft(dt); break;
    case FlightMode.AIRPLANE:
      this._updateAirplane(dt); break;
    case FlightMode.DRONE:  // Phase 3 wires this
      this._updateHovercraft(dt); break;  // fallback until Phase 3
  }
  ```
- In `setSpeedPreset(id)`: call `this.flightMode = EasyMode.enabled ? FlightMode.HOVERCRAFT : defaultModeForPreset(id)`.
- **Verify:** all 5 presets still fly identically to baseline. Visual diff acceptable: zero pixel diff expected.
- **Commit:** `refactor(mode): dispatch flight update via FlightMode enum`

#### P0.T5 — UI: mode badge in HUD + "EASY MODE" indicator
- File: [src/ui.js](src/ui.js) — locate the existing preset-label area (search `Cessna 172` or `preset.label`).
- Add a chip next to the preset label showing the current mode:
  - `🛸 HOVERCRAFT — Easy Mode` (cyan, prominent) when `EasyMode.enabled`
  - `✈ AIRPLANE` (white) for fixed-wing presets in realistic mode (Phase 3)
  - `🚁 DRONE` (white) for Mavic 3 in realistic mode (Phase 3)
- Visual style: matches existing chip style (`var(--mono)`, glass blur, ~11px). Cyan for easy mode echoes the existing accent.
- **No emojis if operator's CLAUDE.md forbids them** — use text glyphs `[H]`, `[A]`, `[D]` instead. The operator's project CLAUDE.md does not forbid emojis but be conservative; default to text.
- **Commit:** `feat(hud): show current flight mode chip with Easy Mode indicator`

#### P0.T6 — Hotkey `M` to toggle Easy Mode ↔ Realistic; expose in help overlay
- File: [src/drone.js](src/drone.js) or [src/main.js](src/main.js) wherever the key-handler dispatcher lives
- `M` key → `EasyMode.enabled = !EasyMode.enabled`, then call `drone.setSpeedPreset(currentPresetId)` to re-resolve mode.
- Add to help overlay: "M — toggle Easy Mode (Hovercraft) ↔ Realistic"
- Add to README's controls table.
- In Phase 0, "Realistic" still falls back to hovercraft for `DRONE` mode (since Phase 3 hasn't shipped). Airplane realism already exists for fixed-wing.
- **Pass criterion:** Press M; chip updates; Cessna switches from hovercraft-strafe (Easy) to bank-to-turn (Realistic). Mavic still hovercrafts in both (until Phase 3).
- **Commit:** `feat(input): M key toggles Easy Mode (Hovercraft) ↔ Realistic`

#### P0.T7 — Hovercraft tuning: vertical-only modifiers + free 6-DoF
- File: [src/drone.js](src/drone.js) `_updateHovercraft`
- Confirm hovercraft already supports: W/S forward/back, A/D strafe left/right, Q/E (or Space/C) up/down, mouse-look pitch+yaw.
- **Add if missing:** Shift = boost (×3 within preset cap), Ctrl = precision (÷3 for fine positioning near airspace boundaries).
- Hovercraft cap: never let Shift take Mavic past 200 km/h (preset.kmh × min(BOOST_FACTOR, preset.boostCap ?? 3)).
- This is also bug fix from the report (BOOST_FACTOR runaway): partial here, completed in P1.T1.
- **Commit:** `feat(physics): add precision modifier to hovercraft mode`

#### P0.T8 — Onboarding tip: "Press M for Realistic; default Easy Mode"
- File: [src/ui.js](src/ui.js) help/intro overlay
- Add a one-time tooltip on first load: "**Easy Mode** is on — fly in any direction to explore. Press **M** for realistic flight physics."
- Persist dismissal in `localStorage` keyed `kuson_easy_mode_intro_v1`.
- **Commit:** `feat(hud): first-run intro tooltip explaining Easy Mode`

### Phase 0 smoke checklist
- [ ] Branch `betterment-20260528` exists; baseline screenshots saved
- [ ] `src/modes.js` exports `FlightMode`, `EasyMode`, `defaultModeForPreset`
- [ ] Mode chip appears in HUD; shows "Easy Mode" by default
- [ ] M key toggles Easy ↔ Realistic; chip updates instantly
- [ ] Hovercraft mode: WASD + QE + mouse work in all 6 DoF on every preset
- [ ] Cessna in Realistic mode banks correctly (existing behaviour preserved)
- [ ] Mavic 3 in Easy and Realistic mode both fly as hovercraft (Phase 3 changes this)
- [ ] No console errors; all 5 presets selectable
- [ ] Global regression checklist (§0.5.2) passes
- [ ] Phase 0 journal block written; tag `betterment-phase-0-complete` cut

---

# Phase 1 — Stop the Embarrassment (cheap wins, no design risk)

> **Goal:** Land every "no-design-decision-required" fix that all three reviewers independently flagged. Each task is <30 minutes, each ships an atomic commit. The phase should end with a measurably faster, less leaky app and zero new bugs.

**Effort:** ½–1 day · **Context budget:** 1 session

### Prerequisites
- Phase 0 complete, tagged `betterment-phase-0-complete`
- Journal's last block ends with `STATUS: PHASE_COMPLETE`

### Tasks

#### P1.T1 — Per-preset boost cap (777 ≠ Mach 2.25)
- File: [src/drone.js:5](src/drone.js:5), [src/drone.js:1132](src/drone.js:1132)
- Add `boostCap` field per preset:
  ```
  { id: "1x",  kmh:  50, boostCap: 4   },  // Mavic 3: 200 km/h ceiling
  { id: "5x",  kmh: 220, boostCap: 1.5 },  // Cessna Vne ~280
  { id: "20x", kmh: 800, boostCap: 1.1 },  // Learjet MMo
  { id: "50x", kmh: 920, boostCap: 1.0 },  // 777 cruise-only boost
  { id: "100x",kmh: 600, boostCap: 5   },  // UFO has no excuse
  ```
- In `_updateAirplane` and `_updateHovercraft`, `boostMult = shift ? Math.min(BOOST_FACTOR, preset.boostCap) : 1`
- **Pass:** boost a 777 — top airspeed shows 920 km/h, not 2 760.
- **Commit:** `fix(physics): cap Shift boost per-preset to prevent Mach 2.25 on 777`

#### P1.T2 — Hoist Vector3 scratch in hot paths
- Files: [src/drone.js:1019](src/drone.js:1019) (`forward()`), [src/drone.js:1029](src/drone.js:1029) (`right()`), [src/drone.js:1097](src/drone.js:1097) (`_updateHovercraft` `move`)
- Constructor: `this._fwdVec = new THREE.Vector3()`, `this._rightVec = new THREE.Vector3()`, `this._moveVec = new THREE.Vector3()`.
- `forward()` returns `this._fwdVec.set(...)` — mutate-in-place. Same for `right()`.
- `_updateHovercraft`: reuse `this._moveVec.set(0,0,0)`, then add forward/right.
- **Pass:** behaviour unchanged; Chrome DevTools allocation profile shows ~0 `Vector3` allocs/sec in steady free flight.
- **Commit:** `perf(physics): hoist Vector3 scratch to eliminate per-frame GC pressure`

#### P1.T3 — Precompute minimap CSS color strings
- File: [src/airspace.js:79](src/airspace.js:79) (or wherever `compiled` entries are constructed)
- At compile time, add `c.cssColor = "#" + c.color.toString(16).padStart(6, "0")`.
- File: [src/ui.js:1329](src/ui.js:1329) — use `c.cssColor` instead of recomputing.
- **Pass:** drawMinimap unchanged visually; `padStart` no longer appears in flame chart.
- **Commit:** `perf(minimap): precompute CSS color string per airspace`

#### P1.T4 — LRU cap on MinimapTileCache
- File: [src/ground.js:188-219](src/ground.js:188)
- Add `MAX_CACHE = 64`. On `set(key, img)`, if `size > MAX_CACHE`, delete the first (oldest) key.
- Use `Map` (already insertion-ordered) — call `.delete()` of the first key via `cache.keys().next().value`.
- **Pass:** after panning the minimap for 2 minutes, cache size ≤ 64.
- **Commit:** `perf(minimap): LRU cap MinimapTileCache to 64 entries`

#### P1.T5 — Dispose `material.map` on tile material disposal
- File: [src/ground.js:50](src/ground.js:50), [src/ground.js:152](src/ground.js:152)
- Before `mat.dispose()`: `if (mat.map) mat.map.dispose();`
- **Pass:** toggle quality 5×, watch GPU memory in chrome://gpu-internals or Performance Monitor — no monotonic growth.
- **Commit:** `fix(ground): dispose tile material.map to prevent GPU texture leak`

#### P1.T6 — Pause rAF on `document.hidden`
- File: [src/main.js:330](src/main.js:330)
- Wrap `requestAnimationFrame(loop)` call site. Track `let rafId = null`.
- Add listener:
  ```
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (rafId) cancelAnimationFrame(rafId); rafId = null; }
    else if (!rafId) { lastT = performance.now(); loop(); }
  });
  ```
- Reset `lastT` on resume to avoid a giant `dt` first frame.
- **Pass:** switch tabs for 30 s, return — no jump in aircraft position, no console errors.
- **Commit:** `perf(main): pause render loop on document hidden`

#### P1.T7 — Tighten fog distances
- File: [src/main.js:16](src/main.js:16)
- Change fog from `(0xa9c1da, 80000, 400000)` to `(0xa9c1da, 30000, 250000)` (will be re-tuned in Phase 2 when sky dome lands).
- Keep camera `far` at current value for now; Phase 5 considers reducing it.
- **Pass:** at FL350 over Bangkok looking northeast, the horizon haze is now visible, not flat at the bottom of the screen.
- **Commit:** `chore(viz): tighten fog distance to 30–250 km`

#### P1.T8 — Finish element-ref caching in `updateHUD`
- File: [src/ui.js:1122-1211](src/ui.js:1122)
- Find every `this.hud.querySelector(...)` inside `updateHUD`. Move each to the constructor:
  ```
  this._el = {
    alt: this.hud.querySelector('#alt'),
    speed: this.hud.querySelector('#speed'),
    latlon: this.hud.querySelector('#latlon'),
    inside: this.hud.querySelector('#inside'),
    // ...etc
  };
  ```
- Replace per-frame `querySelector` with `this._el.alt` etc.
- **Pass:** HUD updates correctly; no `querySelector` calls in flame chart for `updateHUD`.
- **Commit:** `perf(hud): cache DOM element references in constructor`

#### P1.T9 — Empty-filter shortcut in `_refreshAirspaceList`
- File: [src/ui.js:1006-1074](src/ui.js:1006)
- Move the "no items match" check BEFORE the `items.map(...)` call. Don't generate 144 cards just to overwrite them.
- **Pass:** type a non-matching filter; only one DOM write happens (verify via Performance Monitor or a console.count).
- **Commit:** `perf(ui): skip airspace-list render when filter empty`

#### P1.T10 — Cache canvas gradients for HUD instruments
- File: [src/ui.js:593,717](src/ui.js:593) (and any other `createLinearGradient` call inside per-frame draw methods)
- Cache gradients keyed on `(canvasWidth, canvasHeight)`. Recompute on resize only.
- Pattern:
  ```
  if (!this._gradHeading || this._gradHeadingKey !== `${w}x${h}`) {
    this._gradHeading = ctx.createLinearGradient(...);
    this._gradHeadingKey = `${w}x${h}`;
  }
  ```
- **Pass:** HUD looks identical; `createLinearGradient` no longer per-frame in flame chart.
- **Commit:** `perf(hud): cache canvas gradients across frames`

#### P1.T11 — Bug fix: `BOOST_FACTOR` legacy snapshot restoration
- File: [src/drone.js:1062,1200](src/drone.js:1062)
- `setSpeedMultiplier` is deprecated. In `restore(s)`, if `s.speedMultiplier` is set but `s.presetId` is not, fall through to a mapping table rather than always defaulting to UFO ("100x").
  - Mapping: `1 → "1x"`, `5 → "5x"`, `20 → "20x"`, `50 → "50x"`, `100 → "100x"`.
- **Pass:** old snapshot with `speedMultiplier: 5` restores as Cessna, not UFO.
- **Commit:** `fix(physics): map legacy speedMultiplier to preset id correctly`

#### P1.T12 — Bug fix: `restore()` cameraMode/teleport ordering
- File: [src/drone.js:1195-1209](src/drone.js:1195)
- `cameraMode` must be set AFTER `teleport` (or `teleport` must respect existing `cameraMode`). Choose the latter: change the `if (!this.cameraMode)` branch in `teleport` to `if (this.cameraMode == null)` (explicit null check; treats `"down"|"left"|"right"` as set), AND assign `cameraMode` first then call `teleport` (current order is fine if the null-check is correct).
- Also: `bodyRoll` is set before `teleport` but `teleport` doesn't preserve it. Move `this.bodyRoll = s.bodyRoll ?? 0` to after `teleport`.
- **Pass:** undo into a banked airplane snapshot preserves the roll; undo into a "down" camera snapshot stays in down view.
- **Commit:** `fix(physics): restore() ordering preserves cameraMode and bodyRoll`

### Phase 1 smoke checklist
- [ ] All 12 commits landed; `git log --oneline` shows one per task
- [ ] App still loads with no console errors
- [ ] Boost 777 → top speed 920 km/h
- [ ] Performance tab in Chrome: no `Vector3` allocs per second in steady flight; no `padStart` in minimap loop
- [ ] Switch tabs 30s → no jump
- [ ] HUD updates correctly across all presets
- [ ] Global regression checklist (§0.5.2) passes
- [ ] Visual diff vs `.scratch/baseline_phase0.png`: only fog change is intentional
- [ ] Phase 1 journal block written; tag `betterment-phase-1-complete` cut

---

# Phase 2 — Atmosphere Weekend (highest perceived-quality jump)

> **Goal:** Make the scene *feel* like a flight environment, not a web demo. Sky dome, sun, animated aircraft details, readable Thai ground map, shaded airspace volumes. Three reviewers independently identified this as the single highest perceived-quality jump.

**Effort:** 1–2 days · **Context budget:** 2–3 sessions

### Prerequisites
- Phase 1 complete, tagged
- Baseline screenshot from Phase 0 still on disk for comparison

### Tasks — Session A (sky + aircraft animation)

#### P2.T1 — Three.js `Sky` dome + sun disc
- **New file:** `src/sky.js`. Export `installSky(scene, renderer, sunDir)`.
- Use `three/examples/jsm/objects/Sky.js`. Default uniforms: turbidity 4, rayleigh 1.5, mieCoefficient 0.005, mieDirectionalG 0.8.
- Place a sun-disc sprite (`THREE.Sprite` with radial-gradient canvas texture) at `sunDir * 200000`.
- File: [src/main.js:14-75](src/main.js:14) — replace `scene.background = new THREE.Color(0x89b4dc)` with `installSky(scene, renderer, sunDir)`.
- Keep the existing `DirectionalLight` and `HemisphereLight`; align directional light's position with sun.
- **Pass:** scene shows sky gradient + sun, not flat blue.
- **Commit:** `feat(viz): three.js Sky dome with sun disc`

#### P2.T2 — Tonemap + altitude-driven fog
- File: [src/main.js:25-33](src/main.js:25)
- `renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;`
- Sample fog colour at horizon from the sky shader (or hard-code a horizon haze `0xc8d4dc` that visually matches Phase 2.T1's sky output).
- In the render loop, lerp fog density based on altitude: thinner above 5000 m (less Rayleigh through less atmosphere). Simple formula: `fog.density = baseDensity * (1 - clamp(altitude/12000, 0, 0.7))`.
- **Pass:** at FL350 the horizon is paler; at 100 m AGL fog is denser.
- **Commit:** `feat(viz): ACES tonemap + altitude-driven fog falloff`

#### P2.T3 — Animate propellers + control surfaces + nav lights
- File: [src/drone.js](src/drone.js) — model factories for Mavic 3, Cessna, Learjet, 777.
- **Props:** tag each prop group with `userData.isProp = true; userData.spinRate = 40` (rad/s for Mavic, scaled per preset). In `Drone.update(dt)`, traverse current model: `if (child.userData.isProp) child.rotation.y += child.userData.spinRate * dt * throttleFactor`.
- **Control surfaces:** tag aileron meshes with `userData.surface = 'aileron-L' | 'aileron-R' | 'elevator' | 'rudder'`. In `Drone.update`, for fixed-wing presets, deflect:
  - `aileron-L.rotation.x = -aileronInput * 0.4`
  - `aileron-R.rotation.x = +aileronInput * 0.4`
  - `elevator.rotation.x = -pitchInput * 0.3`
  - `rudder.rotation.y = -yawInput * 0.4`
- **Nav lights:** add a small red `MeshBasicMaterial` cube on left wingtip, green on right wingtip, white on tail. Sine-modulate: `mat.opacity = 0.5 + 0.5 * Math.sin(t * 5)`. Or strobe: `t % 1.5 < 0.05 ? 1 : 0`.
- **Pass:** props visibly spin on Mavic in third-person; A/D deflects Cessna ailerons; nav lights blink at dusk (Phase 2 has time-of-day? optional — Phase 4).
- **Commit:** `feat(viz): animate props, control surfaces, and nav lights`

### Tasks — Session B (ground map clarity)

#### P2.T4 — Switch to Carto Positron basemap
- File: [src/ground.js:8-11](src/ground.js:8)
- Replace `tile.openstreetmap.org` URL with Carto Positron `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png` (subdomains a, b, c, d).
- Update minimap tile loader at [src/ui.js:1217](src/ui.js:1217) similarly.
- Update attribution footer to credit OpenStreetMap and CARTO.
- **Pass:** ground reads as a low-saturation labeled basemap; Thai city names visible at z11.
- **Commit:** `feat(ground): switch to Carto Positron basemap for clarity`

#### P2.T5 — Thai city beacon sprites
- **New file:** `src/cities.js`. Export `THAI_CITIES = [{ name, lat, lon, prominence }]` for ~30 cities: Bangkok, Chiang Mai, Chiang Rai, Khon Kaen, Korat (Nakhon Ratchasima), Phuket, Hat Yai, Hua Hin, Pattaya, Surat Thani, U-Tapao, Sukhothai, Trat, Krabi, Udon Thani, Ubon Ratchathani, Nong Khai, Lampang, Mae Hong Son, Phitsanulok, Ranong, Songkhla, Ayutthaya, Nakhon Si Thammarat, Loei, Sakon Nakhon, Buriram, Roi Et, Phetchaburi, Tak.
- Export `installCityBeacons(scene)`: per city, create a `THREE.Sprite` with white text at 128 px on transparent canvas, placed at `geoToWorld(lat,lon)` at y=200. Scale by camera distance similar to airspace labels (cap min size).
- File: [src/main.js](src/main.js) — call `installCityBeacons(scene)` after airspace layer load.
- Optional: only show top-N closest based on `prominence` × `distance`.
- **Pass:** at FL350 over central Thailand, Bangkok / Chiang Mai / Phuket labels are clearly visible.
- **Commit:** `feat(ground): Thai city beacon sprites for spatial orientation`

#### P2.T6 — Province boundary LineSegments overlay
- **New file:** `src/provinces.js`. Fetch a simplified Thailand provincial geojson (use [GADM](https://gadm.org/) level-1 simplified to ~5 km tolerance, ~50KB). Bake into `data/provinces.geojson`.
- Export `installProvinceLines(scene)`: parse, project, render as `THREE.LineSegments` with material `LineBasicMaterial({ color: 0xc8a050, opacity: 0.35, transparent: true })` at y=1.
- File: [src/main.js](src/main.js) — call after airspace layer load.
- **Pass:** muted gold province lines visible from FL250+; not distracting at low altitude.
- **Commit:** `feat(ground): Thailand province boundary overlay`

### Tasks — Session C (airspace volumes + labels)

#### P2.T7 — Shaded translucent airspace walls
- File: [src/airspace.js:131-189](src/airspace.js:131)
- Replace 16-rib wireframe with a continuous extruded wall using `ExtrudeGeometry` already in the file (currently hidden until highlight).
- Two-pass render: (a) wall mesh with `MeshBasicMaterial({ side: DoubleSide, transparent: true, opacity: 0.18, depthWrite: false, vertexColors: true })` and per-vertex colour gradient darker at floor → brighter at ceiling; (b) keep the outline `Line` on top and bottom, dropped ribs.
- This is a significant refactor. Subtasks:
  - P2.T7a: build the wall geometry with vertex colours
  - P2.T7b: switch outline material per category to shared instances
  - P2.T7c: remove ribs group; verify performance improved
- **Pass:** Bangkok CTR + TMA stack reads as two nested 3-D volumes, not a wireframe cage. No z-fighting on overlapping floors.
- **Commit:** `feat(airspace): render volumes as shaded translucent walls`

#### P2.T8 — Depth-aware label fade + top-N cap
- File: [src/airspace.js:96-127](src/airspace.js:96) (sprite creation), [src/airspace.js:507](src/airspace.js:507) (`updateLabelScales`)
- Enable `depthTest: true` for regular labels (keep `depthTest: false` for identify sprites — explicit user intent).
- In `updateLabelScales`: sort by camera distance, compute opacity = `clamp(1 - distance/maxRange, 0, 1)`, only render top 18 closest whose screen-space XY doesn't overlap a higher-priority placed label (simple AABB on projected position).
- **Pass:** at country-wide view, ≤18 readable labels; no overlapping smear at Bangkok cluster.
- **Commit:** `feat(airspace): depth-aware label fade + top-N declutter`

### Phase 2 smoke checklist
- [ ] Sky dome visible at all altitudes; sun disc placed
- [ ] Tonemap applied; high-altitude flight shows thinner fog
- [ ] Props spin on Mavic 3; control surfaces deflect on Cessna; nav lights blink
- [ ] Carto Positron tiles load; city names readable at z11
- [ ] Bangkok / Chiang Mai / Phuket beacon sprites visible from FL350
- [ ] Province lines visible; not distracting at low alt
- [ ] Bangkok airspace stack reads as nested volumes
- [ ] ≤18 labels at country view; no overlap smear
- [ ] Global regression checklist (§0.5.2) passes
- [ ] Visual diff vs Phase 0 baseline: major intentional changes only
- [ ] Phase 2 journal block written; tag `betterment-phase-2-complete` cut

---

# Phase 3 — Real Flight Model (earn the word "Simulator")

> **Goal:** Replace the kinematic strafe with a real second-order flight model. Hovercraft (Easy Mode) is preserved as the explicit mode for airspace exploration. Realistic DRONE mode for Mavic 3 gets proper attitude dynamics. AIRPLANE mode gets stall, energy-trade, and pitch→airspeed coupling.
>
> **This is the highest-risk phase.** Split into 4 sessions, each with its own quality gate.

**Effort:** 3–5 days · **Context budget:** 4 sessions

### Prerequisites
- Phase 2 complete, tagged
- Read [.scratch/betterment_20260528/pass1.md](.scratch/betterment_20260528/pass1.md) §1 and §pass3.md §1 again — physics specifics live there

### Tasks — Session A (physics scaffolding)

#### P3.T1 — Add fixed-step substep inside variable outer loop
- File: [src/main.js:330-378](src/main.js:330)
- Outer loop runs at rAF cadence (variable `dt`). Add fixed-step inner loop for physics:
  ```
  const PHYS_DT = 1/120;
  this._physAccum = (this._physAccum ?? 0) + dt;
  while (this._physAccum >= PHYS_DT) {
    drone.physicsStep(PHYS_DT);
    this._physAccum -= PHYS_DT;
  }
  drone.update(dt);  // non-physics updates: HUD, model animation
  ```
- Rename `Drone.update` body's mode-dispatch into `Drone.physicsStep(dt)`. `Drone.update(dt)` handles HUD/model animation only.
- **Pass:** behaviour at 60 fps unchanged; at synthetic 20 fps (use `setTimeout` throttle in DevTools), aircraft motion is the same per wall-second.
- **Commit:** `refactor(physics): fixed-step physics substep at 120 Hz`

#### P3.T2 — Physics state model + integrator
- **New file:** `src/physics.js`
- Export classes `RigidBody`, `QuadrotorModel`, `FixedWingModel`. State: `position`, `velocity`, `attitudeQ` (quaternion), `angularVelocity`, `mass`.
- Implement semi-implicit Euler:
  ```
  velocity += acceleration * dt;
  position += velocity * dt;
  angularVelocity += angularAccel * dt;
  attitudeQ.multiply(deltaQ(angularVelocity, dt)).normalize();
  ```
- Hook from `Drone.physicsStep`: dispatch on `flightMode`, call into appropriate model.
- For HOVERCRAFT mode, do NOT use physics — keep the kinematic strafe (it's the easy mode by definition).
- **Pass:** unit test (manual console probe): set velocity, run 60 steps at 1/120, verify position = velocity × 0.5 s within float epsilon.
- **Commit:** `feat(physics): RigidBody + QuadrotorModel + FixedWingModel scaffolding`

### Tasks — Session B (Mavic 3 second-order controller)

#### P3.T3 — Quadrotor attitude controller (Mavic 3 in DRONE mode)
- File: `src/physics.js` `QuadrotorModel`
- State: `commandedTilt`, `actualTilt` (vec3 for pitch/roll/0), `commandedThrust`, `currentThrust`.
- Stick → commanded tilt: `commandedTilt = stickInput * MAX_TILT_RAD` (default `MAX_TILT_RAD = 0.35` ≈ 20°).
- Actual tilt lerps: `actualTilt += (commandedTilt - actualTilt) * dt / TAU_ATT` (`TAU_ATT = 0.08`).
- Horizontal accel: `a_h = g * tan(actualTilt)` rotated by yaw.
- Vertical: thrust integrates against drag: `vy += ((throttleCmd * MAX_CLIMB) - vy) * dt / TAU_THROTTLE` (`MAX_CLIMB = 6 m/s`, `TAU_THROTTLE = 0.4`).
- Horizontal drag: `a -= velocity * K_DRAG` (`K_DRAG = 0.5`).
- Wire `bodyPitch` and `bodyRoll` from `actualTilt` so the Mavic visibly leans in third-person.
- **Pass:** in DRONE mode (M to switch off Easy Mode, Mavic 3 selected), press W → drone leans forward, accelerates, holds top speed; release W → coasts to stop over ~1.5 s.
- **Commit:** `feat(physics): second-order quadrotor controller for Mavic 3`

#### P3.T4 — Attitude indicator becomes meaningful
- File: [src/ui.js:843-992](src/ui.js:843)
- Now that `bodyPitch` and `bodyRoll` are real in DRONE mode, the existing artificial horizon will work. Verify it reads correctly when leaning forward (pitch indicator nose-down).
- Fix any sign conventions: drone-pitch convention is "tilt forward = positive pitch" but artificial horizon shows "nose-down = horizon below center". Verify and adjust.
- **Pass:** lean Mavic forward 20° → AH shows 20° nose-down + sky-down-tilt.
- **Commit:** `fix(hud): attitude indicator reflects DRONE mode physical attitude`

### Tasks — Session C (fixed-wing realism)

#### P3.T5 — Fixed-wing stall + energy trade
- File: `src/physics.js` `FixedWingModel`, replacing `Drone._updateAirplane` logic
- State: airspeed scalar, pitch (γ flight path angle), bank, yaw, throttle.
- Per preset: `Vs` (stall speed), `Vne`, `cl_max`, `cd0`, `mass`, `thrustMax`.
- Per step:
  - Drag: `drag = 0.5 * rho * v² * cd`, where `cd = cd0 + cdi(bank)`. Induced drag rises with bank.
  - Thrust along velocity vector: `thrust = throttle * thrustMax`.
  - Airspeed delta: `dv = (thrust - drag - mass*g*sin(γ)) / mass * dt`.
  - Stall: if `v < 1.05 * Vs`, force pitch down (`γ -= 0.5 * dt`) and lose altitude (`y -= 5 * dt`).
  - Yaw rate: `ω = g * tan(bank) / max(v, Vs)` (existing formula).
  - Position: `pos += velocityVector * dt` where velocityVector follows pitch + yaw.
- **Pass:** pitch Cessna up at idle throttle → airspeed bleeds → below `1.05 × Vs = 89 km/h` it stalls nose-down. Bank 45° at cruise → airspeed slowly decays unless throttle increased.
- **Commit:** `feat(physics): fixed-wing stall + energy trade + pitch-airspeed coupling`

### Tasks — Session D (input pipeline + HUD additions)

#### P3.T6 — Input pipeline: deadzone, expo, gamepad
- File: [src/drone.js:933-993](src/drone.js:933) and [src/drone.js:1007-1016](src/drone.js:1007)
- New module `src/input.js` exporting `applyDeadzone(v, dz)`, `applyExpo(v, expo)`, `pollGamepad()` returning normalized stick state.
- Wire gamepad: `navigator.getGamepads()` poll each frame; map axes to roll/pitch/yaw/throttle (Mode 2 default: left-Y throttle, left-X yaw, right-Y pitch, right-X roll). Setting in localStorage for Mode 1/2 swap.
- Mouse sensitivity: expose UI slider (settings panel); persist in localStorage.
- **Pass:** plug in an Xbox controller → sticks control aircraft; deadzone hides drift; expo softens center.
- **Commit:** `feat(input): deadzone + expo + gamepad + Mode 1/2 stick mapping`

#### P3.T7 — VSI on HUD
- File: [src/ui.js:1122-1211](src/ui.js:1122)
- Compute `verticalSpeed = (currentY - lastY) / dt` smoothed via EMA (α=0.2).
- Add a small dial or numeric to the HUD: `VS +250 ft/min` (or m/s in metric).
- Optional: dedicated tape on the right side mirroring altitude tape's style.
- **Pass:** climbing 5 m/s shows `VS +984 ft/min` in aero units.
- **Commit:** `feat(hud): vertical speed indicator`

#### P3.T8 — Per-preset spool-up
- File: `src/physics.js` `setSpeedPreset`
- 777 throttle takes 8 s to spool from idle to cruise; Cessna 3 s; Learjet 5 s; Mavic instant. Implement as a target-thrust lerp at preset switch.
- **Pass:** press 4 (777) from rest → audible (visual) acceleration over 30 s, not instant top speed.
- **Commit:** `feat(physics): per-preset throttle spool-up`

#### P3.T9 — Wind model (basic)
- **New file:** `src/wind.js`. Export `currentWind(position, time)` returning `{ vec3, speedMs, dirDeg }`. Simple Perlin-noise based slow variation across Thailand: `wind = baseWind + noiseMagnitude * perlin(x/10000, z/10000, time/60)`.
- Apply wind as constant velocity bias OUTSIDE the flight model: `groundVelocity = airVelocity + wind`.
- HUD: add `WIND 270/12kt` chip.
- Minimap: aircraft icon's track vector (ground velocity) differs from nose vector — draw both. This is the "aha" moment.
- **Pass:** with wind 270/15kt and aircraft heading 360, minimap shows track vector deflected east.
- **Commit:** `feat(physics): wind model with crosswind crab`

### Phase 3 smoke checklist
- [ ] Easy Mode (Hovercraft) still works identically to Phase 0/1/2
- [ ] M → Realistic; Mavic 3 leans forward, accelerates, coasts
- [ ] Artificial horizon reads correctly in DRONE mode
- [ ] Cessna stalls below 89 km/h
- [ ] Cessna in 45° bank bleeds airspeed unless throttled
- [ ] Pitch-up at idle bleeds airspeed
- [ ] Gamepad detected and usable
- [ ] VSI shows in HUD
- [ ] 777 spool-up takes ~8 s
- [ ] Wind chip shows; minimap track ≠ heading in crosswind
- [ ] Global regression checklist (§0.5.2) passes
- [ ] Frame rate ≥45 fps in DRONE mode over Bangkok
- [ ] Phase 3 journal block written; tag `betterment-phase-3-complete` cut

---

# Phase 4 — Active Pedagogy (CAAT failure modes)

> **Goal:** Convert passive HTML rules into felt experiences. Battery, signal-loss, RTH, tiered geofence enforcement, AGL ceiling. This is where the project earns "educational drone simulator" for Thai CAAT contexts.

**Effort:** 1–2 days · **Context budget:** 2 sessions

### Prerequisites
- Phase 3 complete; Realistic mode flyable

### Tasks — Session A (battery + RTH + signal-loss)

#### P4.T1 — Battery model
- **New file:** `src/failures.js`. Class `BatterySystem`.
- State: `pct` (0–100), `voltage` (per cell), `drainRate` (function of throttle & vertical accel).
- Drain rates per preset (calibrated for ~25 min Mavic 3 flight): hover 100%/22 min, cruise 100%/28 min, max-throttle 100%/15 min.
- HUD chip: `BAT 87%` green ≥ 30%, yellow 20–30%, red < 20%.
- Reset on landing (y < 1 for >2 s).
- **Pass:** fly Mavic 3 in DRONE mode for 5 min → battery drops ~20%.
- **Commit:** `feat(failures): battery model with throttle-aware drain`

#### P4.T2 — Return-to-Home state machine
- File: `src/failures.js` `ReturnToHome`.
- Triggered: battery < 25% OR signal lost > 3 s OR user-pressed H key.
- States: `INACTIVE → ASCEND_TO_RTH_ALT (60 m AGL) → FLY_HOME → DESCEND → LANDED`.
- Locks user input during RTH (controllable cancel via H key again).
- HUD ribbon: `⚠ RTH ENGAGED — Returning to launch`.
- **Pass:** at 26% battery, manually press H → drone climbs to 60 m, flies to launch, descends, lands.
- **Commit:** `feat(failures): auto-RTH on low battery / signal loss`

#### P4.T3 — Signal-loss model
- File: `src/failures.js` `RadioLink`.
- Quality drops with distance from launch: `quality = clamp(1 - distanceKm/10, 0, 1)`.
- Add random dropouts (Poisson) when quality < 0.5.
- HUD bars: 5/5 green to 0/5 red.
- On full loss > 3 s: trigger RTH.
- **Pass:** fly Mavic 8 km from launch → bars drop; random dropout → freeze 1–3 s → eventual RTH.
- **Commit:** `feat(failures): radio link quality + lost-link RTH`

### Tasks — Session B (geofence + AGL)

#### P4.T4 — AGL terrain lookup
- **New file:** `src/terrain.js`. Export `elevationAt(lat, lon)` returning ground elevation in meters.
- For Phase 4 MVP, use a coarse baked tile: download SRTM 1° tiles for Thailand (5.6°N–20.5°N, 97.3°E–105.7°E), resample to 30 arc-sec, bake to a single `data/terrain.bin` (Uint16Array, ~3 MB).
- Loader: fetch + parse on app start, store in module-level array, `O(1)` lookup with bilinear sample.
- Export `AGL(position)` = `position.y - elevationAt(worldToGeo(position.x, position.z))`.
- File: [src/ui.js:786](src/ui.js:786) — relabel the 90 m line as AGL and compute correctly.
- **Pass:** Fly Mavic over Doi Inthanon (2 565 m) at AMSL 2 600 m → AGL chip shows 35 m; 90 m line on tape reads relative to ground.
- **Commit:** `feat(terrain): AGL lookup via SRTM-baked grid`

#### P4.T5 — Tiered geofence enforcement
- File: `src/failures.js` `Geofence`.
- For each airspace:
  - Advisory (within 5 NM laterally of CTR/TMA): yellow HUD ribbon, no constraint
  - Authorisation (inside Class D/TMA): clamp altitude to `min(altitude, 120m AGL)`; red HUD ribbon; outline flashes 1 Hz
  - No-fly (Prohibited / military CTR per `MILITARY_CTR_IDS`): freeze at boundary; popup explaining
- Uses existing `airspacesAt` + `MILITARY_CTR_IDS` ([src/airspace.js:27](src/airspace.js:27)).
- **Important bug fix:** decouple visibility filter from membership eval. Even if military airspaces are hidden visually, `airspacesAt` must still evaluate (per [pass3.md bug #11](.scratch/betterment_20260528/pass3.md)). Add `airspacesAtUnfiltered` and use it for geofence.
- **Pass:** fly Mavic toward Bangkok CTR → 5 NM advisory ribbon → entry clamps ceiling to 120 m AGL → red ribbon. Fly toward RTAF area → freeze at boundary.
- **Commit:** `feat(failures): tiered geofence enforcement (advisory/auth/no-fly)`

#### P4.T6 — "Next airspace ahead" prediction chip
- File: [src/ui.js](src/ui.js) HUD
- Project drone velocity forward 30 s, intersect with airspace volumes. Surface ETA + floor/ceiling.
- Uses existing `nearestDistanceTo` ([src/airspace.js:223](src/airspace.js:223)).
- HUD chip: `→ BKK CTR in 24s · floor 0 ceil 11,000ft`
- **Pass:** cruising toward Bangkok at 200 km/h → chip appears with countdown.
- **Commit:** `feat(hud): predictive next-airspace chip with ETA`

### Phase 4 smoke checklist
- [x] Battery chip on HUD; drains during flight
- [x] Battery < 25% triggers RTH; H key triggers manually
- [x] RTH visually flies home and lands
- [x] Signal bars drop with distance from launch
- [x] Long-distance random dropouts trigger RTH
- [x] AGL chip shows correctly over Doi Inthanon
- [x] 90 m line on alt tape is AGL-relative
- [x] CTR entry shows ribbon + ceiling clamp
- [x] Prohibited boundary freezes drone
- [x] Predictive chip appears with ETA when approaching airspace
- [x] Hidden military airspaces still trigger geofence (bug fix verified)
- [x] Global regression checklist passes
- [x] Phase 4 journal block written; tag `betterment-phase-4-complete` cut

---

# Phase 5 — Scale Prep (performance and architecture)

> **Goal:** Make the architecture robust for growth: AABB spatial indexing, baked minimap, shared materials, state machine refactor. These don't change user experience but unlock pan-Indochina datasets and slower devices.

**Effort:** 1–2 days · **Context budget:** 2 sessions

### Prerequisites
- Phase 4 complete

### Tasks

#### P5.T1 — Per-airspace AABB + bounding-box reject
- File: [src/airspace.js:79](src/airspace.js:79) — at compile time, compute `c.aabb = { minX, maxX, minZ, maxZ, lower, upper }`.
- File: [src/airspace.js:443-451](src/airspace.js:443) `airspacesAt`: reject by AABB before `pointInRing`.
- **Pass:** identify ray uses 10× less CPU (measure via Performance Monitor).
- **Commit:** `perf(airspace): per-airspace AABB for fast point-in-volume reject`

#### P5.T2 — Throttle identify ray to 10 Hz
- File: [src/main.js:355-369](src/main.js:355)
- Replace per-frame call with throttle: `if (now - lastIdentifyT > 100) { pickAirspacesAlongRay(...); lastIdentifyT = now; }`.
- **Pass:** identify panel updates feel responsive (10 Hz is imperceptible delay); CPU drop measurable.
- **Commit:** `perf(identify): throttle ray march to 10 Hz`

#### P5.T3 — Analytical ray-vs-prism (optional, larger refactor)
- File: [src/identify.js](src/identify.js)
- Replace marching with closed-form ray-cylinder for circular airspaces, ray-vs-side-quads for polygonal.
- Returns exact entry/exit intervals → enables the predictive chip's accuracy.
- **Pass:** identify finds thin layers (e.g. 100 ft slices) that 800 m march used to miss.
- **Commit:** `perf(identify): analytical ray intersection (replaces marching)`

#### P5.T4 — Bake minimap polygons to offscreen world-canvas
- File: [src/ui.js:1326-1351](src/ui.js:1326)
- Create offscreen canvas 2048×2048 covering visible radar range. Paint 144 polygons once.
- Per frame: `drawImage` with transform `translate(cx,cy); scale(1/SCALE); translate(-wx,-wz)`.
- Repaint offscreen only on: filter change, highlight change, pan > 50 km.
- **Pass:** minimap visually identical; Performance Monitor shows minimap CPU near zero.
- **Commit:** `perf(minimap): bake static polygons to offscreen canvas`

#### P5.T5 — Share airspace materials by `(category, highlight)`
- File: [src/airspace.js:131-189](src/airspace.js:131)
- Build a static `MATERIAL_POOL = { CTR_normal, CTR_highlight, TMA_normal, ... }` at module load.
- Each airspace mesh references the pooled material rather than creating its own.
- Highlight = swap material reference, not mutate opacity.
- **Pass:** draw call count drops from ~2500 to ~50.
- **Commit:** `perf(airspace): share materials across airspaces by category`

#### P5.T6 — Lazy-build ExtrudeGeometry on first highlight
- File: [src/airspace.js:165-170](src/airspace.js:165)
- Don't build hidden extrude meshes at load. Build on first `setHighlighted(true)`.
- **Pass:** load time drops 200–500 ms; first highlight has a one-time ~20 ms jank (acceptable).
- **Commit:** `perf(airspace): lazy-build extrude geometry on first highlight`

#### P5.T7 — Explicit `SimMode` state machine
- **New file:** `src/simMode.js`. Export `SimMode = 'free' | 'flyingTo' | 'touring' | 'paused' | 'replay'`.
- Replace the boolean tangle (`flightLocked`, `paused`, `tour.isRunning`, `flyTo.active`) with one enum + transitions.
- Each transition validated; illegal transitions throw (e.g. you can't `paused → flyingTo`, must go via `free`).
- **Pass:** all existing UX still works; bugs in mode-transition (e.g. tour-end leaves paused state stuck) are fixable in one place.
- **Commit:** `refactor(mode): explicit SimMode state machine`

#### P5.T8 — Dynamic DPR reduction on slow frames
- File: [src/main.js:30](src/main.js:30)
- Track rolling average `dt`; if > 25 ms for 2 consecutive frames → halve DPR; if < 15 ms for 30 consecutive → restore.
- **Pass:** on a deliberately throttled CPU (DevTools 4× slowdown), DPR drops and frame rate recovers.
- **Commit:** `perf(viz): dynamic DPR reduction under frame pressure`

### Phase 5 smoke checklist
- [ ] All perf improvements measurable in Performance Monitor
- [ ] Identify mode CPU drop ≥5×
- [ ] Minimap CPU near zero
- [ ] Draw calls reduced significantly
- [ ] Load time improvement noted
- [ ] State machine transitions all legal flows; illegal blocked
- [ ] Slow-CPU test: DPR adapts
- [ ] Global regression checklist passes
- [ ] No new bugs introduced
- [ ] Phase 5 journal block written; tag `betterment-phase-5-complete` cut

---

# Phase 6 — Polish & Misc Bug Fixes

> **Goal:** Land the remaining low-priority bugs and visual polish items from the report.

**Effort:** ½ day

### Tasks

#### P6.T1 — Fix `identifyLabelsGroup` never populated bug
- File: [src/airspace.js:418](src/airspace.js:418)
- Wire `_ensureIdentifyLabel` call into `setHighlighted` path so identify-mode floating sprites actually appear.
- **Commit:** `fix(airspace): populate identifyLabelsGroup on highlight`

#### P6.T2 — Colorblind-safe airspace hatching
- File: [src/airspace.js:7-14](src/airspace.js:7)
- Add diagonal hatch on Prohibited, dots on Restricted via canvas-texture diffuse map on fill material.
- **Commit:** `feat(airspace): colorblind-safe pattern overlays`

#### P6.T3 — Mobile/touch path gating
- File: [src/main.js:312-323](src/main.js:312)
- On touch-only device, block renderer init unless user dismisses warning AND requests "Try anyway".
- **Commit:** `fix(main): gate simulator on touch-only devices`

#### P6.T4 — Remaining dead code removal
- `layoutIdentifyLabels` ([src/identify.js:30-60](src/identify.js:30)) — remove or wire up
- Unused `yaw` in [src/main.js:194](src/main.js:194) — remove
- `setSpeedMultiplier` stub if unused after P1.T11 — remove
- **Commit:** `chore(cleanup): remove dead code paths`

#### P6.T5 — Vantage point FOV param fix
- File: [src/airspace.js:531](src/airspace.js:531)
- Pass FOV through to `overviewVantage`.
- **Commit:** `fix(airspace): vantagePoint propagates FOV parameter`

#### P6.T6 — Heading-compass wrap fix
- File: [src/ui.js:1163-1166](src/ui.js:1163)
- Use numeric comparison with epsilon, not `toFixed(2)` string compare.
- **Commit:** `fix(hud): heading compass redraws across 360°→0° wrap`

#### P6.T7 — Subtle artificial horizon bezel wash
- File: [src/ui.js:990-991](src/ui.js:990)
- 10% black wash inside bezel for contrast against bright sky.
- **Commit:** `feat(hud): subtle bezel wash on artificial horizon`

#### P6.T8 — Tour-end state cleanup
- File: [src/main.js:257-265](src/main.js:257)
- `tour.onStop` should restore `drone.paused` to pre-tour state, not unconditionally `false`.
- **Commit:** `fix(tour): preserve paused state across tour lifecycle`

### Phase 6 smoke checklist
- [ ] Identify-mode 3D sprites now appear
- [ ] Colorblind hatching renders on Prohibited / Restricted
- [ ] Touch-only devices show blocking warning
- [ ] Dead code removed; no console warnings
- [ ] Heading compass smooth across 0°/360° wrap
- [ ] Final global regression passes
- [ ] Tag `betterment-phase-6-complete` cut

---

# Phase 7 — Documentation & Release

> **Goal:** Update user-facing docs to reflect new features, especially Easy Mode and Realistic Mode.

#### P7.T1 — Update README with new modes table
- Document Easy Mode (Hovercraft), Realistic Mode (Drone / Airplane)
- New controls table
- Battery / RTH / Geofence section
- Gamepad section

#### P7.T2 — Update spec.md with implementation notes
- Reference physics model parameters
- Reference Sky shader choice
- Reference terrain data source (SRTM)

#### P7.T3 — Final journal closeout
- Write a summary block at the top of `20260528_journal.md`
- Tag `betterment-complete`

#### P7.T4 — Create PR
- `gh pr create` with title `Betterment 2026-05-28: Easy Mode + real physics + atmosphere`
- Body: link to BettermentReport.md and BettermentPlaybook.md, list of phase tags, smoke results

---

## §A — Bootstrap content for 20260528_todo.md

Use this as the literal initial content of [20260528_todo.md](20260528_todo.md). Created in P0.T1.

```
# Betterment 2026-05-28 — Task Tracker

> Single source of truth for task state. See 20260528_BettermentPlaybook.md for details.
> Tick `[x]` ONLY when commit landed AND Pass Criterion verified via smoke checklist.

## Phase 0 — Foundation: Mode Architecture + Hovercraft (Easy Mode)
- [ ] P0.T1 — Cut branch + bootstrap tracking files  [S]
- [ ] P0.T2 — Capture baseline screenshots and perf snapshot  [S]
- [ ] P0.T3 — Add explicit FlightMode enum and central dispatcher  [M]
- [ ] P0.T4 — Refactor Drone._updateFree into _updateHovercraft  [M]
- [ ] P0.T5 — UI mode badge in HUD + EASY MODE indicator  [S]
- [ ] P0.T6 — Hotkey M to toggle Easy Mode ↔ Realistic  [S]
- [ ] P0.T7 — Hovercraft tuning: precision modifier  [S]
- [ ] P0.T8 — Onboarding tip: Press M for Realistic  [S]
- [ ] Phase 0 smoke checklist (see playbook §Phase 0)
- [ ] Tag: betterment-phase-0-complete

## Phase 1 — Stop the Embarrassment
- [ ] P1.T1 — Per-preset boost cap  [S]
- [ ] P1.T2 — Hoist Vector3 scratch  [S]
- [ ] P1.T3 — Precompute minimap CSS color strings  [S]
- [ ] P1.T4 — LRU cap on MinimapTileCache  [S]
- [ ] P1.T5 — Dispose material.map on tile disposal  [S]
- [ ] P1.T6 — Pause rAF on document.hidden  [S]
- [ ] P1.T7 — Tighten fog distances  [S]
- [ ] P1.T8 — Element-ref caching in updateHUD  [S]
- [ ] P1.T9 — Empty-filter shortcut in airspace list  [S]
- [ ] P1.T10 — Cache canvas gradients for HUD  [S]
- [ ] P1.T11 — Fix legacy speedMultiplier restoration  [S]
- [ ] P1.T12 — Fix restore() cameraMode/teleport ordering  [S]
- [ ] Phase 1 smoke checklist
- [ ] Tag: betterment-phase-1-complete

## Phase 2 — Atmosphere Weekend
- [ ] P2.T1 — Three.js Sky dome + sun disc  [M]
- [ ] P2.T2 — ACES tonemap + altitude-driven fog  [M]
- [ ] P2.T3 — Animate props, control surfaces, nav lights  [L]
- [ ] P2.T4 — Switch to Carto Positron basemap  [S]
- [ ] P2.T5 — Thai city beacon sprites  [M]
- [ ] P2.T6 — Province boundary LineSegments overlay  [M]
- [ ] P2.T7 — Shaded translucent airspace walls  [L]
- [ ] P2.T8 — Depth-aware label fade + top-N cap  [M]
- [ ] Phase 2 smoke checklist
- [ ] Tag: betterment-phase-2-complete

## Phase 3 — Real Flight Model
- [ ] P3.T1 — Fixed-step physics substep  [M]
- [ ] P3.T2 — RigidBody + Quadrotor + FixedWing scaffolding  [L]
- [ ] P3.T3 — Quadrotor attitude controller for Mavic 3  [L]
- [ ] P3.T4 — Attitude indicator becomes meaningful  [S]
- [ ] P3.T5 — Fixed-wing stall + energy trade  [L]
- [ ] P3.T6 — Input pipeline: deadzone + expo + gamepad  [L]
- [ ] P3.T7 — VSI on HUD  [S]
- [ ] P3.T8 — Per-preset spool-up  [S]
- [ ] P3.T9 — Wind model  [M]
- [ ] Phase 3 smoke checklist
- [ ] Tag: betterment-phase-3-complete

## Phase 4 — Active Pedagogy
- [ ] P4.T1 — Battery model  [M]
- [ ] P4.T2 — Return-to-Home state machine  [M]
- [ ] P4.T3 — Signal-loss model  [M]
- [ ] P4.T4 — AGL terrain lookup via SRTM  [L]
- [ ] P4.T5 — Tiered geofence enforcement  [L]
- [ ] P4.T6 — Predictive next-airspace chip  [M]
- [ ] Phase 4 smoke checklist
- [ ] Tag: betterment-phase-4-complete

## Phase 5 — Scale Prep
- [ ] P5.T1 — Per-airspace AABB  [S]
- [ ] P5.T2 — Throttle identify ray to 10 Hz  [S]
- [ ] P5.T3 — Analytical ray-vs-prism  [L]
- [ ] P5.T4 — Bake minimap polygons offscreen  [M]
- [ ] P5.T5 — Share airspace materials  [M]
- [ ] P5.T6 — Lazy-build ExtrudeGeometry  [S]
- [ ] P5.T7 — Explicit SimMode state machine  [L]
- [ ] P5.T8 — Dynamic DPR reduction  [M]
- [ ] Phase 5 smoke checklist
- [ ] Tag: betterment-phase-5-complete

## Phase 6 — Polish & Misc Bugs
- [ ] P6.T1 — Fix identifyLabelsGroup population  [S]
- [ ] P6.T2 — Colorblind hatching  [M]
- [ ] P6.T3 — Mobile/touch gating  [S]
- [ ] P6.T4 — Remove dead code  [S]
- [ ] P6.T5 — vantagePoint FOV fix  [S]
- [ ] P6.T6 — Heading compass wrap fix  [S]
- [ ] P6.T7 — Artificial horizon bezel wash  [S]
- [ ] P6.T8 — Tour-end paused-state cleanup  [S]
- [ ] Phase 6 smoke checklist
- [ ] Tag: betterment-phase-6-complete

## Phase 7 — Documentation & Release
- [ ] P7.T1 — Update README with new modes  [M]
- [ ] P7.T2 — Update spec.md  [M]
- [ ] P7.T3 — Final journal closeout  [S]
- [ ] P7.T4 — Create PR  [S]
- [ ] Tag: betterment-complete
```

---

## §B — Bootstrap content for 20260528_journal.md

Use this as the literal initial content of [20260528_journal.md](20260528_journal.md). Created in P0.T1.

```
# Betterment 2026-05-28 — Session Journal

> Append-only log of every implementation session.
> Read the last block to resume.
> See 20260528_BettermentPlaybook.md §0.6 for block format.

─────────────────────────────────────────────────────────────────────
## Session 2026-05-28 — bootstrap (operator)
**Phase:** Pre-flight
**Tasks attempted:** N/A (playbook + tracking files created)
**Tasks completed:** N/A
**Start HEAD:** <to be filled when bootstrap commit lands>
**End HEAD:** <to be filled>

**What I did:** Created 20260528_BettermentReport.md, 20260528_BettermentPlaybook.md,
20260528_journal.md (this file), and 20260528_todo.md to bootstrap the betterment work.

**Next action (for next session):** Run P0.T1 — cut branch betterment-20260528 and
commit the four bootstrap files. Then proceed sequentially through Phase 0.

**STATUS:** READY_TO_START
─────────────────────────────────────────────────────────────────────
```

---

## §C — Running the app locally (Phase 0+)

The project is vanilla JS — no build step. Serve `index.html` over HTTP (file:// breaks ES modules and tile CORS).

```
# From the project root
python3 -m http.server 8080
# or
npx http-server -p 8080
```

Open http://localhost:8080 . Hit F12 for DevTools; Performance tab for profiling; Network tab for tile attribution check.

---

## §D — When in doubt

- **You don't know whether to commit:** commit. The branch is cheap to rewind.
- **A task is bigger than expected:** stop. Write a CHECKPOINT block. The next session will pick up.
- **You found a bug not in the report:** add it to `20260528_todo.md` under a "Discovered" section. Don't fix mid-task.
- **The smoke check is ambiguous:** write what you observed in the journal. The operator can clarify.
- **You're tempted to refactor surrounding code:** stop. Refactors belong to their own commit, ideally with operator buy-in.
- **The visual diff has unexpected differences:** screenshot, journal, then decide. Some Phase 2 changes are intentional regressions to the baseline.

The bones are good. The roadmap is clear. Go phase by phase, commit by commit, journal at each session boundary. The work compounds.
