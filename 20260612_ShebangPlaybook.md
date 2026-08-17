---
id: 20260612_ShebangPlaybook
title: Shebang Playbook — Betterment-7 (Sky Guardian foundation + first playable)
class: spec
version: 1.0.0
status: active
updated: 2026-06-12
owner: kuson
applies_to: []
supersedes: []
superseded_by: []
---
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

## Phase Betterment-8 — SCRAMBLE complete + Sound (expanded 2026-06-12, Fable)

**Goal (Pass Criterion for the phase):** The sim is no longer silent — engine, warnings, ATC voice, and game SFX all play (procedural Web Audio, zero asset files, all user-toggleable); SCRAMBLE has Cadet/Pilot/Ace tiers and escalating waves; a first-time player gets a 60-second interactive tutorial and a minimal HUD; airspace volumes get a subtle fresnel edge-glow. Audio off / fresh-profile off ⇒ pre-B8 behavior. New persistence: `kuson.audio.v1`, `kuson.hud.v1`; `kuson.game.v1` gains `{difficulty, waveReached}`.

### §B8.0 Audio-graph design note (orchestrator-authored — binding)
```
AudioContext (lazy; resume() on startScreen activation + every pointerdown/keydown until "running")
 └─ masterGain  (volume+mute from kuson.audio.v1; 0 when muted)
     ├─ engineBus (gain; ducked ×0.4 with 150 ms ramps while ATC voice speaks)
     │    prop  (Mavic/C172): saw osc 55→110 Hz by throttle + sine sub (f/2) → lowpass 900 Hz
     │    jet   (Lear/777):   looped white-noise buffer → bandpass 600→2400 Hz by throttle + sine 60 Hz rumble
     │    hover/UFO (Easy):   triangle 140 Hz + 0.5 Hz LFO on gain (soft hum)
     ├─ sfxBus  — stall horn (square 800 Hz gated 4 Hz), alert tones by tier
     │            (safety = urgent triple beep · RADIO = squelch chirp · ADVISORY = single soft ping),
     │            game SFX (glyph tick, ID-lock sweep, banish whoosh+bell, contact-lost descend, score chime)
     └─ (voice = speechSynthesis, outside Web Audio; ducks engineBus via gain automation)
Rules: engine chain rebuilt ONLY on (flightMode|presetId) change; per-frame work = AudioParam updates only
(no node churn, no allocation). All buses created once. document hidden → ctx.suspend(), visible → resume().
```

### B8.T1 — Audio core: engine module, alert tones, settings (`src/audio.js`) — model: sonnet
- `installAudio()` → `{update(dt, droneState), play(name), say(text), setVoiceEnabled, unlock(), dispose}` implementing §B8.0 graph skeleton + tone library (`play("lockSweep")` etc. — implement: alertSafety, alertRadio, alertAdvisory, tick, lockSweep, banish, lost, chime). Settings `get/setAudioSettings` (`kuson.audio.v1`, `{volume: 0.7, muted: false, voice: true}`, guarded merge per `simState.js` pattern).
- Subscribe to the alert queue (`alerts.subscribe(fn)`, alerts.js:65): on each NEW key entering the active set, play its tier tone (map by `tier.id`; track seen keys to avoid re-fire on re-publish).
- Settings UI: "Sound" block in Display options (volume slider + Mute + Voice checkboxes), wired + persisted, matching `.opt` idiom.
- main.js: instantiate; `audio.unlock()` wired into startScreen `ready` handlers + capture pointerdown/keydown fallback; `_safe("audio", () => audio.update(dt, droneStateForAudio()))` in the loop; expose `window.__sim.audio`.
- **Pass:** `node --check` clean; with ctx running, publishing a RADIO alert fires the chirp (verifiable: `__sim.audio` exposes `_lastPlayed` debug field); volume/mute persist across reload; muted ⇒ masterGain 0.
- **Commit:** `feat(audio): procedural audio core — buses, alert tones, settings`

### B8.T2 — Engine loop + stall horn + buffet (`src/audio.js`, `src/drone.js` read-only state, `src/main.js`) — model: sonnet
- `droneStateForAudio()` in main.js: `{mode (easy|drone|airplane|ufo), presetId, throttle (fixedwing.throttle or climb proxy), airspeedMs, Vs, stalled}` — read from `drone` + `drone._fixedwing` (physics.js:292/385 fields; Vs per preset, physics.js:210–220).
- Engine synth per §B8.0; smooth param ramps (≥50 ms) so preset switches don't click. Stall horn: airplane realistic mode, `airspeedMs < 1.1·Vs` → gated square; stops immediately above threshold or on mode change.
- Buffet: same band → `drone` camera shake hook — add a tiny `this.buffetT` driven offset (±0.15° pitch jitter at 9 Hz) inside the existing camera sync (find `_syncCamera`); zero when audio muted? NO — buffet is physics feedback, independent of audio mute.
- **Pass:** engine pitch/gain track throttle changes (assert AudioParam values via `__sim.audio` debug getters at two throttle settings); horn gates on/off across the 1.1·Vs boundary (drive `__sim.drone._fixedwing.airspeedMs` in console); no node creation in `update` (code-inspect).
- **Commit:** `feat(audio): per-preset engine loop + stall horn + buffet shake`

### B8.T3 — ATC voice (`src/audio.js`, `src/game/atc.js`) — model: sonnet
- `say(text)`: speechSynthesis, rate 1.05, pitch 0.9, prefer en-GB/en-US voice (voices load async — re-query on `voiceschanged`); cancel-queue policy: new radio call cancels any still-pending utterance; squelch chirp before, click after; engineBus duck ×0.4 during utterance (150 ms ramps, restore on `end`/`error`).
- atc.js: after publishing, call `this._audio?.say(message)` (inject audio handle via constructor deps from main.js — optional dep, null-safe). Voice toggle from settings gates `say()` entirely.
- gameMode: say wave-start ("Scramble, scramble, scramble — {n} contacts inbound") and debrief ("Wave complete — {score} points") lines.
- **Pass:** `say` fires utterance when voice on (assert `speechSynthesis.pending/speaking` or a `_lastUtterance` debug field), silent + no errors when off; radio text always lands in the log regardless.
- **Commit:** `feat(audio): speech-synthesis ATC voice with engine ducking`

### B8.T4 — Game SFX wiring (`src/game/typing.js`, `src/game/scramble.js`, `src/game/gameMode.js`) — model: sonnet
- Inject optional `audio` dep (constructor, null-safe — test-seam discipline, no hard import in game modules): typing glyph keystroke → `tick` (throttle ≤ 1 per 40 ms), correct resolve → `lockSweep`; scramble banish → `banish`, contact lost → `lost`; debrief shown → `chime`.
- **Pass:** each event fires its named tone (assert via `_lastPlayed`); null audio ⇒ identical pre-B8 behavior (`node --check` + code-inspect).
- **Commit:** `feat(game): SFX hooks across typing/scramble/debrief`
- **CHECKPOINT C1 (orchestrator):** browser — unlock context, run a mini-wave, assert tone/voice debug fields fire at each beat; engine params track throttle; settings persist; muted run silent (masterGain 0).

### B8.T5 — Difficulty tiers (`src/game/gameMode.js`, `src/game/scramble.js`, `src/game/score.js`) — model: sonnet
- Briefing card gains a tier selector (3 buttons, ←/→ or 1/2/3 while card open; persisted `kuson.game.v1.difficulty`, default cadet):
  | | contacts | timeLimitS | challengeS | autopilot btn | answers accepted | score mult |
  |---|---|---|---|---|---|---|
  | CADET | 3 | 90 | 45 | yes | id, shortName, name | ×1 |
  | PILOT | 4 | 75 | 35 | no | id, shortName | ×1.5 |
  | ACE | 5 | 60 | 30 | no | id only | ×2 |
- ScrambleWave takes the tier config object; score.contactIdentified multiplies by tier mult; debrief shows tier.
- **Pass:** REPL — tier table produces the right wave config; browser at C2 — Pilot hides AUTOPILOT, Ace rejects shortName answer (typed shortName → glyphs can still render target but resolve correct=false… target display for ACE = the `id`).
- **Commit:** `feat(game): Cadet/Pilot/Ace difficulty tiers`

### B8.T6 — Wave progression (`src/game/gameMode.js`, `src/game/scramble.js`, `src/game/score.js`) — model: sonnet
- Debrief gains "Next wave (Enter) / End (Esc)": next wave = wave N+1 with +1 contact (cap +3) and timeLimitS −10% per wave (floor 45 s); session total accumulates across waves; `kuson.game.v1.waveReached` = max wave index reached; debrief shows "WAVE {n} · SESSION {total}".
- DEBRIEF→WAVE added to the FSM guard table (legal only via next-wave path).
- **Pass:** two consecutive waves in browser at C2; waveReached persists; End → IDLE clean.
- **Commit:** `feat(game): escalating multi-wave progression`

### B8.T7 — 60-second interactive tutorial (`src/game/tutorial.js` new, start-screen entry) — model: sonnet
- Steps (each = instruction card top-center + completion detector): 1) "Hold W" (drone.keys has w for 1 s) → 2) "Mouse-look" (|Δyaw| > 0.5 rad cumulative) → 3) "Fly through the rings" — 3 torus rings (THREE.TorusGeometry, cyan, additive) strung ahead of spawn; proximity < 120 m pops each (SFX `chime`) → 4) "Press I and look at an airspace" (identifyMode on + a non-empty pick) → 5) practice typing challenge (Bangkok CTR, no timer) → done card → offers Play.
- Entry: start screen Play → if `kuson.game.v1.wavesPlayed === 0` and tutorial never completed (`kuson.game.v1.tutorialDone`), briefing card offers "First time? 60-second tutorial (T)"; also tutorial replayable via `__sim.game.tutorial.start()`.
- Reuse: typing modal, alerts ADVISORY for step text is NOT enough — build a small instruction card (clone `.gc-card` family); rings disposed on finish/abort; abort path via Esc → everything cleaned (UfoLayer-style dispose hygiene).
- **Pass:** full tutorial playable in browser (C2) — each detector advances, rings pop with chime, practice challenge resolves, `tutorialDone` persists, abort mid-tutorial leaves no rings/cards.
- **Commit:** `feat(game): 60-second interactive tutorial`
- **CHECKPOINT C2 (orchestrator):** tutorial start-to-finish; Pilot + Ace wave each verified; two-wave progression; all with audio beats firing.

### B8.T8 — Progressive HUD + quick chips (`src/ui.js`, `index.html`, `src/main.js`) — model: sonnet
- Minimal-HUD mode: only LAT/LON+ALT+SPD+HDG rows + minimap + alerts visible; everything else (VS/WIND/BAT/LINK/NEXT/MODE/SIM SPEED/FLIGHT HISTORY, right-panel sections beyond tour+display) collapsed behind a "⚙ Pro panel" toggle chip (top of HUD). Persisted `kuson.hud.v1` `{pro: bool}`.
- Default: `pro: true` for EXISTING users (any `kuson.*`/`thairspace.*` key present at first run of this feature), `pro: false` only for completely fresh profiles — the operator's own setup must not change.
- Quick chips (O5): 4 warp chips above `#airspaceFilter` — Bangkok (VTBD-CTR), Chiang Mai (VTCC-CTR), Phuket (VTSP-CTR), U-Tapao (resolve actual id from data — grep airspaces.json) — each calls the existing list-row warp path.
- **Pass:** fresh profile (cleared storage) ⇒ minimal HUD; toggling Pro reveals all + persists; existing-profile default unchanged; chips warp correctly (browser).
- **Commit:** `feat(ui): progressive HUD (pro toggle) + quick warp chips`

### B8.T9 — Airspace fresnel edge-glow (V4) (`src/airspace.js`, display option) — model: sonnet, escalation-watch (shader)
- Extend the existing `onBeforeCompile` pattern infra (airspace.js wallMatFor/pattern pool, ~line 55–125): add a view-angle fresnel term brightening wall edges (pow(1−|dot(N,V)|, 3) × categoryColor × 0.35, additive into the fragment color) — subtle; floors unchanged. Pooling intact (key gains a glow flag only if needed — prefer same material, uniform-free implementation).
- Display option "Volume glow" checkbox (default ON), persisted in `kuson.grounddetail.v1` as `{volumeGlow}`; OFF ⇒ exactly pre-B8 shader path (the no-glow material variant).
- **Pass:** browser — glow visible at grazing angles on CTR walls, OFF toggle restores baseline screenshot; program count delta ≤ +4 (overlay).
- **Commit:** `feat(airspace): fresnel edge-glow on volume walls (toggleable)`
- **CHECKPOINT C3 (orchestrator):** full regression — B5/B6/B7 smoke lists; fresh-profile first-run flow (minimal HUD → tutorial → first wave); audio-off run; baseline diff with glow OFF.

### B8.T10 — Docs (`spec.md`, `journal.md`, `state_TODO.md`) — model: sonnet
- spec §3.17 "Audio" + §3.16 additions (tiers, waves, tutorial) + §6 acceptance rows (~8); journal block 2026-06-12 (b) with C1–C3 evidence; TODO §0 extended; push.
- **Commit:** `docs: spec §3.17 audio + B8 journal/TODO`
## Phase Betterment-9 — INTERCEPT (expanded 2026-06-12, Fable)

**Goal (Pass Criterion for the phase):** A second game mode, INTERCEPT, selectable from the briefing: ATC assigns a defended airspace; shielded UFO raiders fly attack runs and ground crawlers converge on the airport beacon; the player types the airspace designator once to go **weapons free** (identify-then-engage ROE), then destroys raiders with a hitscan cannon (reticle, heat, tracers, sparks) before base integrity hits zero. SCRAMBLE, the tutorial, and the sandbox are pixel/behaviour-identical when INTERCEPT is never selected. Target: ≥ baseline FPS with 8 UFOs + 6 crawlers + tracers active (measure with the `~` overlay).

### §B9.0 Verification-harness notes (binding — lessons paid for in B7/B8)
- Preview tab is backgrounded between tool calls: **rAF suspended, `setTimeout` clamped ≥ 1 s**. Drive sim manually via `__sim` handles (`game.update(dt)`, `game.ufos.update(dt)`, weapons/crawlers update); flush promises with chained `Promise.resolve()`, never timer waits; `preview_screenshot` wakes the tab for real frames (use for fly-to/cinematics).
- **Dismiss the start screen before any keyboard-driven test** — its capture listener swallows all keys while visible (caused two false "bugs" in B8 verification).
- Console buffer **persists across reloads** — judge by entry-count deltas, not presence.
- THREE auto-frustum-culls per Mesh (`frustumCulled` default true) — **measure before believing any "no culling" claim** (B7.T3 audit claims were stale; verify with `renderer.info` before optimizing).
- Sonnet executors died mid-task twice (B8.T7/T9) — when a report comes back truncated mid-sentence, run `git status` immediately and finish the remainder inline.
- Audio asserts: `__sim.audio._lastPlayed/_lastSay/_engineFreq/_hornActive`; tones are no-ops pre-`unlock()`.

### B9.T1 — Perf pre-work: trail buffers + measured culling go/no-go — model: sonnet
- `src/liveFlights.js` trail rebuild (`_rebuildTrail`, allocates `new THREE.BufferAttribute` per poll): preallocate one Float32Array/BufferAttribute per trail at max length (120 pts), update in place + `setDrawRange` + `needsUpdate` — no per-poll allocation.
- Airspace culling go/no-go: MEASURE first (overlay: draw calls at ground level vs 40 k ft, all groups on). THREE already culls per-mesh; only act if calls at typical game altitudes exceed ~450. If acting: per-group boundingSphere distance gate in `updateLabelScales`'s sibling pass — else record the measurement and SKIP (write the numbers in the commit body either way).
- **Pass:** no allocation in the trail path (code-inspect); measurement numbers recorded.
- **Commit:** `perf(trails): reuse trail buffers; record airspace culling measurement`

### B9.T2 — Aim mode: reticle + FOV zoom + fire input — model: sonnet
- Reticle: small SVG/CSS crosshair `#reticle` centered, hidden by default; shown only while INTERCEPT wave is active (driven by game mode, T6 wires it — this task ships it with a debug toggle on `window.__sim`).
- Aim zoom: while reticle shown, camera FOV eases 70 → 58 (lerp ≤ 150 ms, `camera.updateProjectionMatrix()` on change only).
- Fire input: pointer-lock pattern at drone.js:1219–1230 (`this.locked`, click requests lock). Fire = `mousedown` button 0 **while `drone.locked === true`** (first unlocked click takes the lock — standard FPS pattern), plus `KeyF` held = autofire fallback (verify F is unbound: grep drone.js/ui.js key handlers first). Expose `onFire(cb)` registration; no behavior outside INTERCEPT (callback simply not registered).
- **Pass:** reticle toggles via `__sim`; FOV eases and restores; fire events emitted only when locked; zero effect when never enabled.
- **Commit:** `feat(game): aim reticle, FOV zoom, and fire input`

### B9.T3 — Weapons: hitscan + heat + tracers + sparks + tones (`src/game/weapons.js`, `src/audio.js`) — model: sonnet, **Fable reviews hit math**
- `class Weapons` deps `{ scene, camera, audio, getTargets }` — `getTargets()` returns an array of `{ id, kind: "ufo"|"crawler", position: Vector3, radius, shielded, takeHit(dmg) }` (provider injected in T6; T3 ships with a stub).
- Hitscan: ray from camera (center) — reuse a module-level `THREE.Raycaster`-free analytical ray-sphere test (match identify.js's pure-math style): nearest target whose sphere (radius ~60 m UFO / 40 m crawler) intersects the ray within 4 000 m. Shielded hit → `audio.play("shieldPing")` + small flash, no damage.
- Heat: +8/shot, −30/s, max 100 → overheat lockout 1.5 s + `overheat` tone; cooldown 0.12 s between shots. Heat bar UI: thin vertical bar beside the reticle (same DOM family).
- Tracers: pool of 8 `THREE.Line`s (additive, depthWrite false) reused — drawn camera-muzzle→impact (or max range), fade over 80 ms. Sparks: ONE `THREE.Points` pool (64 verts), burst of 6–10 at impact, 0.5 s gravity fade. **No allocation per shot** (pool everything; module-level temps).
- `src/audio.js`: add one-shots `fire` (40 ms filtered noise snap), `spark` (2.5 kHz ping decay), `shieldPing` (hollow 1.2 kHz ring), `overheat` (descending buzz), `explode` (noise burst → lowpass sweep + thump) — follow the existing tone-lib pattern exactly.
- **Pass:** REPL ray-sphere math (hit at offset < r, miss at > r, nearest-first ordering — paste output); code-inspect pooling; tones exist + named correctly.
- **Commit:** `feat(game): hitscan weapons — heat, tracers, sparks, tones`

### B9.T4 — UFO combat behaviors (`src/game/ufo.js`) — model: sonnet
- Extend entities: `hp` (3), `shielded` (bool, strong glow ×1.6 while true), `behavior: "ORBIT"|"EVADE"|"ATTACK_RUN"|"RETREAT"` + `setBehavior(id, b, opts)`. SCRAMBLE spawns keep pure ORBIT (no hp/shield semantics — `spawnAt(airspaceId, { combat:false })` default preserves today's behavior exactly).
- EVADE: on `takeHit` while alive — 6 s of lateral jinks (heading ± up to 60° every 0.8–1.4 s, speed ×1.5), then resume previous behavior. ATTACK_RUN: descend/steer toward an assigned world point at ~70 m/s; within 400 m → `onReachTarget(id)` callback then RETREAT. RETREAT: climb away from target heading, despawn (existing fade path) after 15 s.
- `takeHit(dmg)`: shielded → no-op (weapons already pinged); else hp −= dmg, white flash (emissive pulse), hp ≤ 0 → explosion: `audio.play("explode")`, spark-burst hook (callback to weapons pool), then existing dispose path. Leak rule unchanged: geometry counts return to baseline (browser-assert like B7.T6).
- **Pass:** spawn combat UFO via console, drive update; behaviors transition; 3 hits destroy with clean dispose; SCRAMBLE spawn unchanged (no shield glow).
- **Commit:** `feat(game): UFO combat behaviors — shield, evade, attack-run, destroy`

### B9.T5 — Ground crawlers (`src/game/crawlers.js`) — model: sonnet
- `class CrawlerLayer(scene, { layer })` — UfoLayer lifecycle hygiene. `spawnRing(airportPos, count, distM=10_000)`: spawn `count` crawlers on a ring around the defended airport, converge at 15 m/s. Terrain-follow: y = `elevationAt(lat, lon)` + 12 — NOTE `elevationAt` takes lat/lon (terrain.js:59): convert via `worldToGeo` from coords.js, sample ≤ 2 Hz per crawler (cache between samples; no per-frame trig).
- Mesh: low-poly dark dome + glow ring (shared geometry/material across crawlers — build once at module level), ~25 m. `hp` 2, `takeHit`, destroy = explode tone + dispose. Within 500 m of the airport → `onReachBase(id)` then despawn.
- Radar blips: mirror the live-flight blip pattern (ui.js:2468–2562, `showRadarFlights` gate) — small red triangles via a `ui.drawGameBlips(list)` hook the UI calls inside the radar draw when a provider is registered (`ui.setGameBlipProvider(fn)`); provider supplied in T6.
- **Pass:** spawn 6 via console, converge on heading toward airport, terrain-following y, destroy + reach-base callbacks fire, dispose leak-free; blips render on the radar.
- **Commit:** `feat(game): ground crawler raiders with radar blips`

### B9.T6 — INTERCEPT wave + mode select + weapons-free gate (`src/game/intercept.js`, gameMode, scramble untouched) — model: sonnet
- Briefing card: mode row **SCRAMBLE | INTERCEPT** above the tier row (persisted `kuson.game.v1.mode`, keys Q/E or ←/→ — check unbound within the card's capture listener). Tier matrix applies to both modes (contacts → raider count).
- `class InterceptWave(deps, { tier, waveIndex })`: pick ONE defended airspace (CTR with a matching airport in data/airports.json — resolve beacon world pos via geoToWorld); ATC: "Raid warning — {shortName}. {n} contacts inbound. Identify for weapons free."; spawn `tier.contacts + waveIndex-1` combat UFOs (shielded, ORBIT 8 km out) + `2 + waveIndex` crawlers (T5 ring).
- Weapons-free gate: typing challenge (same tier answer rules) available immediately (auto-open on first fire attempt while shielded, or via Enter on the objective strip); correct → all raiders' shields drop + `lockSweep` + ATC "Weapons free, weapons free"; UFOs go ATTACK_RUN toward the beacon, staggered 5 s apart.
- Base integrity 100: UFO reaching beacon −20, crawler −10 (then despawn); integrity ≤ 0 → wave lost (debrief shows BASE OVERRUN); all raiders destroyed → wave won. Score: 150/UFO kill, 75/crawler, ×tier.mult, accuracy bonus = `round(100 × hits/shots)` (weapons exposes counters), integrity bonus = integrity remaining. Debrief reuses the existing card (per-line: kills, accuracy, integrity, total); Next-wave escalation per B8.T6 pattern.
- gameMode `_beginWave()`: branch on persisted mode → ScrambleWave (unchanged) or InterceptWave; reticle/weapons active only during INTERCEPT WAVE; abort path disposes weapons effects, crawlers, UFOs, reticle.
- **Pass (orchestrator at C2):** full INTERCEPT wave win + loss paths; SCRAMBLE regression (one cadet contact); abort clean from mid-fight (0 entities, no reticle, FOV restored).
- **Commit:** `feat(game): INTERCEPT mode — raids, weapons-free gate, base integrity`

### B9.T7 — Shadow blobs (V5) (`src/game/` entities + drone) — model: sonnet
- Soft dark ellipse (radial-gradient canvas sprite, shared texture) under: player aircraft, combat UFOs, crawlers — y = terrain + 1, scale by altitude (full at ≤ 200 m AGL, fade out by 2 000 m), opacity ≤ 0.35. One shared texture; per-entity sprite. Skip live-traffic aircraft (cost — deferred row).
- **Pass:** blob under the drone at low AGL fades with climb; blobs under crawlers/UFOs during a raid; no blob when game off (player blob is fine to keep always — it's the V5 realism item; default ON, no toggle).
- **Commit:** `feat(visual): altitude-faded shadow blobs (player + game entities)`
- **CHECKPOINT C3 (orchestrator):** INTERCEPT + SCRAMBLE + tutorial + sandbox regression; FPS with 8 UFOs + 6 crawlers + tracers vs baseline (overlay numbers in journal); glow/audio toggles still clean.

### B9.T8 — Docs — model: sonnet
- spec §3.16 INTERCEPT subsection + §6 rows (~8: mode select persists; shielded ping no-damage; weapons-free drops all shields; integrity loss path; accuracy counter; abort restores FOV/reticle; SCRAMBLE untouched; FPS bound). Journal block 2026-06-12 (c) or next slot with C1–C3 evidence + measurements; TODO §0c; push.
- **Commit:** `docs: spec INTERCEPT + B9 journal/TODO`

**Checkpoints:** C1 after T3 (fire path: spawn static combat UFO, hitscan hits/misses by math, tracer+spark pools cycle, heat locks out, tones fire). C2 after T6 (full wave win/loss + SCRAMBLE regression). C3 after T7 (above).
## Phase Betterment-10 — World Beauty (expanded 2026-06-12, Fable)

**Goal (Pass Criterion for the phase):** Thailand stops being flat. Ground tiles rise from the baked SRTM grid (`data/terrain.bin`) and the drone can no longer clip through a mountain; a day/dusk/night cycle drives sky, fog, lights, and tile tint, with city/airport lights blooming after dark; the sea shimmers; wind strengthens and veers with altitude with a crosswind readout on the HUD; airplane presets enforce per-type G-limits with buffet and an overstress warning. **Defaults = pixel parity:** time-of-day default DAY, water/terrain/lights each toggleable — with terrain OFF and DAY selected the sim renders pixel-identical to pre-B10 (verify with the §B10.0 A/B method). FPS ≥ baseline within the measured tri budget (terrain adds geometry — record overlay numbers before/after; segment knobs are the tuning lever).

**Persistence:** `kuson.daynight.v1` `{mode: "day"|"dusk"|"night"|"auto"}` (default `day`); `kuson.grounddetail.v1` gains `{terrain: true, water: true, cityLights: true}`. Wind/G changes ride existing physics settings paths (locate before extending — wind settings already live on `drone._windSettings` / `src/wind.js`).

**Model routing (operator decision):** hard parts are implemented by **Fable inline in the main orchestrator session** (T2 terrain displacement, T6 water shader — both touch tile lifecycle/shader-program subtleties where Sonnet failed-twice cost exceeds the savings). Everything else dispatches to **Sonnet 4.6** executors per §0.1, orchestrator reviews each diff. Checkpoints C1–C3 are orchestrator browser work as always.

### §B10.0 Harness + design notes (binding — B9 session lessons + Fable designs)

**Harness (verified during B9 — supersedes older notes):**
- rAF **never ran at all** in the B9 preview session — `preview_screenshot` did NOT wake it (stricter than the B7/B8 note). Drive everything manually: `__sim` handles + explicit `renderer.render(scene, camera)` frames. `renderer.info` reads the last manual frame.
- `window.__sim.ground` is overwritten at bootstrap (main.js:464) with `{rangeRings, airports, provinces}`, hiding the DynamicGround instance — **manual tile updates are impossible until B10.T1 fixes the handle**. T1 is therefore first and blocking.
- Pixel-baseline A/B method: `git checkout <pre-B10 SHA>` (detached), reload, dismiss start screen via Explore **click**, render N manual frames, screenshot + `renderer.info`; then same procedure on B10 HEAD. Identical numbers/visuals = parity. (B9 reference under this procedure: 390 calls / 20 584 tris.)
- Typing modal: window-dispatched synthetic keys are swallowed by its capture listener — set `typing._input.value` then dispatch Enter `KeyboardEvent` **on the input element**.
- `airspacesAt` converts ft→m (`FT_TO_M`) — mid-band of an 8 000 ft ceiling is 1 219 m, not 4 000.
- Console buffer persists across reloads — judge by entry-count delta (B9 left it pinned at 96, all pre-B9 harness noise).
- Sonnet executor dies mid-task → run `git status` immediately, finish the remainder inline (B8 ×2 precedent).

**Terrain displacement design (Fable-authored — binding for T2/T3):**
- **CPU displacement at tile build time**, not GPU. Rationale: `elevationAt(lat, lon)` (terrain.js:59, bilinear over the 30″ grid) is already the single source of truth for crawlers, shadow blobs, and AGL — the visual mesh must agree with it exactly or entities float/clip. CPU displacement is one-time per tile (tile churn is already async + throttled), zero per-frame cost, no shader maintenance.
- In `_buildMesh` (ground.js:104): `new THREE.PlaneGeometry(width, height, SEGS, SEGS)` (was 1×1), `rotateX(-π/2)` as today; then per-vertex: world = vertex local + mesh center → `worldToGeo(wx, wz)` → `pos.setY(i, elevationAt(lat, lon))`. Shared tile edges sample identical world coords → bilinear continuity → **no cracks** between same-zoom neighbours. Keep `meshY` 0 / 0.4 detail layering + polygonOffset exactly as-is.
- `SEGS_DETAIL = 24` (z11 tile ≈ 19.6 km → ~815 m/quad, matches the 30″ ≈ 925 m grid), `SEGS_BASE = 24` (z9 ≈ 78 km → 3.2 km/quad, background relief). Budget estimate: detail 5×5 + base 7×7 tiles → ~85 k added tris worst case. **Gate at C1:** if the manual-frame cost rises > +2 ms vs the pre-B10 baseline, drop `SEGS_BASE` to 16 and re-measure (record both numbers in the journal either way).
- Write a per-vertex attribute `aSea` (1.0 where `elev ≤ 0.5` m, else 0.0) during the same loop — T6 consumes it. Call `computeVertexNormals()` once per tile (cheap, future-proofs lighting).
- **Terrain-ready race:** tiles build at boot, `loadTerrain` resolves async (`elevationAt` returns 0 before that → flat tiles). DynamicGround gets `onTerrainReady()` — main.js calls it after the existing terrain load promise (the start-screen progress already awaits it); it drops + rebuilds all live tiles once. Tiles built after readiness displace at build.
- **Toggle:** `kuson.grounddetail.v1.terrain` (default ON). OFF ⇒ `SEGS = 1`, no displacement loop — byte-identical geometry to pre-B10. Toggling rebuilds tiles (drop cache once, same path as `onTerrainReady`).
- Minimap bake, radar, fallback plane: untouched (all flat-2D or below tiles).

**Day/night ramp table (Fable-authored — binding for T4; DAY = today's exact values, guaranteeing default parity):**
| param | DAY (t 0.35–0.65) | DUSK peak (t 0.75) | NIGHT (t 0.85–0.15) |
|---|---|---|---|
| fog color | `0xa6cdee` (main.js:58) | `0xd9a07a` | `0x0a1020` |
| hemi sky / ground / intensity | `0xc6d8f0` / `0x394a3a` / 1.0 (main.js:120) | same hues / 0.55 | `0x223048` / `0x0a0f0a` / 0.12 |
| sun color / intensity | `0xfff2d8` / 1.1 (main.js:122) | `0xffb070` / 0.5 | — / 0.0 |
| tile tint (scalar `mat.color`) | `0xffffff` | `0xd8c8b8` | `0x4a5566` |
| sky-dome uniforms (sky.js:50–108) | today's | horizon `0xff9e5e`, top `0x2a3a6e` | horizon `0x0d1626`, top `0x05080f` |
- `t ∈ [0,1)`: 0 = midnight, 0.5 = noon. Presets: day t=0.5, dusk t=0.75, night t=0.0; **auto** = Asia/Bangkok wall clock (`hours/24`). Smoothstep between bands; sun azimuth swings east→west across the day (simple circular path — no ephemeris).
- Tiles stay `MeshBasicMaterial` — night darkening is the **scalar tint** above (one shared `Color` lerped per frame, assigned to each live tile material's `.color`; tile count ≤ 74). No Lambert switch, no relighting risk, exact DAY parity.
- Module exposes `getNightFactor()` (0 at day, 1 at night) — T5 consumes it.

### B10.T1 — `__sim` handles + harness enablers — model: sonnet
- main.js: the bootstrap line 464 `window.__sim.ground = { rangeRings, airports, provinces }` collides with the module-level `__sim.ground = DynamicGround`. Grep ALL consumers of `__sim.ground` first; rename the bootstrap object to `window.__sim.groundLayers` and leave `__sim.ground` as the DynamicGround instance. Also re-publish `window.__sim.tourGuide` after bootstrap assigns it (long-standing TODO §0 row — it has always been `undefined`).
- **Pass:** in browser console, `__sim.ground.updateAround` is callable and `__sim.tourGuide` is defined; no consumer broke (grep evidence in report). `node --check` clean.
- **Commit:** `fix(sim): expose DynamicGround + tourGuide on __sim (debug handles)`

### B10.T2 — Terrain relief displacement (`src/ground.js`, `src/main.js`) — model: **fable, orchestrator-inline**
- Implement the binding design above: segmented tiles, per-vertex `elevationAt` displacement, `aSea` attribute, normals, `onTerrainReady` rebuild-once, `terrain` toggle (Display options checkbox "Terrain relief", `kuson.grounddetail.v1.terrain`, default ON), OFF ⇒ pre-B10-identical geometry.
- ground.js imports `worldToGeo`/`elevationAt` (terrain.js loads its grid independently — no circular import; verify).
- **Pass (orchestrator at C1):** northern Thailand (warp Chiang Mai / Doi Inthanon ~18.59 N 98.49 E) shows visible relief with no tile-seam cracks; Bangkok flatlands visually ≈ unchanged; toggle OFF → A/B parity with pre-B10; overlay tri/call/frame-ms numbers recorded before/after (gate above).
- **Commit:** `feat(terrain): displace ground tiles from baked elevation grid`

### B10.T3 — World objects onto terrain + drone terrain clamp — model: sonnet
- Lift static ground objects to the surface at install time (one-time `elevationAt` calls): city beacons (`src/cities.js` `installCityBeacons`, ~165), airport beacons (`src/airports.js` `installAirportBeacons`), each marker/halo/label `y = elevationAt(lat,lon) + existing offset`. Range rings (`src/rangeRings.js`): ring y = drone's cached ground elevation + 0.5, sampled ≤ 2 Hz (crawler pattern). Province LINES stay flat — measure visual damage at C1 and file a TODO row if objectionable (long polylines = heavier task, deferred).
- Drone terrain clamp: floor is no longer y ≥ ~0 — find the existing ground/floor clamp in `src/drone.js` (grep the y-floor in `physicsStep`/`update`) and clamp `y ≥ elevationAt(lat,lon) + 1.5` in ALL modes, with the elevation sampled ≤ 2 Hz and cached (no per-frame `worldToGeo` trig). Teleport/fly-to/RTH paths must not spawn underground (clamp on arrival too).
- **Pass:** beacons sit on hillsides not inside them; flying level at a mountain face stops at the surface instead of clipping through (orchestrator drives at Doi Inthanon); HUD AGL reads ~0 when resting on a hill.
- **Commit:** `feat(terrain): ground objects on relief + drone terrain clamp`
- **CHECKPOINT C1 (orchestrator):** relief + seams + parity A/B + tri/frame-ms gate + clamp + beacons. Record all overlay numbers in the journal.

### B10.T4 — Day/dusk/night cycle (`src/daynight.js` new, main.js, sky.js read) — model: sonnet (binding ramp table in §B10.0)
- `installDayNight({ scene, skyRig, hemi, sun, groundTiles })` → `{ update(dt), setMode(m), getNightFactor() }` implementing the §B10.0 table: smoothstep band blending, sun azimuth path, fog/hemi/sun/sky uniform/tile-tint lerps. Per-frame work = lerp + assignments only (no allocation; reuse `THREE.Color` scratch instances module-level).
- main.js: expose hemi/sun (currently local, lines ~117–122) to the module; `_safe("daynight", …)` in the loop; `window.__sim.daynight`. Settings UI: "Time of day" select (Day/Dusk/Night/Auto) in Display options, persisted `kuson.daynight.v1`, default `day`.
- DAY values must be byte-equal to today's constants — copy them from main.js/sky.js, do not retype approximations.
- **Pass:** mode select flips the world convincingly day↔dusk↔night and persists; DAY = A/B parity; `getNightFactor()` 0/≈0.6/1 at day/dusk/night; auto tracks the Bangkok clock (assert mapping in console, not by waiting).
- **Commit:** `feat(sky): day/dusk/night cycle — sky, fog, lights, tile tint`

### B10.T5 — Night city + airport lights — model: sonnet
- ONE `THREE.Points` (additive, depthWrite false, shared radial glow texture — reuse the `_glowTex` pattern, ufo.js:14) with a vertex per `THAI_CITIES` entry (cities.js) + per airport (data/airports.json), positioned at `elevationAt + 30`, size by city prominence / airport fixed; built once at install (static — no per-frame updates beyond opacity).
- Visibility: material opacity = `daynight.getNightFactor()` × 0.9, `visible = factor > 0.05`. Toggle `kuson.grounddetail.v1.cityLights` (Display options "City lights", default ON).
- **Pass:** night mode shows warm points at Bangkok/Chiang Mai/airports that fade through dusk and vanish by day; toggle OFF removes them; geometry/texture counts stable across mode flips (no rebuild per flip).
- **Commit:** `feat(sky): night city + airport lights`

### B10.T6 — Water shimmer on sea tiles (`src/ground.js` shader inject, `src/main.js` clock) — model: **fable, orchestrator-inline**
- `onBeforeCompile` on the tile `MeshBasicMaterial` (precedent: B8.T9 fresnel): consume the `aSea` vertex attribute from T2; on sea fragments mix the tile texel toward deep blue and add two moving sine-band brightness modulations (amplitude ≤ 0.05, periods ~80 m and ~210 m, scrolled by a shared `uTime`) — subtle Gulf-of-Thailand shimmer, not waves. Land fragments mathematically untouched.
- **Program-cache discipline (the B8.T9 lesson):** set `customProgramCacheKey()` to a constant string for all tiles → exactly ONE extra shader program; share ONE `uTime`/`uWaterOn` uniforms object module-wide, ticked once per frame from the loop. Overlay program-count delta must be ≤ +2.
- Toggle `kuson.grounddetail.v1.water` (Display options "Water shimmer", default ON); `uWaterOn = 0` ⇒ output mathematically identical to pre-B10 (uniform gate, no recompile — `uGlowOn` precedent).
- **Pass (orchestrator at C2):** shimmer visible over the Gulf (warp Bangkok→south coast / Phuket VTSP); inland tiles byte-identical; toggle OFF → parity; program count delta ≤ +2; `uTime` advances only while tab renders (no timer dependence — loop-driven).
- **Commit:** `feat(water): animated sea shimmer on coastal tiles (toggleable)`
- **CHECKPOINT C2 (orchestrator):** day/dusk/night flips + persistence, city lights at night, water shimmer + toggles, DAY/off-state A/B parity, program/texture counts.

### B10.T7 — Wind-by-altitude + crosswind HUD (`src/wind.js`, `src/drone.js` read, `src/ui.js`) — model: sonnet
- `src/wind.js` (`currentWind` line 62, spatial-temporal noise field, P3.T9): add an altitude profile — multiplier on speed: ×1.0 ≤ 500 m, ×1.5 @ 3 km, ×2.0 @ 6 km, ×2.8 @ 11 km (linear between knots, clamp above) — and direction veer +15° per 3 km altitude (clockwise). Pure function extension: `currentWind(position, time, settings)` already receives position.y — no call-site changes. Keep `DEFAULT_WIND` surface behavior identical at ≤ 500 m (existing-feel parity).
- HUD crosswind: drone already publishes `_lastWind` (ui.js:2084–2090 wind chip; radar crab vector 2619). Extend the chip with head/cross components vs current heading: e.g. `"↗ 215° 12 kt · X 8L H 9"` (X = crosswind kt + L/R, H/T = head/tail) — compute in `fmtWind`'s caller from `_lastWind` + `drone.headingDeg()`; cache-guarded DOM write as today.
- **Pass:** REPL — profile multipliers/veer at 0/3/6/11 km exact; browser — wind chip shows components and changes sign L/R when heading flips 180°; ≤ 500 m behavior unchanged vs pre-B10 (same chip text for same seed/state).
- **Commit:** `feat(wind): altitude wind profile + crosswind HUD readout`

### B10.T8 — G-limits (`src/physics.js`, `src/drone.js`, `src/ui.js`, `src/audio.js`) — model: sonnet, escalation-watch (physics integration)
- Load factor in the fixed-wing model (physics.js — bank/pitch-rate/airspeed fields per B8.T2 notes at 292/385): `n = 1/cos(bank)` for the coordinated-turn term + pitch-rate term `q·V/g` (q = pitch rate rad/s, V = airspeedMs); publish `drone._loadFactor` each physics step (realistic airplane modes only; easy/hover/UFO ⇒ 1.0).
- Per-preset limits: C172 **+3.8 / −1.5**, Learjet **+4.4 / −1.8**, B777 **+2.5 / −1.0** (table on the preset defs — find where Vs lives, physics.js:210–220, and put limits beside it).
- Exceedance: |n| > 0.9 × limit → buffet (reuse `drone._buffetT` camera-shake path, B8.T2 — intensity scales with proximity to limit) + one-shot warning tone (`audio.play("gLimit")` — descending two-tone, add via the tone-lib pattern, audio.js `_TONES` map ~603). |n| > limit for > 1.5 s cumulative → `alerts.publish` ADVISORY "AIRFRAME OVERSTRESS — n={n}" (auto-retract; no damage model — B10 scope stops at the warning).
- HUD: `G n.n` readout appended to the MODE row (or its own pro-panel row beside WIND — match the existing row idiom, hidden in minimal HUD per B8.T8 rules); cache-guarded writes.
- **Pass:** REPL — n math at 60° bank = 2.0 exact, pitch-rate term sign correct; browser — steep bank in Learjet realistic mode raises G readout, buffet starts near limit, overstress advisory fires after sustained exceedance and retracts; easy mode shows G 1.0 inert; stall horn (B8) unaffected.
- **Commit:** `feat(physics): per-preset G-limits with buffet + overstress warning`
- **CHECKPOINT C3 (orchestrator):** full regression — B5/B6 toggles, B7 SCRAMBLE smoke, B8 audio/tutorial/HUD, B9 INTERCEPT one-wave smoke + abort; terrain/water/daynight/cityLights toggles each OFF→parity; wind ≤ 500 m parity; final overlay + frame-ms numbers vs C1 baseline in journal.

### B10.T9 — Docs — model: sonnet
- spec **§3.18 "World"** (terrain displacement design + toggles, day/night model + ramp table reference, water shader gate, wind profile, G-limit table) + §6 acceptance rows (~8: terrain toggle parity; no seam cracks; drone terrain clamp; DAY default parity; night lights gated by factor; water OFF parity + program delta ≤ +2; crosswind sign flips with heading; overstress advisory fires/retracts). Journal block next slot with C1–C3 evidence + all measurements; `state_TODO.md` §0d; push.
- **Commit:** `docs: spec §3.18 world beauty + B10 journal/TODO`

**Checkpoints:** C1 after T3 (terrain block: relief, seams, parity, tri/frame gate, clamp). C2 after T6 (day/night + lights + water, all toggles, program counts). C3 after T8 (wind + G + full B5–B9 regression).
**Sequencing is strict:** T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 (T5 needs T4's `getNightFactor`; T6 needs T2's `aSea`; T3 needs T2's relief to verify the clamp).

---

## Cross-phase verification (before tagging B7 complete)
- Global regression checklist (`20260528_BettermentPlaybook.md §0.5.2`).
- B5 group toggles, B6 ground layers, live flights, tour, identify — all still pass their own smoke lists.
- Browser console clean across a 2-minute mixed session (game on, then aborted, then explore).
- Journal block appended; `state_TODO.md` ticked; both pushed.
