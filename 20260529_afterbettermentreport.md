---
id: 20260529_afterbettermentreport
title: After-Betterment Report — Thailand Airspace Simulator
class: spec
version: 1.0.0
status: active
updated: 2026-05-29
owner: kuson
applies_to: []
supersedes: []
superseded_by: []
---
# After-Betterment Report — Thailand Airspace Simulator

**Date:** 2026-05-29  
**Reviewer:** live hands-on session (automated browser control + internal API probes)  
**App URL:** `http://localhost:8000` (Python `http.server`)  
**Baseline:** [20260528_BettermentReport.md](20260528_BettermentReport.md) — pre-betterment forensic review  
**Scope:** All seven betterment phases marked complete in [20260528_todo.md](20260528_todo.md)

---

## Executive verdict

The May 28 betterment programme **delivered on its headline promise**. What was a polished airspace visualizer with a kinematic free-cam is now a **credible educational flight lab**: second-order quadrotor and fixed-wing physics, CAAT-flavoured systems (battery, link loss, RTH, tiered geofence), SRTM-backed AGL, wind, a full instrument stack, atmospheric rendering, and meaningful performance headroom.

A ~45-minute live session exercised every major control surface, both flight modes, all five aircraft presets, identify mode, map-primary view, units toggle, pause/hover, flight history, airspace fly-to, express tour, settings, and geofence boundaries including VTP7 Sattahip Prohibited. **FPS averaged ~75 on desktop; load time ~0.9 s; heap ~31 MB** — comfortable for classroom use.

Remaining gaps are mostly **UX polish, alert prioritisation, and doc drift** — not missing foundations. The sim is ready for hobbyist/teenager use; the items below are what would make it *great* rather than *good*.

---

## Test methodology

| Step | What was done |
|---|---|
| Boot | `python3 -m http.server 8000`; scene + 144 airspaces loaded without error |
| Easy Mode | Default 100× UFO preset; WASD flight; hover; camera views (↓/←/→); map-primary (`M`); 1st/3rd person (`V`) |
| Realistic Mode | `K` toggle; Mavic 3 (`1`) — 5 s forward flight; observed pitch, climb, battery drain, roll |
| Fixed-wing | Cessna 172 (`2`) + Realistic; throttle cut; observed altitude loss (3 000 m → ~130 m) |
| Systems | RTH (`R`); artificial battery drain; signal/link HUD; wind vector; VSI; NEXT-airspace chip |
| Geofence | Teleport to VTP7 Sattahip Prohibited; attempted entry; observed NO-FLY toast + advisory ribbon |
| Identify | `I` toggle; stacked bottom cards with distance/base/ceiling; 3D volume labels |
| Tours | Express tour button → `simMode: touring`; End tour → `free` |
| Catalog | Filter `"VTP7"` → 1 result; click fly-to → overview framing |
| Settings | Ground detail → High (z12); mouse/gamepad sliders present; undo enabled after flights |
| Perf | 2 s rAF sample → **75.5 FPS**; `performance.memory.usedJSHeapSize` ≈ 30.7 MB |

Screenshots captured at Bangkok start, mid-flight Cessna with identify cards, and Sattahip geofence encounter.

---

## What improved since 2026-05-28 (verified live)

These were the top consensus findings in the old report; all are now **implemented and observable**.

| Old finding | Status now | Live evidence |
|---|---|---|
| Kinematic strafe, no real flight model | **Fixed** | Realistic Mavic: pitch −20°, climb to 325 m, speed ~5.5 m/s after 5 s; body attitude responds to sticks |
| No battery / RTH / signal / geofence | **Fixed** | HUD shows BAT %, LINK bars, RTH ENGAGED banner; RTH state machine reaches `FLY_HOME`; NO-FLY toast at VTP7 |
| 90 m line was AMSL not AGL | **Fixed** | HUD reads `ALT 200 m … AGL 189 m` at Bangkok; altitude tape red dashed line tracks terrain-relative ceiling |
| No stall / energy trade (fixed-wing) | **Fixed** | Cessna at 3 000 m with throttle cut: airspeed ~58 m/s, altitude fell to ~131 m |
| No input pipeline / gamepad | **Fixed** | Settings panel: deadzone, expo, Mode 1/2 stick mapping, invert pitch |
| Flat blue background, no sky | **Fixed** | Rayleigh/Mie sky shader, sun disc, altitude-adaptive fog visible in screenshots |
| Bare OSM ground | **Fixed** | Carto Positron tiles; city beacons; province context in location string ("Sattahip District, Chon Buri Province") |
| Wireframe airspace cages | **Fixed** | Shaded translucent walls with floor→ceiling gradient; colorblind hatch on Prohibited/Restricted |
| Static aircraft props | **Fixed** | Prop animation visible in chase cam (Phase 2 deliverable) |
| Identify ray 72k tests/frame | **Fixed** | Analytical ray + 10 Hz throttle (not user-visible; perf confirms headroom) |
| Minimap full repath every frame | **Fixed** | Offscreen bake (Phase 5); radar stays responsive at 75 FPS with identify on |
| No SimMode state machine | **Fixed** | `simMode.mode` transitions: `free` → `touring` → `free` on tour end |
| Easy vs Realistic modes | **New** | HUD chip `[H] HOVERCRAFT · EASY MODE` / `[D] DRONE` / `[A] AIRPLANE`; `K` toggles |

**Net:** The project crossed from "visualizer wearing flight-sim clothes" to "simulator that teaches CAAT concepts by feel." That was the old report's single most important goal.

---

## What's good (current strengths)

### Educational core
- **144-volume nationwide catalog** with AIP/approx badges, filter, compass-rose fly-to, and express/full tours — still the project's best asset.
- **Inside-airspace chips** and live panel title update as you cross boundaries; immediately answers "what am I in right now?"
- **Tiered geofence** is felt, not just documented: advisory ribbon near CTR/TMA, NO-FLY popup at Prohibited volumes, authorisation ceiling concept wired (120 m AGL).
- **Thailand drone rules** collapsible section + altitude tape reference bands (Drone / Heli ops / GA / Jet / Airline) connect chart colours to operating altitudes.
- **Identify mode** bottom cards sorted nearest-first with distance, radius, base/ceiling — excellent for stacked volumes near Bangkok.

### Flight & instruments
- **Dual-mode design works.** Easy Mode is genuinely approachable for volume exploration; Realistic Mode adds meaningful stick physics without blocking tours or fly-to.
- **HUD is aviation-literate:** DMS lat/lon, slip-style heading tape, VSI, wind vector, unit toggle (metric ↔ kt/ft/NM), battery/link/NEXT chips.
- **Altitude tape** auto-zooms and keeps the 90 m AGL line visible — the most important CAAT teaching artifact, now correct.
- **Attitude indicator** rotates/slides with bank and pitch in Realistic drone mode — no longer decorative.
- **Wind + ground-track** on minimap (crab angle visible in README; wind chip confirmed: e.g. `227° / 5.9 m/s`).

### Visual & scene
- **Atmosphere upgrade is night-and-day** vs the old flat `#89b4dc` soup — depth, sun, fog falloff make banking turns readable in chase cam.
- **Carto Positron + city beacons** answer "where in Thailand am I?" at cruise — Chiang Mai / Korat / southern zones readable on radar.
- **Translucent extruded walls** read as volumes, not wire cages; Prohibited hatch pattern aids colourblind users.

### Engineering
- Clean subsystem split (`drone`, `physics`, `failures`, `terrain`, `simMode`, `ui`) survived a large feature wave without turning into spaghetti.
- **`window.__sim` debug surface** useful for smoke testing.
- **Performance is healthy** after Phase 1+5 optimisations — no stutter with identify cards, 3D labels, and ground tiles at High detail.

---

## What's bad (bugs & friction found today)

### High — confusing or incorrect in a live session

1. **Alert banner stacking** — At Sattahip, three banners appeared simultaneously: `RTH ENGAGED (low battery)`, `ADVISORY — controlled airspace within 5 NM`, and `NO-FLY ZONE — VTP7`. RTH reason said "low battery" while BAT showed **97%** (RTH had been triggered earlier by manual battery drain during testing, but the reason string did not update). Users cannot tell which constraint is actually driving behaviour.

2. **Geofence ribbon tier vs toast mismatch** — NO-FLY toast fired (`Flight frozen at boundary`) while the top ribbon still read **ADVISORY**, not `NO-FLY`. The `Geofence.evaluate()` priority puts noFly first, so the ribbon should flip to the red no-fly text when inside Prohibited. Suggests a one-frame toast (`noFlyJustEntered`) firing while tier display lags, or RTH override masking tier on the HUD path.

3. **RTH + geofence interaction unclear** — With RTH active, aircraft moved ~12 km despite NO-FLY toast. Expected: freeze at boundary *or* RTH takes exclusive control with a single clear banner. Competing systems make it hard to learn "what CAAT expects."

4. **Default 100× UFO preset on first load** — README documents this, but a first-time user spawns at **10 000 km/h** in Easy Mode. One mis-click and you're in another province before reading the panel. Better default for education: **1× Mavic** at Bangkok 200 m.

5. **Identify mode card avalanche** — At country-scale positions, **10+ Danger-zone cards** stack up the screen centre, obscuring the 3D view and duplicating radar information. Sorting is correct (nearest first) but volume is overwhelming.

### Medium — polish & consistency

6. **`spec.md` drift** — Still states "Flat ground at Y=0; AGL and AMSL equivalent" and wireframe cages (§2 Scope, §3.2). README is accurate; spec will mislead future contributors.

7. **Flight history undo** — Undo button enabled but index did not decrement in one probe (`5/6` after undo click). May be no-op when current index is already at target; needs clearer UX feedback.

8. **Pause state sticky in automation** — Keyboard-synthesised `P` key left sim paused (`unpaused: false` after double-tap in one script). Real users unlikely to hit this; HUD Pause button is safer. Worth verifying keyup pairing.

9. **Mobile gate copy-only** — `#mobileGate` exists ("Desktop required") but desktop session had no opt-in friction. Touch users on tablets may see the notice *over* a running sim they can't control (old finding; still present in DOM).

10. **Authorisation-tier ceiling clamp not visibly demonstrated** — Entering Class D/TMA at >120 m AGL with Realistic Mavic should clamp altitude and pulse outline. Not confirmed in today's flight path; worth a dedicated smoke step.

### Low — nice-to-have gaps carried from old report

11. **Time-of-day / VLOS daylight slider** — still absent; free hook for CAAT visual-line-of-sight rule.

12. **Magnetic variation** (Thailand ~0–1°E) — HUD shows true heading only.

13. **Cloud layer / "no flight above cloud"** — not implemented.

14. **Screen-space line widths** for distant airspace outlines — still thin at country zoom.

---

## What needs improvement (prioritised roadmap)

### P0 — Quick wins (≤1 day total)

| # | Item | Why |
|---|---|---|
| 1 | **Single active alert** — priority queue: NO-FLY > AUTHORISATION > RTH > ADVISORY; dismiss lower tiers | Eliminates banner stack confusion observed at Sattahip |
| 2 | **Default preset → 1× Mavic, Easy Mode** | First 60 seconds should feel controllable, not warp-speed |
| 3 | **Sync RTH banner reason with live trigger** (battery vs link vs manual) | BAT 97% + "low battery" RTH text teaches the wrong lesson |
| 4 | **Identify card cap** — show top 3 nearest + "N more…" expander | Restores central viewport for learning |
| 5 | **Update `spec.md`** to match README (terrain, walls, modes, systems) | Prevent doc regression |

### P1 — Educational depth (1–3 days)

| # | Item | Why |
|---|---|---|
| 6 | **Authorisation-tier smoke script** — fly Realistic Mavic into VTBD-TMA above 120 m AGL; verify clamp + red ribbon + outline pulse | Closes the third geofence tier loop |
| 7 | **RTH vs geofence precedence doc + code** — when both active, one wins cleanly | CAAT lost-link and no-fly are both real; students need clarity |
| 8 | **Stall callout** — brief HUD flash "STALL" when fixed-wing nose drops | Cessna altitude loss works; label the teachable moment |
| 9 | **Onboarding flow** — first visit: "Press K for Realistic · 1 for Mavic · I to identify" (tip exists; make it dismissible and sequential) | Reduces panel wall-of-text shock |
| 10 | **9 km airport stand-off advisory** — chip when within 9 km of CTR/TMA without being inside | CAAT exam favourite; rules HTML mentions it but sim doesn't cue it |

### P2 — Visual & platform (3–5 days)

| # | Item | Why |
|---|---|---|
| 11 | **Time-of-day slider** + golden-hour default | Atmosphere work deserves a user control; ties to VLOS |
| 12 | **Contact shadow under aircraft** at low AGL | Depth cue for hover training |
| 13 | **Tablet touch path** OR hard-block sim start on touch-only | Mobile gate should gate, not decorate |
| 14 | **Screen-space outlines** (`Line2`) for airspace edges at distance | Country view readability |
| 15 | **Filter list virtualisation** — 144 DOM rows rebuild on each keystroke | Typing "Bangkok" is fine; typing "VTD" still re-renders all matches |

---

## Feature checklist (live session)

| Feature | Result | Notes |
|---|---|---|
| Load 144 airspaces | ✅ | ~937 ms load event |
| Easy Mode (Hovercraft) | ✅ | Default; instant response |
| Realistic Mode (`K`) | ✅ | Quadrotor + airplane paths |
| Mavic 3 (`1`) | ✅ | Tilt, climb, battery drain |
| Cessna / Learjet / B777 (`2–4`) | ✅ | Cessna stall behaviour observed |
| UFO 100× (`5`) | ✅ | ~5.6 km in 2 s |
| WASD / QE / Space hover | ✅ | |
| Shift boost / Ctrl precision | ⚠️ | Not explicitly measured |
| RTH (`R`) | ✅ | State → `FLY_HOME` |
| Battery / link HUD | ✅ | BAT %, LINK LOST observed |
| Wind | ✅ | Chip populated |
| VSI | ✅ | `-5.6 m/s` during descent |
| Altitude tape (`J`) | ✅ | Toggle works |
| Attitude indicator (`H`) | ✅ | Toggle works |
| Units (`U`) | ✅ | metric ↔ aero |
| Map-primary (`M`) | ✅ | Toggle works |
| 3rd person (`V`) | ✅ | |
| Camera ↓ ← → | ✅ | Down view toggles |
| Pause (`P`) | ⚠️ | HUD button reliable; key pair sticky in synth test |
| Identify (`I`) | ✅ | Cards + labels; too many at scale |
| Minimap toggles | ✅ | Underlay, center, FOV |
| Inside chips | ✅ | VTBD-CTR, VTR1, etc. |
| NEXT airspace chip | ✅ | `→ VTR83 in 7s` |
| Geofence advisory | ✅ | Yellow ribbon near CTR |
| Geofence no-fly | ⚠️ | Toast fires; ribbon/tier/freeze coherence needs work |
| Express tour | ✅ | Starts; ends cleanly |
| Airspace filter | ✅ | `"VTP7"` → 1 hit |
| Fly-to from list | ✅ | Overview at ~12 km AMSL |
| Undo / Redo | ⚠️ | Present; decrement unclear |
| Settings (ground, mouse, gamepad) | ✅ | Ground → High applied |
| 3D labels | ✅ | "Bangkok CTR 0–11,000 ft" |
| Colorblind hatch | ✅ | Visible on Prohibited screenshot |
| Performance | ✅ | ~75 FPS, ~31 MB heap |

**Legend:** ✅ confirmed · ⚠️ partial / UX issue · ❌ broken (none)

---

## Comparison snapshot

```
                    May 28 baseline          May 29 live session
                    ─────────────────        ───────────────────
Flight model        Kinematic WASD           Second-order quad + fixed-wing
CAAT systems        Text only                Battery, link, RTH, geofence
AGL / terrain       Flat Y=0                 SRTM grid, tape line correct
Visual atmosphere   Flat blue + fog          Sky shader, sun, Positron map
Airspace render     Wire cages               Shaded translucent walls
Performance         No headroom              ~75 FPS, baked minimap
Default experience  100× UFO (same)          Still 100× — recommend change
Alert UX            N/A                      Stacking / stale RTH reason
```

---

## Recommended next session

1. Fix alert priority + RTH reason sync (P0 #1–3) — highest user-visible ROI.
2. Change default preset to 1× Mavic (P0 #2).
3. Run authorisation-tier + no-fly freeze smoke with **real keyboard** (not synthetic events) and capture a 3-minute screen recording for the README.
4. Patch `spec.md` (P0 #5).
5. Optional: add `doc/smoke_checklist.md` copied from playbook Phase 6 items so regressions are one command away.

---

## Disclaimer

Live testing was performed in Cursor's embedded browser on macOS for educational review only. Gamepad, pointer-lock mouse-look, and long-form tour narration were not fully exercised. Geofence/RTH interaction findings should be confirmed with manual keyboard flight before filing as hard bugs.

**Educational visualization only. Not for flight planning.**
