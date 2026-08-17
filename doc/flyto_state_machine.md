---
id: flyto_state_machine
title: Fly-To State Machine — Diagnosis & Reference
class: spec
version: 1.0.0
status: active
updated: 2026-05-29
owner: kuson
applies_to: []
supersedes: []
superseded_by: []
---
# Fly-To State Machine — Diagnosis & Reference

**Task:** Betterment-2 P1.T1 (E4 "airspaces click stays put")
**Branch:** `betterment2-20260529`
**Status:** Diagnosis only. No code changes. P1.T2 applies the fix.

---

## 1. Components

| Component | File | Role |
|---|---|---|
| `FlyToController` | `src/flyto.js` | Pure animator. `.start(to, opts)` / `.cancel()` / `.update(dt)`. Sets/clears `drone.flightLocked`. No guards. |
| `startFlyTo(id, opts)` | `src/main.js:216` | Orchestrator. Computes vantage via `layer.overviewVantage(id, fov, dir)`, marks highlight, calls `flyTo.start()`. **Returns `false` silently if vantage is null.** |
| Airspace-card click | `src/ui.js:1314-1320` | DOM handler on `.teleport` button. Calls `this.onFlyTo?.(id)`. **Silent guard at line 1317.** |
| Compass-rose dir click | `src/ui.js:1321-1327` | DOM handler on `.dir-btn`. Calls `this.onFlyTo?.(id, {direction})`. **Silent guard at line 1324.** |
| `TourGuide.stop({silent})` | `src/tourGuide.js:86-98` | Stops the tour. **`silent: true` skips `onStop()` callback.** |
| `setTourRunning(on)` | `src/ui.js:167-169` | Single setter for `_tourRunning` flag. Called from `onStop` callback only (`main.js:301`). |

## 2. Lockout guards (the "why click does nothing")

Every code path that can refuse a user click without showing a reason:

| # | Location | Guard | Failure mode |
|---|---|---|---|
| **G1** | `ui.js:1317` | `if (this._tourRunning) return;` | Card click silently no-ops. **No toast.** |
| **G2** | `ui.js:1324` | `if (this._tourRunning) return;` | Compass-rose click silently no-ops. **No toast.** |
| **G3** | `main.js:218` | `if (!v) return false;` inside `startFlyTo` | If `overviewVantage()` returns null (bad id, missing geometry), the orchestrator returns silently. UI does not surface. |
| **G4** | `main.js:222` (implicit) | `flyTo.start()` is called unconditionally, **overwriting any in-progress animation** including a tour-driven warp | Not "stay put" — *hijack*. Different bug, parked for later. |
| (G5) | `ui.js:200` | `if (!this.tourGuide || this._tourRunning) return;` for tour-start button | Legit double-click prevention on the tour button itself. Not E4. |

## 3. The `_tourRunning` stuck-true repro (E4 canonical)

Reproducer:

```
1. User clicks "Express tour" button
   → ui.js:203 calls setTourRunning(true)
   → _tourRunning = true
   → tourGuide.start() runs

2. User clicks "Reset" button (or any caller hitting ui.js:437)
   → ui.js:437 calls this.tourGuide?.stop({ silent: true })
   → tourGuide.js:97 SKIPS onStop?.()
   → main.js:297 onStop callback NEVER FIRES
   → setTourRunning(false) NEVER CALLED
   → _tourRunning STAYS TRUE

3. User clicks any airspace in the catalog
   → ui.js:1317 guard fires: if (_tourRunning) return;
   → SILENT NO-OP
   → User perceives: "click does nothing, error, stays put"
```

This matches the operator's field report E4 ("unpredictable" because it requires a prior tour + reset to manifest) and explains why the external audit (which never used Reset mid-tour) saw fly-to working ✅.

### Adjacent fragile paths

- `tourGuide.stop()` is also called silently from `TourGuide.skipToNext()` only when it's the natural end of the stops array (line 106) — but that path calls `stop()` with no args, so `silent` defaults to `false` and `onStop` fires. **Safe.**
- `tourGuide.skipToNext()` mid-tour calls `flyTo.cancel()` only — leaves `_tourRunning` correctly true. **Safe.**
- `tourGuide.start()` is idempotent (does not reset `_tourRunning` to true on its own; the UI button does). If `tourGuide.start()` is invoked from code without `setTourRunning(true)` first, `_tourRunning` would mismatch the tour's actual state — but no current caller does this. **Latent risk; not E4.**

## 4. The "missing toast" problem (broader than E4)

Even with the stuck-flag bug fixed, G1/G2/G3 remain **silent** refusal paths. The Betterment-2 contract (playbook §3 P1.T2) requires every click to produce one of:

- A fly-to animation start, **or**
- A visible reason (toast or banner) naming the lockout.

Today, all three guards swallow the click. The fix is structural, not local — `onFlyTo` should always return a `{ok: boolean, reason?: string}` shape and the UI handler should toast on `ok: false`.

## 5. Canonical state machine (target after P1.T2)

The fix in P1.T2 will adopt this contract. Documented here so future contributors don't reintroduce silent paths.

```
                       ┌─────────────┐
   user click          │   IDLE      │
   ────────────────►   │  (no fly-to,│
                       │  no tour)   │
                       └──────┬──────┘
                              │ click any card
                              ▼
                       ┌─────────────┐
                       │  RESOLVE    │
                       │  vantage    │
                       └──┬───────┬──┘
                v == null │       │ v valid
                          ▼       ▼
                  ┌─────────┐  ┌──────────┐
                  │ TOAST   │  │ FLYING   │
                  │ "no    │  │ (flyTo.  │
                  │ vantage"│  │  active) │
                  └─────────┘  └────┬─────┘
                                    │ duration elapsed
                                    ▼
                              ┌──────────┐
                              │  ARRIVED │ ──► IDLE
                              │ (push    │
                              │ history) │
                              └──────────┘

   user click while TOURING (running):
       ──► TOAST "Tour in progress — end tour to fly to volume"
           (no state change)

   user click while FLYING (overlap):
       ──► current animation cancels; new flyTo starts
           (explicit override, surfaces via the new history entry)
```

## 6. Acceptance for P1.T1

- [x] `src/flyto.js` read end-to-end
- [x] `src/main.js` `startFlyTo` orchestrator read
- [x] `src/ui.js` click handlers (lines 1314–1327, 437, 200) read
- [x] `src/tourGuide.js` `stop()` exit paths traced
- [x] All silent-guard sites enumerated (G1–G4)
- [x] Stuck-flag repro captured (§3)
- [x] Target contract documented for P1.T2 (§5)

**No code modified.** Branch HEAD still at the planning commit. P1.T2 is the patch.
