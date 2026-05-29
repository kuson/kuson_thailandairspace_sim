# Betterment-2 Playbook — Thailand Airspace Simulator

**Date opened:** 2026-05-29
**Companions:**
- [20260528_BettermentPlaybook.md](20260528_BettermentPlaybook.md) — prior phase methodology (still authoritative for operator protocol §0)
- [20260529_afterbettermentreport.md](20260529_afterbettermentreport.md) — external live-session audit (P0/P1/P2 roadmap)
- [20260528_journal.md](20260528_journal.md) and [journal.md](journal.md) — append-only logs
- [20260529_todo.md](20260529_todo.md) — task tracker, single source of truth for state
- [spec.md](spec.md) — architecture contract; this playbook updates it.

**Branch:** `betterment2-20260529`
**Tag on completion:** `betterment2-complete`

---

## 0. Read-this-first — what changed in philosophy

Three architectural decisions made by the operator on 2026-05-29 override anything in the prior playbook that conflicts. Quick-fixes are **not** acceptable; if a betterment-1 module assumed otherwise, it gets refactored, not patched.

### 0.1 Altitude policy — warn, do not enforce (by default)

Betterment-1 shipped a tiered geofence that **clamps** altitude to 120 m AGL inside controlled airspace (Phase 4 P4.T5). In a 2026-05-29 live test with a jet, this clamp manifested as "fly to 1.5 km, get kicked back to ~100 m" — correct per the old rule, wrong per the educational goal (the tour and any non-drone preset should not be silently fenced).

**New contract:**
- All altitude / geofence / RTH behaviours are **advisory only** unless the operator opts in.
- A **Strict CAAT** toggle on the telemetry menu (visible, top or bottom of the HUD column — not buried in Settings) gates **all** physical enforcement. Default **OFF**.
- Warnings are **always shown**, regardless of toggle. That is the teaching surface; enforcement is the optional discipline mode.

### 0.2 Per-aircraft ceiling profile

Each preset declares two ceilings; the warning surface keys off these, not off a global constant. Stored on the preset record in `src/modes.js` (or wherever preset metadata lives — verify during P1.T2).

| Preset | Class | Operational ceiling | Regulated ceiling | Notes |
|---|---|---|---|---|
| Mavic 3 | Consumer drone | **6 000 m AMSL** (svc) | **120 m AGL** (CAAT default) | Regulated band is CAAT §2 hobbyist rule; operational is DJI service ceiling |
| Cessna 172 | GA piston | **4 267 m AMSL** (14 000 ft) | **3 048 m AMSL** (10 000 ft / no O₂) | Regulated is FAA/CAAT supplemental-oxygen rule |
| Learjet 35 | Light biz-jet | **13 716 m AMSL** (45 000 ft) | **12 497 m AMSL** (FL410 typical certificated) | Regulated is type-cert ceiling |
| Boeing 777 | Heavy airliner | **13 137 m AMSL** (43 100 ft) | **12 497 m AMSL** (FL410 RVSM) | Regulated is RVSM upper |
| UFO (100×) | N/A | `Infinity` | `Infinity` | No warnings; the joke preset stays the joke preset |

Values are **editable per preset** at runtime via a Settings table — that satisfies "configured per plane" in user-report E1. Defaults above ship in code.

### 0.3 Alert priority — one banner at a time

Betterment-1 stacked three banners simultaneously at Sattahip (RTH + ADVISORY + NO-FLY). New rule: one active alert at a time, chosen from a static priority list. Lower-tier alerts are still tracked internally (they drive HUD chip colours, history events) but do **not** render their own banner.

Priority (high → low):

1. `NO_FLY` (Prohibited / Restricted active hours)
2. `AUTH_CLAMP` (Class D / TMA above auth ceiling — only when Strict CAAT is on)
3. `RTH_ACTIVE`
4. `ALT_OVER_REG` (above regulated ceiling)
5. `ALT_OVER_OP` (above operational ceiling)
6. `ALT_AT_REG` / `ALT_AT_OP` (warning, not yet exceeded)
7. `ADVISORY` (≤5 NM CTR proximity, low battery, link degraded)

---

## 1. Issue → Phase mapping

The operator's four field reports (E1–E4) and the external audit's P0 items collapse to **5 phases**. P1/P2 items from the external audit are out of scope for this playbook and remain on the parking lot in `20260529_todo.md §Discovered`.

| ID | Source | Phase | Notes |
|---|---|---|---|
| **E1** Altitude warnings + Strict CAAT toggle | Operator | **P2** | Architectural; sits on top of new alert queue |
| **E2** Flight history collapsible + 100 cap + course-only | Operator | **P3** | Closes external P0 #7 (undo index) |
| **E3** Sky stays blue to 60 km + better ground | Operator | **P4** | Closes external P2 #11/#12 only partially |
| **E4** Airspace click fly-to "stays put" | Operator | **P1** | Diagnose first; root-cause, not retry-on-error |
| External P0 #1 Single active alert | External | **P2** | Folded into E1 priority queue |
| External P0 #2 Default preset | External | **Rejected** | Operator decision: keep 100× UFO default |
| External P0 #3 RTH reason sync | External | **P2** | Part of alert-queue refactor |
| External P0 #4 Identify card cap | External | **P4** | Beautification phase |
| External P0 #5 spec.md drift | External | **P5** | Documentation phase |

---

## 2. Operator protocol (delta from prior playbook)

The Read-this-first / Session-open / Session-close / Quality-gates protocol in [20260528_BettermentPlaybook.md §0](20260528_BettermentPlaybook.md) is **still in force**. Two additions for this round:

1. **Reality check on the geofence clamp.** Before touching code in P1 or P2, run a quick smoke: jet preset, throttle to TMA altitude, observe whether clamp triggers. Capture a 5-second screen recording. The fix lands only after the bug is on tape (audit ammunition for future regressions).
2. **`Strict CAAT` is a contract, not a flag.** Code that observes `simState.strictCaat` must read it through a single accessor (`simState.isStrictCaat()`) — no scattered `if (window.__sim.strict)` hacks. The accessor is the architectural seam.

---

## 3. Phase plan

### Phase 1 — Critical correctness bugs (E4 + E1 root cause)

Goal: stop the user-facing wrongness before adding new surface. Two atomic fixes; the rest of E1 is built on top in Phase 2.

| Task | Size | Description | Pass Criterion |
|---|---|---|---|
| **P1.T1** | M | **Diagnose airspace fly-to "stays put"** (E4). Read `flyto.js` end-to-end; map every guard (`flightLocked`, `simMode==='touring'`, RTH active, pause). Write a one-page `doc/flyto_state_machine.md` describing the actual states + transitions. **Do not patch yet.** | `doc/` file lands; journal entry quotes the offending guard(s) by file:line. |
| **P1.T2** | M | **Fix the fly-to bug at root.** Based on T1's diagnosis, refactor so a user-initiated fly-to click is **always honoured** unless an explicit lockout reason exists; lockout reasons must surface as a toast ("Tour in progress — end tour to fly to volume"). No silent no-op. | Click any 5 airspaces in random order from the list (with and without identify/tour/RTH active). All produce either a fly-to or a visible reason. None silently no-op. |
| **P1.T3** | S | **Remove the unconditional 120 m AGL clamp** from `failures.js` / geofence path. Replace with a soft event `geofence:authCeilingExceeded` that the alert queue subscribes to. No `position.y = clamp(...)` outside Strict CAAT. | Fly Learjet through VTBD-TMA at FL280; aircraft holds altitude; alert banner reads `OVER REGULATED — descend to FL410`. Clamp does not fire. |
| **P1.T4** | S | **Strict CAAT toggle scaffolding** — `simState.strictCaat: boolean`, accessor `isStrictCaat()`, HUD button on telemetry column (top or bottom — operator picks during smoke). Persist to `localStorage`. Visible label: `CAAT: OFF` / `CAAT: ON`. | Toggle visible without opening Settings. Persists across reload. |
| Smoke | — | E4 click smoke (5 random airspaces) + E1 jet-through-TMA smoke + CAAT toggle round-trip | Tag: `betterment2-phase-1-complete` |

### Phase 2 — Altitude warning system (E1 main)

Goal: warnings shown for every preset at every relevant boundary. Enforcement only when Strict CAAT is on.

| Task | Size | Description | Pass Criterion |
|---|---|---|---|
| **P2.T1** | S | **Per-preset ceiling table** in `src/modes.js`: add `operationalCeilingM` + `regulatedCeilingM` fields per preset, populated from §0.2 above. UFO uses `Infinity`. | `window.__sim.preset.operationalCeilingM` returns expected value for each `1..5` keystroke. |
| **P2.T2** | M | **Settings: per-aircraft ceiling editor.** Table in the Settings panel (one row per preset, two editable inputs); changes persist to `localStorage` and override defaults at runtime. Reset-to-default button per row. | Edit Cessna op-ceiling 4267→5000; reload; value persists; warning fires at 5000 m. |
| **P2.T3** | M | **Altitude state machine** in a new `src/altitudeAdvisor.js`. States per preset: `NORMAL → AT_OP → OVER_OP → AT_REG → OVER_REG`. Hysteresis: enter `AT_*` at 90% of ceiling, enter `OVER_*` at 100%, leave at 85% / 95%. Emits events; no UI in this file. | Unit-style test (manual scrub via `window.__sim.altitudeAdvisor.test(altitude)`) cycles all five states without flapping. |
| **P2.T4** | M | **Alert priority queue** in a new `src/alerts.js`. Single subscriber renders to the HUD banner. Priority list per §0.3 hard-coded as `ALERT_PRIORITY = [...]`. Each alert carries `{tier, key, message, sourceTs}`. Re-evaluated each frame. Lower-tier alerts visible as chips, not banners. | At Sattahip, with RTH + advisory + no-fly all live: banner shows `NO-FLY ZONE — VTP7`. RTH and advisory render as colored chips below. |
| **P2.T5** | S | **RTH reason sync** (external P0 #3). RTH state machine stores `triggerReason: 'battery' \| 'link' \| 'manual'`; banner message reads `RTH ENGAGED (${reason})` and refreshes when the reason changes (e.g. battery recovers but link stays lost → message flips to "link"). | Drain battery → trigger RTH → recover battery → reason flips to whichever is now active, or banner clears. |
| **P2.T6** | S | **Strict-CAAT enforcement hook.** Only when `isStrictCaat()` returns true, `OVER_REG` for the Mavic 3 inside controlled airspace re-applies the 120 m AGL clamp (now lives in the advisor, not in `failures.js`). All other presets remain warning-only even with toggle on. | Mavic 3 + CAAT ON + inside VTBD-TMA + climb to 200 m AGL → clamp fires, banner reads `AUTHORISATION CLAMP — 120 m AGL`. CAAT OFF → no clamp, banner reads `OVER REGULATED — descend to 120 m AGL`. |
| Smoke | — | Five-preset matrix: each preset at op-1m / op+1m / reg+1m. Banner messages match §0.3. CAAT toggle changes only enforcement, never warnings. | Tag: `betterment2-phase-2-complete` |

### Phase 3 — Flight history rebuild (E2)

Goal: collapsible, compact, course-meaningful. The undo-index bug from external P0 #7 falls out of the rewrite.

| Task | Size | Description | Pass Criterion |
|---|---|---|---|
| **P3.T1** | S | **Event taxonomy.** Define in `src/flightHistory.js` the list of events that count as history entries. **Includes:** preset change, mode change (Easy↔Realistic), throttle preset jump (1×→100×), pause/resume, RTH on/off, fly-to start/end, geofence boundary cross, alert state change (per the new queue), course delta ≥ **15°** (cumulative since last entry), position delta ≥ **2 km** straight-line. **Excludes:** camera view toggle (V, ←, →, ↓), identify toggle, map-primary toggle, unit toggle, settings panel events. | Code constant `HISTORY_EVENT_TYPES` matches list above; one-line JSDoc per entry. |
| **P3.T2** | M | **Ring buffer cap = 100.** Implement as `Array` with `shift()` when length > 100. Undo/redo indices remain valid against the ring (oldest gets dropped; cursor clamps). | Trigger 150 events; buffer holds last 100; undo cursor still works. |
| **P3.T3** | M | **Collapsible UI.** HUD shows a single-row strip `[▶ History 23]`. Click expands a scrollable card list (last entry on top). Persist collapsed state to `localStorage`. Default **collapsed**. | Visual: collapsed strip ≤ 1 line tall; expanded panel scrolls; state survives reload. |
| **P3.T4** | S | **Undo/Redo index fix** (external P0 #7). Cursor displays `<current>/<total>`; clicking Undo decrements cursor by 1 and restores that snapshot; reaching the head disables the button. Edge: when buffer was trimmed, redo "future" entries are also dropped. | Manual: 10 fly-tos; undo 5 times; cursor goes 10/10 → 5/10; redo button re-enabled; undo button disabled at 0/10. |
| Smoke | — | Course-change-only filtering: pan camera 30°, toggle map, switch units — no history entries appear. Fly Cessna in a wide turn — one entry per 15° of heading swept. | Tag: `betterment2-phase-3-complete` |

### Phase 4 — Beautification (E3 + identify card cap)

Goal: usable visual the whole flight envelope. Sky stays blue at airliner altitude. Ground reads as Thailand, not as wireframe.

| Task | Size | Description | Pass Criterion |
|---|---|---|---|
| **P4.T1** | M | **Sky shader floor lift.** In `src/sky.js`, retune the Rayleigh/Mie extinction so the dome stays blue (luminance ≥ 0.55 of sea-level value) up to **60 km AMSL** instead of darkening from ~30 km. Sun disc + horizon glow preserved. Document the constants changed in the journal block (revertable). | Screenshots at 200 m / 12 km / 30 km / 60 km AMSL all show blue dome (sample top-center pixel: blue channel ≥ 0.5). At 100 km still goes black. |
| **P4.T2** | M | **Ground detail boost.** Three sub-tasks: (a) Carto Positron tile zoom default raised one step (z11→z12 at "Medium"); (b) Province boundary overlay opacity raised 0.35→0.55, line width +1; (c) City beacon sprites scale +30% and gain a colored halo (Bangkok = magenta, Chiang Mai = cyan, etc — list in `src/cities.js`). | Side-by-side screenshots over Bangkok and Korat at default settings show visibly more terrain detail and labelled cities. Frame rate ≥ 60 fps maintained. |
| **P4.T3** | S | **Identify card cap** (external P0 #4). Show top 3 nearest cards + "`+N more — expand`" row. Expand reveals the rest in a scrollable section that doesn't grow the bottom strip. | At Bangkok rooftop pose with identify on, ≤ 3 cards visible by default; expand reveals the rest; viewport not obscured. |
| **P4.T4** | S | **Altitude warning chip placement.** When alert queue surfaces an `ALT_*` tier, the chip lives on the altitude tape (top end), color-coded amber (AT_*) / red (OVER_*) — so the operator's eye stays in the cockpit, not on banners. | At Cessna 3 100 m AMSL (just over 10 000 ft reg ceiling): tape-top chip reads `OVER REG · descend to 10 000 ft`; banner echoes (de-duplicated). |
| Smoke | — | Sky check at 4 altitudes, ground side-by-side, identify cap, ALT chip on tape. Frame rate ≥ 60. | Tag: `betterment2-phase-4-complete` |

### Phase 5 — Documentation & release

| Task | Size | Description | Pass Criterion |
|---|---|---|---|
| **P5.T1** | M | **Update `spec.md`** — sync drift from external P0 #5 + write in new architecture: §3 altitude policy (Strict CAAT contract), §3 per-preset ceiling table, §3 alert priority queue, §3 flight history event taxonomy, §3 sky-floor constant, §3.2 walls (not wireframes), §3 SRTM terrain (not flat Y=0). | `git diff spec.md` shows every legacy "flat ground / wireframe cages / no AGL" assertion replaced. New §3.x subsections for each architectural seam above. |
| **P5.T2** | S | **Update `README.md`** — Strict CAAT toggle, per-aircraft ceiling settings, blue-to-60km sky, collapsible history. | README screenshot + control table reflect new HUD. |
| **P5.T3** | S | **Journal closeout** — one block per phase appended to `journal.md` (not the 20260528 journal; this is a new milestone). Final block tags `STATUS: BETTERMENT2_COMPLETE`. | Journal has 5 new blocks (one per phase) + 1 closeout block; SHAs match `git log`. |
| **P5.T4** | S | **PR `betterment2-20260529` → `main`** with the playbook quoted in the body. | PR opened, CI (if present) green, operator review requested. |
| Tag | — | `betterment2-complete` after merge | — |

---

## 4. Architectural seams introduced (so they outlive this playbook)

These are the things future sessions must respect; document them in `spec.md` §3:

1. **`simState.strictCaat`** + `isStrictCaat()` — single accessor. No scattered enforcement flags.
2. **`src/altitudeAdvisor.js`** — owns the per-preset ceiling state machine; no altitude logic in `failures.js`, `drone.js`, or `physics.js`.
3. **`src/alerts.js`** — single source of truth for what banner shows. UI subscribes; emitters publish; priority list is the contract.
4. **Preset metadata fields** (`operationalCeilingM`, `regulatedCeilingM`) — schema in `src/modes.js`. Anyone adding a preset (e.g. an F-18 someday) must populate both.
5. **History event taxonomy constant** (`HISTORY_EVENT_TYPES`) — additive only; removing a type is a breaking change.

---

## 5. Out of scope (parked, not forgotten)

These external-audit items are explicitly **not** in this playbook. They land in `20260529_todo.md §Discovered`:

- External P1 #6 Authorisation-tier smoke script (will fall out of P2.T6 verification anyway)
- External P1 #7 RTH vs geofence precedence doc (partially addressed by alert queue but the doc itself is parked)
- External P1 #8 Stall callout HUD flash
- External P1 #9 Onboarding flow
- External P1 #10 9 km airport stand-off chip
- External P2 #11 Time-of-day slider
- External P2 #12 Contact shadow
- External P2 #13 Tablet touch path
- External P2 #14 Screen-space line widths
- External P2 #15 Filter virtualisation
- External Medium #8 Pause keyboard pairing
- External Medium #9 Mobile gate enforcement (kept as cosmetic notice)

---

## 6. First action

Open a new branch:

```bash
cd /Volumes/ExtremeProApple/dev/2026/kuson_thailandairspace_sim
git checkout -b betterment2-20260529
```

Then create `20260529_todo.md` from the phase tables above and start at `P1.T1` — read `src/flyto.js` end-to-end before any edit. The E4 diagnosis is the gate to everything else.
