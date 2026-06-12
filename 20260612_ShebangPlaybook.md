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
- **B9 — INTERCEPT:** `src/game/weapons.js` hitscan + tracer/spark pools, UFO EVADE/ATTACK behaviors, ground crawlers vs airport beacons, identify-then-engage combined mode, airspace frustum culling + trail buffer reuse (report P4–P5). *Model: sonnet; Fable reviews the hit-detection math.*
- **B10 — World beauty:** terrain relief from `data/terrain.bin` displacement, day/night + night city lights, water shader, wind-by-altitude + crosswind HUD, G-limits. *Model: Fable designs the terrain-displacement approach (one task), sonnet executes the rest.*

---

## Cross-phase verification (before tagging B7 complete)
- Global regression checklist (`20260528_BettermentPlaybook.md §0.5.2`).
- B5 group toggles, B6 ground layers, live flights, tour, identify — all still pass their own smoke lists.
- Browser console clean across a 2-minute mixed session (game on, then aborted, then explore).
- Journal block appended; `state_TODO.md` ticked; both pushed.
