---
id: 20260828_AutopilotPlaybook
title: Autopilot Playbook — B13–B15 orchestrated implementation of the Three-Hats findings (2026-08-28)
class: spec
version: 1.1.0
status: active
updated: 2026-08-28
owner: kuson
applies_to: []
supersedes: []
superseded_by: []
---
# Autopilot Playbook — B13–B15 orchestrated implementation of the Three-Hats findings (2026-08-28)

**Plan date:** 2026-08-28 · **Execution window:** 2026-08-29 → 2026-09-19 (+ B16 decision gate 2026-09-22)
**Companion to:** `20260828_ThreeHatsReport.md` (what & why), `docs/30-spec/SPEC.md` §3.20 (B12 baseline), `journal.md` 2026-08-28 (k), `STATUS.yaml` (`next_prompts` mirror this plan's wave entry points).
**Audience:** a **Fable 5 orchestrator session** dispatching worker subagents (Opus 5 / Sonnet 5 / Haiku 4.5) — plus any human or fresh session resuming mid-plan.
**Lineage:** extends the B7–B11 playbook protocol (`FaceliftPlaybook.md §0`) — same task-contract, commit and journal discipline — and **upgrades it** with: parallel worktree lanes, four-tier model routing, *automated* e2e gates (the B12 Playwright rig) instead of orchestrator-only browser smoke, and independent review separated from authorship.

This playbook is **stop-and-resume safe** (§5). Every task ends at an atomic commit; every gate leaves machine-checkable evidence; any fresh session resumes from three files (§5.2) without archaeology.

---

## 0. Orchestration protocol

### 0.1 Roles & model routing (effectiveness × economy)

Principle: **route the cheapest model that can pass the task's gate; escalate one tier on a second gate failure; never burn Fable on work Sonnet passes.** Cost order Haiku ≪ Sonnet < Opus < Fable. Hardness is judged by the task's *blast radius* (frame loop, input scoping, geofence/safety logic, FSM integration = high) not its line count.

| Role | Model | Used for | Never used for |
|---|---|---|---|
| **Orchestrator** | Fable 5 | Dispatch/monitor lanes, merge worktrees, run gates, adjudicate review findings, journal/ledger writes, all git at phase boundaries; adversarial review of safety-adjacent diffs (B13.T1); inline rescue after an Opus failure | routine implementation |
| **Heavy executor** | Opus 5 | High-blast-radius integration: geofence/advisory logic, map-primary promotion (deep `ui.js`), onboarding × input-scoping interplay | mechanical or well-templated work |
| **Default executor** | Sonnet 5 | Every well-contracted code task (new modules, UI cards, seed engine, share card, locale plumbing); writing e2e scenarios | tasks flagged `blast:high` unless contract pre-approved by orchestrator |
| **Mechanical executor** | Haiku 4.5 | Fully-specified text/data work: doc syncs (journal/TODO rows from a filled template), string extraction to locale files, running test suites and reporting verbatim output, data-file regeneration | frame-loop, input, shader, persistence-shape, or any judgment call (B7 rule stands) |
| **Independent reviewer** | one tier ≥ author, never the author | `/code-review` (medium; high for `blast:high`) on each lane's diff before its gate; verdicts go to the orchestrator, fixes go back to the author | rubber-stamping its own lane |

Dispatch rules (unchanged from B7–B11 where they paid for themselves, marked ⊕ where new):
- One task per dispatch; the worker receives **this file's §0.4 harness notes + its own task contract + the cited source lines** — never the whole report.
- Scope discipline: no refactors, no drive-by fixes; tempting improvements → new `state_TODO.md §3` row.
- Workers do not run the dev server or browser gates **except** the e2e suite (⊕ new: `node test/e2e/run.mjs` is worker-runnable by design — that is the point of W0).
- ⊕ Parallel dispatch **only** across lanes with disjoint file footprints (per-wave lane maps below), each in its own **git worktree**; the orchestrator merges lanes in the stated order and re-runs the full e2e suite after each merge.
- ⊕ Escalation ladder: Sonnet fails a gate twice → Opus with the failure evidence attached; Opus fails twice → Fable inline; a *gate* that itself proves flaky → fix the gate first (a task, not a shrug).
- ⊕ Worker deaths (4× in B8–B10): orchestrator runs `git status` in the lane worktree immediately, finishes the remainder inline or re-dispatches with the partial diff attached, notes it in the journal.

### 0.2 Gate definition (what "definitely works" means)

A task is **done** only when all of its gate passes; a wave closes only at its checkpoint. No green, no merge, no next task in that lane.

| Gate layer | Command / actor | Applies |
|---|---|---|
| G-syntax | `node --check <touched files>` | every task |
| G-unit | `node --test test/<area>/` for pure modules (seed engine, quiz bank, mastery store — house pattern: `test/pathHeatmap/*` 31/31) | tasks marked `unit:yes` |
| G-e2e | `node test/e2e/run.mjs --suite <wave>` — the B12 Playwright rig committed in W0; **run twice** (flake screen); asserts task-specific rows *plus* the standing regression rows (B12 rows 73–75, fresh/returning parity, wave-Esc ladder) | every code task |
| G-parity | defaults-off behavior identical to pre-wave (house doctrine): every new feature ships behind its persisted default; parity asserted in e2e where pixel-hash is unavailable in-harness | tasks that change defaults |
| G-review | independent `/code-review` by a non-author model (§0.1); orchestrator adjudicates CONFIRMED findings → fix or explicit waiver in the ledger | every code task; **high** effort for `blast:high` |
| G-human | one **wave-end** visual pass on real hardware (SwiftShader cannot judge composed visuals — B10/B11 lesson); never mid-wave | each checkpoint C1–C3 |

### 0.3 Trackability & evidence (the ledger)

No new tracking systems (see §6 friction review). The ledger is the house triple, extended with one convention:

1. **`docs/state_TODO.md`** — one checkbox row per task (`[ ]` / `[~]` / `[x]` / `[?]` real-hardware-pending), added for the whole plan at W0 so progress is visible before work starts.
2. **`docs/journal.md`** — one block per wave close (or per rescue), including verbatim gate output tails.
3. **One commit per task** on the wave branch, message prefixed `B13.T2 …`, body carrying the gate evidence summary (e2e `ALL PASS` line + review verdict). ⊕ Gate evidence files (e2e result logs, screenshots) live under `.scratch/autopilot_20260828/<task>/` — uncommitted, referenced from the journal.
4. Orchestrator keeps a live TaskCreate/TaskUpdate list mirroring lane status during a session (session-scoped; the durable truth is 1–3).

### 0.4 Harness notes (binding — paid for in this session and B7–B11)

**Project harness:** no build step; serve `python3 -m http.server 8000` from repo root; three.js via unpkg importmap pinned r0.170.0; tests are plain `node --test`; no CI — gates run in-session; `kstat` absent in remote containers (STATUS.yaml edited schema-conformant by hand).

**Remote-session (cloud) specifics** — the e2e rig's env adapter (W0) encodes all of these so workers never rediscover them:
- Chromium at `/opt/pw-browsers/chromium`; SwiftShader flags `--use-angle=swiftshader --enable-unsafe-swiftshader --no-sandbox`; point-raster visuals can silently fail → composed-visual claims wait for G-human, instrument asserts (`__sim.*`, `renderer.info`) are the in-harness evidence.
- Browser must NOT get the egress proxy (localhost 405s through it); external fetches relay through Node route-interception with `NODE_USE_ENV_PROXY=1` + `NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`; three.js served from a local `npm i three@0.170.0` vendor (registry.npmjs.org is proxy-exempt).
- Geolocation: grant permission with a fix **outside Thailand** (0.1, 0.1) to exercise the default-fallback path deterministically; an unanswered permission prompt stalls `ready()` forever (B13.T2 fixes this).
- Start-screen capture listener swallows all keys while visible — dismiss before keyboard tests; capture-listener **registration order matters** (startScreen → inputGuard ladder → pauseMenu swallow).
- Any spawn/vantage/tour constant needs a **catalog point check AND a sightline curtain scan** (B12.T2 cost two bounced candidates: VTD47 no-fly freeze, then its 60 000 ft wall across the view).
- Console error buffer persists across reloads — judge by deltas; `_safe()` swallows loop crashes, so e2e must assert on console-error *content*, not app survival.

**On local hardware (M1):** rig auto-detects (no `HTTPS_PROXY`, no `/opt/pw-browsers`) → plain launch, direct network, real GPU; same assertions.

---

## 1. Wave W0 — Gate infrastructure (2026-08-29, half-day)

*Everything else is gated by this; nothing else starts before it is green twice.*

### W0.T1 — Commit the e2e rig — model: sonnet · blast: low · unit: no
- Adapt the session-proven scripts (`walkthrough.js`, `verify_wave.js` — see `.scratch` / session transcript; the B12 assertions are the seed corpus) into:
  - `test/e2e/run.mjs` — starts the HTTP server, launches Playwright, runs suites, prints `PASS/FAIL` rows + `ALL PASS`, exit code 0/1; `--suite <name>` filter; `--twice` convenience.
  - `test/e2e/env.mjs` — the §0.4 adapter (remote vs local detection, route relay, three vendor path, geolocation stub, viewport 1600×900).
  - `test/e2e/suites/regression.mjs` — the B12 checks as the standing suite: fresh scenic spawn (pos/heading/preset/Clear/no-NO-FLY), zero `[loop:*]` console errors, pause-menu round-trip incl. key swallow + Main menu, returning-profile parity, wave-Esc → abort card ladder, tour start smoke.
  - `test/e2e/README.md` — 10 lines: how to run locally and in a remote session.
- Playwright: use the globally installed module (`NODE_PATH`) in remote sessions; document `npm i -D playwright` for local. **No repo dependency on a bundler — rig stays plain Node.**
- **Pass:** `node test/e2e/run.mjs --suite regression` → `ALL PASS` **twice consecutively** in the executing environment; README instructions reproduce it.
- **Gate:** G-syntax · G-e2e(×2) · G-review (haiku runs the suite and reports verbatim; sonnet-authored code reviewed by opus at medium).
- **Commit:** `B13.T0 test(e2e): commit Playwright gate rig (runner, env adapter, regression suite)`

### W0.T2 — Ledger seed — model: haiku · blast: none
- Add the full B13/B14/B15 checkbox table to `state_TODO.md §0i` (every task below, unchecked); journal stub block; STATUS.yaml `next_action` → "W0 green, dispatch B13 lanes".
- **Pass:** rows match this playbook 1:1. **Commit:** `B13.T0b docs: autopilot ledger seed`.

---

## 2. Wave B13 — "First Five Minutes, part 2" (2026-08-29 → 09-02, checkpoint C1)

**Phase goal:** a fresh player's first five minutes contain zero unearned punishment and one guided success: honest advisory logic, a start screen that sells the sim, a 60-second hands-on onboarding, and no environment-specific stalls.

**Lane map (parallel worktrees; merge order A → B → C):**

| Lane | Tasks | File footprint (disjoint) |
|---|---|---|
| A | T1 advisory floors | `src/failures.js`, `src/drone.js` (geofence call site), e2e suite file |
| B | T2 geolocation race · T3 map-primary polish | `src/geolocation.js` · `src/ui.js` (map-primary block), `src/ground.js` (tile source) |
| C | T4 start-screen hero · T5 onboarding | `src/startScreen.js`, `index.html` (ss styles) · `src/game/tutorial.js`, new `src/onboarding.js` |

### B13.T1 — Altitude-aware advisory tiers — model: **opus** · blast: **high** · unit: yes
- The geofence advisory/authorisation tiers currently evaluate **lateral footprints ignoring volume floors** (evidence: `ADVISORY — controlled airspace within 5 NM` at the B12 spawn, 90 m under a 3 000 ft TMA floor — spec §3.20 note, issue I-002). Make tier evaluation respect `lowerFt/upperFt` (with the 5 NM lateral buffer retained for volumes whose band the aircraft is inside or within a sensible vertical margin of — margin constant in the contract, default 500 ft).
- **Must not change:** no-fly tier semantics, strict-CAAT clamp behavior, `airspacesAtUnfiltered` membership (hidden military volumes still enforce), alert-queue priorities.
- Extract the tier decision into a pure function; unit-test the matrix (under floor / in band / above ceiling / inside 5 NM lateral × each tier) in `test/geofence/`.
- **Pass (e2e adds):** B12 scenic spawn shows **no advisory banner**; teleport into VTBD-CTR at 200 m shows advisory/authorisation exactly as today; strict-CAAT clamp row unchanged.
- **Gate:** full §0.2 stack; G-review **high** by Fable (adversarial: this is safety-adjacent display logic).

### B13.T2 — Geolocation pending-permission race — model: sonnet · blast: low
- Race `getStartLocation()` against an app-side 15 s timer → Bangkok fallback (`source:"default"`); late GPS success after fallback is ignored (single-resolve). Start-screen status line shows "Waiting for location permission…" during the wait.
- **Pass (e2e adds):** with geolocation permission never resolved (context grants nothing), `ready()` fires ≤ 16 s and the sim spawns at the fresh-profile scenic vantage.

### B13.T3 — Map-primary polish: instruments + tile fallback — model: sonnet · blast: med
- In map-primary: hide altitude tape + attitude indicator (registry-respecting, exact-restore on exit). Tile layer: on a non-200/keyed-watermark zoom from the primary raster source, fall back per-tile to the OSM standard raster already used elsewhere; source order configurable in one constant.
- **Pass (e2e adds):** `M` → no `#altTape`/`#attitudeIndicator` visible; `M` again → prior visibility restored exactly; tile-fallback unit-style probe on a stubbed 4xx response.

### B13.T4 — Start screen sells the fantasy — model: sonnet · blast: low
- Rename paths by outcome: *Explore the sky · Learn the airspace · Defend the skies*; reduce overlay scrim so the (now-scenic) live scene reads as the hero backdrop; add a one-line data vintage stamp ("AIP Thailand · ENR AIRAC 2021-08 / 2020-11 · educational"). Keep keys 1/2/3, last-choice persistence, `reopen()` contract.
- **Pass (e2e adds):** button labels; scrim opacity token; `reopen()` round-trip from the pause menu still green.

### B13.T5 — 60-second interactive onboarding — model: sonnet (contract below) · blast: med
- New `src/onboarding.js` reusing the tutorial's step machinery (`game/tutorial.js` patterns — ring spawn/dispose discipline, capture-listener isolation): fresh profiles, after Explore, get a 3-step guided minute — (1) fly forward to a ring 300 m ahead; (2) enter the nearest airspace-lite target ring at the CTR wall; (3) press `I` and read the card. Skippable any time (`Esc` → skip confirm via the existing ladder pattern); `kuson.onboarding.v1 {done}`; never shown again once done/skipped; returning profiles never see it.
- **Pass (e2e adds):** fresh profile completes all steps scripted (`__sim` handles); rings disposed to geometry baseline; skip path clean; profile with `done:true` boots identical to pre-B13 (parity row).
- **Gate note:** G-review by opus (input-scoping interplay is where B7/B11 bugs lived).

### B13.T6 — Wave docs — model: haiku (template filled by orchestrator)
- Spec §3.21 (B13 record, from the merged reality), acceptance rows 76–80, journal (l), TODO ticks, STATUS refresh.

**Checkpoint C1 (2026-09-02):** merged lanes on `betterment13-20260829`; full e2e regression + B13 suite ×2 green; review verdicts adjudicated; **G-human**: real-hardware pass — scenic first frame, onboarding feel, map-primary look — then merge decision to `main`.

---

## 3. Wave B14 — Daily Flight, Structure B seed (2026-09-03 → 09-09, checkpoint C2)

**Phase goal:** the return-visit loop — one date-seeded ~3-minute challenge per day, a score, a streak, a shareable card.

**Lane map (merge order A → B):**

| Lane | Tasks | File footprint |
|---|---|---|
| A | T1 seed engine (pure) | new `src/game/daily.js`, `test/daily/` |
| B | T2 mode wiring · T3 debrief/streak/share | `src/startScreen.js` (4th slot), `src/main.js` (wiring), `src/game/gameMode.js` (entry hook only) · new `src/game/dailyDebrief.js`, `index.html` (card styles) |

### B14.T1 — Deterministic daily seed engine — model: sonnet · blast: low · unit: **yes (the gate)**
- Pure module: `dailyChallenge(dateStr, catalog)` → `{seed, targets[3], parRadiusM, title}` — mulberry32 over `YYYYMMDD`, picks 3 catalog volumes with constraints (≥1 CTR/TMA; all within a 120 km chain; **sightline/curtain-checked between consecutive targets** — reuse the B12 checker, committed as a util). Same date+catalog ⇒ identical output on every machine.
- **Pass:** `node --test test/daily/` — determinism (two runs byte-equal), constraint matrix, 30-day fuzz (every generated day valid against the live catalog).

### B14.T2 — Mode wiring — model: sonnet · blast: med (escalate fast — touches `gameMode`)
- 4th start-screen slot **⚡ Daily Flight** (key 4) + pause-menu "Main menu" flows through unchanged; daily runs as a SCRAMBLE-variant wave fed by T1 targets (contract: reuse `ScrambleWave` with injected contacts — **no FSM state additions**; if that proves impossible, stop and return to orchestrator rather than widening).
- **Pass (e2e adds):** two fresh contexts on the same stubbed date produce identical target sets; wave completes scripted; abort → IDLE baseline; SCRAMBLE/INTERCEPT regression rows untouched.

### B14.T3 — Debrief, streak, share card — model: sonnet · blast: low
- Daily debrief card (gc-card idiom): score, streak (`kuson.daily.v1 {lastDate, streak, best}`), one learned fact (from the target volumes' descriptions), countdown to next 00:00 Asia/Bangkok; **Share** button renders a 1200×630 canvas PNG (score/date/streak/silhouette) → clipboard/download.
- **Pass (e2e adds):** streak increments across two stubbed consecutive dates and resets after a gap; share canvas produces a non-blank PNG (pixel-count probe); localStorage shape guarded-merge.

### B14.T4 — Wave docs — haiku (as B13.T6). Spec §3.22, rows 81–84, journal (m).

**Checkpoint C2 (2026-09-09):** suites ×2 green; reviews adjudicated; G-human: play the daily start-to-share on real hardware; merge decision (2026-09-10).

---

## 4. Wave B15 — Academy seed (2026-09-10 → 09-19, checkpoint C3)

**Phase goal:** the CAAT-tailwind learning surface — chart-first entry, recall in the tour, mastery memory, mock-exam skeleton, Thai strings.

**Lane map (merge order A → B → C):**

| Lane | Tasks | File footprint |
|---|---|---|
| A | T1 chart-first entry | `src/ui.js` (map-primary block), `src/startScreen.js` (Learn submenu), `index.html` |
| B | T2 micro-quiz · T3 mastery store | `src/game/quiz.js` (new), `data/quizBank.json` (new), `src/tourGuide.js` (stop hook) · `src/mastery.js` (new), `test/mastery/` |
| C | T4 mock exam · T5 Thai locale | `src/exam.js` (new), reuses quiz UI · `src/i18n.js` (new), `data/locale/th.json`, string touch-points |

### B15.T1 — Chart-first entry — model: **opus** · blast: **high**
- "Learn the airspace" opens a submenu: *Guided tour* (today's path) / *Explore the chart* → boots straight into map-primary with a tap-to-inspect card (volume name, category chip, **plain-language "what this means for your drone / GA" line** — generated per category+band, one template table, no per-volume prose) and a **Fly here** button (drops to 3D at the tapped point via the sightline-checked vantage util). Depends on B13.T3 (instruments/tiles already fixed).
- **Pass (e2e adds):** chart entry → no 3D-instrument overlap; tap VTBD-CTR → card fields correct vs catalog; Fly-here → 3D at expected coords; `M` returns to chart.

### B15.T2 — Tour micro-quiz — model: sonnet · blast: med
- After each Express-tour stop: one 3-choice question (bank in `data/quizBank.json`, seeded from stop narration; **bank drafted by haiku, edited/approved by orchestrator** before commit). Reuses the typing-modal shell in multiple-choice form (same input isolation). Skippable; per-stop result recorded to mastery (T3). Full-tour behavior unchanged (Express only, v1).
- **Pass (e2e adds):** scripted tour answers 10/10; wrong answer shows the correct one + narration line; quiz-off toggle restores today's tour byte-parity.

### B15.T3 — Mastery store — model: sonnet · blast: low · unit: yes
- `src/mastery.js`: per-volume `{seen, identified, quizRight, quizWrong, stars 0–3}` under `kuson.mastery.v1`; guarded-merge; feeds SCRAMBLE identify events and T2 quiz results; exposes `nextReviewCandidates(n)` (naive spaced pick: oldest-wrong-first) for the exam.
- **Pass:** `node --test test/mastery/` matrix; e2e: a SCRAMBLE solve bumps `identified`.

### B15.T4 — Mock-exam skeleton — model: sonnet · blast: low
- ACADEMY panel/menu entry: 20 questions (bank + mastery-weighted selection), timed, pass line 80%, result card with per-category breakdown + "review these volumes" chips (fly-to links). Explicitly labeled practice-only (disclaimer footer verbatim).
- **Pass (e2e adds):** scripted 20/20 and 12/20 runs produce correct verdicts; result chips warp correctly; no persistence beyond `kuson.mastery.v1` + `kuson.exam.v1 {attempts,best}`.

### B15.T5 — Thai locale (plumbing + first content) — model: plumbing sonnet · strings **opus** (translation quality) · blast: med
- `src/i18n.js`: `t(key)` with `data/locale/en.json` (extracted — **extraction by haiku**, key naming reviewed) + `th.json`; language select in VIEW (persisted `kuson.lang.v1`); v1 coverage = start screen, pause menu, onboarding, quiz/exam UI, tour **short** narration, drone-rules panel. Untranslated keys fall back to English (never blank).
- **Pass (e2e adds):** language flip re-renders covered surfaces (probe 6 known strings); reload persists; en snapshot byte-equal to pre-B15 strings (extraction fidelity gate).
- **G-human note:** Thai copy review is human (owner) at C3 — flagged in the ledger as `[?]` until then.

### B15.T6 — Wave docs — haiku. Spec §3.23, rows 85–90, journal (n).

**Checkpoint C3 (2026-09-19):** full suites ×2; reviews adjudicated; G-human (2026-09-22): chart-first feel, quiz tone, Thai copy, exam flow; merge decision. **B16 decision gate (2026-09-22):** with B13–B15 real usage, decide Career-Shell scope (Structure A hub) and write its own playbook — *not* pre-planned here (see §6).

---

## 5. Continuation & failure protocol (the "effortless resume")

### 5.1 During execution
- Lanes run in worktrees `../wt-b1X-<lane>`; a failed lane **never blocks sibling lanes** — it re-enters via the escalation ladder while others proceed; merge order is fixed per wave, so a stuck early lane pauses only merges, not work.
- The orchestrator session keeps `send_later` self check-ins armed (~45 min) while background lanes run; a dead worker is detected at the next check-in at the latest (task notification normally beats it).
- Optional single-session mode: the whole wave as one **Workflow-tool run** (phases = lanes→gates; `resumeFromRunId` gives free intra-session resume). Use only with explicit operator opt-in (ultracode); the Agent-tool lane mode above is the default and is cross-session durable.

### 5.2 Cold resume (any fresh session, human or agent)
1. `git log --oneline -5` on the wave branch + `docs/state_TODO.md §0i` → first unchecked row = the frontier.
2. Read that task's contract here; read `journal.md`'s last block for any rescue notes.
3. `node test/e2e/run.mjs --suite regression` → green confirms HEAD is sane before continuing; red means the frontier is actually "fix HEAD", with the failing rows as the spec.
4. Continue dispatching from the frontier. (This is exactly how B8–B11 survived four executor deaths; the e2e rig makes step 3 mechanical instead of a manual browser session.)

### 5.3 Dates & slack
Dates above assume: agent execution per wave is hours; the calendar slack is the **human loop** (one G-human pass + merge decision per wave, ≤ 1 day turnaround). If a checkpoint slips, subsequent dates slide 1:1 — no re-planning needed; the ledger, not the calendar, is authoritative.

---

## 6. Friction review (plan v1.0 → v1.1 — what was cut and why)

Reviewed against (a) the project's own machinery and (b) the actual runtime harness (Agent tool with per-call model routing + worktree isolation + background lanes; Workflow tool with phase resume; TaskCreate; send_later; no CI; kstat absent remotely). Cuts made:

| Considered (v1.0) | Cut / replaced in v1.1 | Why |
|---|---|---|
| Per-task PRs with review threads | **One commit per task on the wave branch**; review happens pre-merge in-session | Single-maintainer repo, no CI, no PR-gating infra — PRs would add ceremony with zero enforcement value; the merge decision is the human gate |
| New machine-readable state file (`plan.state.yaml`) | **Existing `state_TODO.md` checkboxes + journal + commit prefixes** | The house triple already survived four executor deaths across B8–B11; a second ledger = two sources of truth to drift |
| Mid-wave human checkpoints | **Wave-end G-human only** | Humans are the slowest gate; SwiftShader e2e covers correctness mid-wave — humans judge only what machines can't (composed visuals, feel, Thai copy) |
| Independent reviewer for *every* task incl. mechanical | **Haiku-mechanical tasks: orchestrator line-review only** | A second model reviewing a doc-template fill is pure cost; the B11 rule (orchestrator reviews haiku line-by-line) suffices |
| Full parallel fan-out (all lanes, all waves) | **≤ 3 lanes per wave, footprint-disjoint, fixed merge order** | `ui.js`/`main.js`/`index.html` are shared hotspots; merge-conflict archaeology costs more than the wall-clock saved beyond 3 lanes |
| Pre-planning B16 Career Shell tasks now | **B16 = decision gate + its own playbook later** | Its scope should be shaped by B13–B15 real usage; pre-detailed plans for wave-4 work rot (B11's own deferred list proves it) |
| kstat strict validation as a gate step | **Schema-conformant hand edit; validate when on a machine that has kstat** | The validator isn't installed in remote containers; blocking a wave on unavailable tooling is manufactured friction |
| Screenshot-hash pixel parity in remote e2e | **Instrument/DOM asserts remotely; pixel parity only at G-human** | SwiftShader rendering differs from real GPUs; hash gates would flake, and flaky gates train people to ignore gates |
| Per-wave branch → PR → merge → new branch dance | Wave branch cut from `main` after the previous wave's merge decision; if a merge decision is pending, the next wave branches from the previous wave branch (stacked), noted in the ledger | Keeps work flowing through the one human decision without rebasing drama |

**Kept deliberately (not friction):** two consecutive e2e runs per gate (flake screen is cheap, flaky green is expensive); independent review on all non-mechanical code (the B12 spawn bug — twice bounced by evidence — is exactly the class of thing a second reader catches); docs waves per phase (spec-first doctrine is why this codebase is navigable at all).

---

## 7. Wave entry prompts (copy-paste, mirrored in STATUS.yaml)

- **W0:** "Read docs/20260828_AutopilotPlaybook.md §0–§1. Execute W0.T1+T2 exactly per contract on branch betterment13-20260829 (cut from main). Report the two consecutive ALL PASS outputs."
- **B13:** "Read the Autopilot Playbook §0+§2. W0 is green at <commit>. Dispatch lanes A/B/C per the lane map in worktrees; gate per §0.2; stop at C1 with the evidence summary."
- **Resume (generic):** "Read the Autopilot Playbook §5.2 and resume from the frontier."
