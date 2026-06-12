# Shebang Playbook — Betterment-7 (Sky Guardian foundation + first playable)

**Companion to:** `20260611_ShebangReport.md` (strategy/design), `spec.md` (§3.16 to be written in B7.T10), `journal.md`.
**Audience:** Sonnet 4.6 subagent sessions implementing tasks, orchestrated by a Fable/Opus main session.
**Status:** design locked (report Part 3), **implementation pending**.
**Branch:** `betterment2-20260529` (or a new `betterment7-20260612` cut from it — orchestrator's call at kickoff).

This playbook is **stop-and-resume safe**: every task ends at an atomic commit; any fresh session resumes from `journal.md` (last block) + `state_TODO.md` (first unchecked) + this file's matching task.

---

## 0. Operator protocol (read every session start)

Follow the canonical protocol in `CLAUDE.md §1` and `20260528_BettermentPlaybook.md §0` (session open/close, atomic conventional commits). Global regression checklist (`20260528_BettermentPlaybook.md §0.5.2`) applies at every checkpoint.

**Serve & verify:** `python3 -m http.server 8080` from repo root → `http://localhost:8080`. Per touched file: `node --check src/<file>.js`. Per checkpoint: browser console clean + the smoke list below.

**Hard rule — game off = pixel-identical:** with the game mode never entered (and the start screen dismissed via Explore), the sim must render and behave **identically to pre-B7** (modulo the perf fixes, which must be visually invisible). Capture a baseline screenshot before T1; diff at each checkpoint.

**Scope discipline:** one task per dispatch. No refactors, no docstrings on untouched code, no extra features. Tempting improvements → new row in `state_TODO.md`.

### 0.1 Model orchestration protocol

| Role | Model | Duties |
|---|---|---|
| **Orchestrator** (main session) | Fable 5 (or Opus 4.8) | Dispatch one subagent per task with the task's contract pasted verbatim + relevant report excerpt; review the diff after each task; run browser verification at checkpoints C1–C3; gate the next dispatch; write the journal block at session end. |
| **Executor** (per-task subagent) | **Sonnet 4.6** | Implement exactly the task contract; run `node --check` on every touched file; self-verify the task Pass criterion (console/REPL where specified); commit with the specified message. |
| **Escalation** | Fable 5 | If a task fails its Pass criterion **twice** under Sonnet, the orchestrator implements it directly in the main session. Pre-flagged escalation risks: **T7** (input suppression) and the `main.js` loop wiring in **T4**. |

Rules:
- Executors never start the dev server or do browser verification — that is orchestrator work at checkpoints (keeps executor context small and cheap).
- Executors receive: this file's §0 + their single task section + the cited source lines. Not the whole report.
- Do **not** route tasks to Haiku: the frame-loop and input code here fails subtly, and retry cost exceeds the savings.
- Sequential execution by default (T1→T10); `main.js` and `index.html` are shared touch-points, so no parallel dispatch without worktree isolation.

### 0.2 Checkpoints (orchestrator browser smoke)

- **C1** after T3 — perf block done. Baseline screenshot diff = none; debug overlay numbers recorded before/after in journal.
- **C2** after T8 — SCRAMBLE-lite playable end-to-end.
- **C3** after T9 — start screen + full regression checklist, then T10 docs.

---

## Phase Betterment-7 — Foundation + First Playable (SCRAMBLE-lite)

**Goal (Pass Criterion for the phase):** From a fresh load, a player can press **Play**, hear-nothing-but-see an ATC radio message naming a real airspace, travel there (autopilot or manual), type the airspace's name to banish an orbiting UFO, and see a score that persists across reload — at ≥ the pre-B7 framerate, with the sim pixel-identical when the game is off.

**Persistence keys:** `kuson.game.v1` (score/medals), `kuson.start.v1` (start-screen choice).
**New files live under `src/game/`** (+ `src/debugOverlay.js`); the educational core stays untouched except for explicit wiring points listed per task.

### B7.T1 — Debug overlay (instrument before optimizing) — model: sonnet
- New `src/debugOverlay.js`: `installDebugOverlay(renderer)` → tiny fixed-position DOM panel (monospace, top-right, hidden by default) showing `renderer.info.render.calls`, `.triangles`, `renderer.info.memory.geometries/.textures`, programs count, and a 30-frame rolling FPS. Toggle on backquote/`~` keydown (ignore when a text input is focused). Update its DOM **only while visible**, max every 250 ms.
- Wire in `src/main.js`: instantiate after renderer creation (renderer config at `main.js:171–185`); call its `update()` in the render loop.
- **Pass:** `~` toggles the panel; numbers move when flying; with panel hidden, no per-frame DOM writes (verify: no `update` body work when `!visible`). `node --check` clean.
- **Commit:** `feat(debug): renderer.info overlay on backquote toggle`

### B7.T2 — Label texture pooling/dedup (report P1) — model: sonnet
- `src/airspace.js`: `makeTextSprite` (~line 253; label creation ~303–324) — cap label canvas size to the smallest power-of-two fitting the text (measure first, don't default 512×256), and share one offscreen measuring canvas module-wide.
- `src/liveFlights.js`: `_flightLabel()` (~855–908) — key a texture cache on the exact rendered string(s); identical callsign+data rows reuse one CanvasTexture; dispose cache entries when their last flight despawns.
- **Pass:** record `renderer.info.memory.textures` via the T1 overlay before/after with live flights ON: count drops (note both numbers in the commit body). Labels visually identical at normal zoom (screenshot diff). No texture-count creep after 2 minutes of flight spawn/despawn.
- **Commit:** `perf(labels): right-size + dedup label canvas textures`

### B7.T3 — Material pool + label-scale early-exit (report P2+P3) — model: sonnet
- `src/airspace.js:369–372`: make `WALL_MAT_POOL` real — patterned wall materials keyed by `(category, pattern)`; all airspaces of the same key share one material instance. Verify highlight path still works (highlight uses the shared `WALL_MAT_HIGHLIGHT`, not per-mesh state — if per-mesh emissive/opacity mutation is found, switch highlight to mesh-level material *swap*, not clone).
- `src/main.js:617–623` + each layer's `updateLabelScales`: skip entries with `visible === false` before any distance math.
- **Pass:** programs/material count in overlay drops vs T2 baseline (record numbers); toggling a group off measurably reduces label-scale work (acceptable proxy: no errors + counts recorded); B5 group toggles + identify highlight still work (orchestrator re-checks at C1).
- **Commit:** `perf(render): pool patterned wall materials + skip hidden labels in scale pass`

### B7.T4 — Game-mode FSM (`src/game/gameMode.js`) — model: sonnet (escalation-watch: main.js wiring)
- New module exporting `class GameMode` with states `IDLE → BRIEFING → WAVE → DEBRIEF` (string field + `enter(state)` guard table; illegal transitions throw in console, never crash). API: `start()`, `abort()`, `update(dt, telemetry)`, `on(event, cb)` (tiny emitter). In `IDLE`, `update()` returns immediately.
- Wire in `src/main.js`: construct once with `{airspaceLayer, flyTo, alerts, dronePos accessor}`; call `game.update(dt, …)` in the render loop **after** `drone.update(dt)`; expose as `window.__sim.game`.
- No UI yet; state changes observable via `window.__sim.game.state`.
- **Pass:** in the browser console, `__sim.game.start()` → state `BRIEFING`; `abort()` → `IDLE`; with state `IDLE` for 2 min, baseline behavior unchanged. `node --check` clean.
- **Commit:** `feat(game): GameMode FSM wired into main loop (inert when idle)`

### B7.T5 — ATC radio + message log (`src/game/atc.js`) — model: sonnet
- Add a `RADIO` tier to the alert queue (`src/alerts.js:15–99` — slot priority below safety alerts like NO_FLY, above ADVISORY) so safety messaging always outranks game chatter.
- New `src/game/atc.js`: `class AtcRadio { call(spec) }` where `spec = {airspaceId, count, kind}` → resolves the record from the airspace layer (record shape per `data/airspaces.json`; world pos via `geoToWorld(center)` from `src/coords.js`), computes bearing/distance from the player, renders the template: `"{n} contact(s) — {shortName}, bears {brg}° for {nm} nm, angels {kft}"`, publishes via `alerts.publish({key:'radio.'+seq, tier: RADIO, message})` **and** appends to a message log.
- Message log UI: new collapsible "📻 Radio" section in the right panel (clone the collapsible pattern, `index.html:488–495` styles + existing `ui.js` section builders); last 20 messages, newest on top, timestamped `HH:MM:SS`.
- **Pass:** console `__sim.game.atc.call({airspaceId:'VTBD-CTR', count:1})` → banner shows + log entry with plausible bearing/nm given current player position (orchestrator sanity-checks one bearing by eye on the minimap at C2); safety alert (fly into a no-fly) still preempts the banner.
- **Commit:** `feat(game): ATC radio tier, call grammar, and radio log panel`

### B7.T6 — UFO entity layer (`src/game/ufo.js`) — model: sonnet
- New `class UfoLayer { spawnAt(airspaceId), banish(id), update(dt, camera), dispose() }`, lifecycle cloned from the liveFlights pattern (`src/liveFlights.js` — spawn/ease/despawn-fade/dispose; constants at lines 24–28 are the reference). Mesh: reuse/restyle the existing UFO preset factory from `src/drone.js` (model factories ~850–1400), scaled ~30 m, plus a slow-pulse emissive glow (color = the violated airspace's category color, per report §3.0 visual continuity).
- Behavior v1: orbit the airspace centroid at `(lowerFt+upperFt)/2` AMSL, radius ~2 km, constant angular rate; gentle bob. `banish(id)` → 0.6 s scale-up + fade → full dispose (geometry + material traversal, as liveFlights despawn does).
- **Pass:** console `__sim.game.ufos.spawnAt('VTBD-CTR')` → saucer orbits over Bangkok at mid-band altitude; `banish(...)` plays the effect; after banish, overlay geometry/texture counts return to pre-spawn values (no leak).
- **Commit:** `feat(game): UFO entity layer — spawn/orbit/banish over airspaces`

### B7.T7 — Typing capture modal (`src/game/typing.js`) — model: sonnet, **escalate to Fable on 2nd failure**
- **First, locate the existing pilot-input suppression mechanism** that tour/fly-to already use (fly-to locks the drone — `src/flyto.js:15–72`; `src/modes.js` notes tour/fly-to suppress pilot input). Reuse that exact flag/path; do **not** invent a parallel one.
- New `class TypingChallenge { open({prompt, answers, timeoutS, onResolve}) }`: centered modal card; while open → pilot input suppressed via the located mechanism, pointer lock released, **all** game-relevant keydowns (`w a s d q e i k p m space`) swallowed before flight handlers (capture-phase listener on `window`).
- Matching: case-insensitive, collapse whitespace/hyphens, strip diacritics; accept either `id` (`VTBD-CTR`) or `shortName` (`Bangkok CTR`). Per-glyph render: typed-correct green, typed-wrong red, untyped dim. Enter resolves `{correct, elapsedS, accuracy}` (accuracy = 1 − wrongKeystrokes/totalKeystrokes); Esc resolves `{correct:false, cancelled:true}`. Track WPM.
- **Pass:** with modal open, holding W does not move the aircraft and I does not toggle identify; typing `bangkok ctr` for `VTBD-CTR` resolves correct; Esc cancels and flight keys work again instantly; opening/closing 10× leaves no duplicate listeners (verify via `getEventListeners` or a listener count guard).
- **Commit:** `feat(game): typing challenge modal with hard flight-input suppression`

### B7.T8 — SCRAMBLE-lite loop + score + persistence (`src/game/scramble.js`, `src/game/score.js`) — model: sonnet
- `scramble.js`: wave script v1 = 3 contacts drawn randomly from **CTR + TMA groups only** (use `groupKeyFor` from B5, `src/airspace.js`). Per contact: `atc.call(...)` → `ufos.spawnAt(...)` → wait until player inside the volume (`airspacesAt(x,y,z)`, `src/airspace.js:709–719`, checked ≤ 2 Hz, not per-frame) → auto-open typing challenge → correct ⇒ `banish` + score; timeout (90 s Cadet) ⇒ contact "lost", airspace outline pulses red 10 s (reuse highlight path), next contact. Offer an **Autopilot** button on the radio banner (Cadet only): `flyTo.start(overviewVantage(airspaceId))` (`src/flyto.js:15–72`, `src/airspace.js:859–902`).
- `score.js`: `base 100 × (1 + speedBonus) × accuracy`, streak ×1.1 per consecutive ID; persist `{bestScore, wavesPlayed, airspacesIdentified:{id:count}}` to `kuson.game.v1` (guarded JSON merge-with-defaults, pattern of `src/simState.js:9–35`).
- Wire `gameMode`: `start()` → BRIEFING (simple card: "3 contacts inbound — press Enter") → WAVE runs scramble → DEBRIEF card (score, accuracy, WPM, list of airspaces seen) → Enter → IDLE.
- **Pass (orchestrator at C2):** full 3-contact wave playable start→debrief; score persists across reload; abort mid-wave returns to clean IDLE (UFOs disposed, input free, no orphan timers).
- **Commit:** `feat(game): SCRAMBLE-lite wave loop, scoring, and persistence`

### B7.T9 — Start screen (report O1) — model: sonnet
- Replace the bare loading div (`index.html:723`) with: Thailand-silhouette splash (inline SVG, CSS only — no asset fetch), a real progress bar driven by the existing data-load promises in `main.js` (airspaces, tour, airports, terrain = 4 ticks + first tile = 5th), then three buttons: **🗺 Explore** (dismiss → current behavior), **🎓 Tour** (dismiss → start EXPRESS tour via the existing `tourGuide.start`), **🛸 Play** (dismiss → `__sim.game.start()`). Keyboard: 1/2/3 + Enter (last choice highlighted from `kuson.start.v1`).
- The screen must be purely additive: if its JS fails, a `try/catch` falls through to dismissing it (sim must never be blocked by the splash).
- **Pass:** hard-reload → progress fills with real loads → Explore yields the pre-B7 experience exactly; Tour starts the express tour; Play enters BRIEFING; choice persists as the highlighted default.
- **Commit:** `feat(ui): start screen — progress + Explore/Tour/Play`

### B7.T10 — Spec + docs + ticks — model: sonnet
- Write `spec.md §3.16 Game Mode: Sky Guardian (Betterment-7)`: FSM states, ATC grammar, typing-match rules, scoring formula, persistence keys, the "game off = identical" invariant, RADIO tier placement. Add ~8 acceptance rows to §6 (radio fires with bearing; autopilot honors lockouts; typing suppresses flight input; banish disposes cleanly; score persists; start screen fall-through; safety alerts outrank RADIO; IDLE = no-op).
- Append the journal block (include T2/T3 before/after overlay numbers); tick `state_TODO.md` rows only for browser-verified passes.
- **Commit:** `docs: spec §3.16 Sky Guardian + B7 journal/TODO`

**Phase B7 smoke checklist (orchestrator, C3):**
- [ ] Game never started → screenshot diff vs pre-B7 baseline = none (post-splash).
- [ ] Full SCRAMBLE wave: radio → travel → type → banish → debrief → score persisted.
- [ ] Typing modal: zero flight-key bleed-through, zero stuck-input after close.
- [ ] Overlay numbers: textures and programs strictly lower than pre-T2 baseline; FPS ≥ baseline with 3 UFOs active.
- [ ] Abort mid-wave from every state → clean IDLE, no console errors over 2 min.
- [ ] `node --check` clean on every touched file; conventional commits, one per task.

---

## Phases B8–B10 (sketch — expand into task contracts when reached)

- **B8 — SCRAMBLE complete + Sound:** `src/audio.js` (speechSynthesis ATC voice + radio chirp, engine loop, stall horn at 1.1·Vs, alert tones), difficulty tiers (Cadet/Pilot/Ace per report §3.3), full wave/combo system, 60-s interactive tutorial (reuses tour overlay + flyto + identify), progressive HUD. *Model: sonnet executors; Fable writes the audio-graph design note first.*
- **B9 — INTERCEPT:** `src/game/weapons.js` hitscan + tracer/spark pools, UFO EVADE/ATTACK behaviors, ground crawlers vs airport beacons, identify-then-engage combined mode, airspace frustum culling + trail buffer reuse (report P4–P5). *Model: sonnet; Fable reviews the hit-detection math.*
- **B10 — World beauty:** terrain relief from `data/terrain.bin` displacement, day/night + night city lights, water shader, wind-by-altitude + crosswind HUD, G-limits. *Model: Fable designs the terrain-displacement approach (one task), sonnet executes the rest.*

---

## Cross-phase verification (before tagging B7 complete)
- Global regression checklist (`20260528_BettermentPlaybook.md §0.5.2`).
- B5 group toggles, B6 ground layers, live flights, tour, identify — all still pass their own smoke lists.
- Browser console clean across a 2-minute mixed session (game on, then aborted, then explore).
- Journal block appended; `state_TODO.md` ticked; both pushed.
