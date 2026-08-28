---
id: 20260828_ThreeHatsReport
title: Three Hats Report — Market Directions, Game Structure & Player Needs (2026-08-28)
class: spec
version: 1.0.0
status: active
updated: 2026-08-28
owner: kuson
applies_to: []
supersedes: []
superseded_by: []
---
# Three Hats Report — Market Directions, Game Structure & Player Needs (2026-08-28)

**Date:** 2026-08-28 · **Operator:** review session (roleplay brief)
**Method:** full code + docs read (spec §3.16–3.19, B7–B11 history, STATUS/TODO backlog) **plus a live headless-browser walkthrough** of the current `main`-equivalent build — 12 staged screenshots covering: start screen, fresh-profile Explore (minimal HUD), pro HUD + instruments, panel groups expanded, identify mode, map-primary, night, SCRAMBLE briefing, INTERCEPT briefing, mid-wave, abort-confirm, tour stop 1. Console monitored throughout.
**Brief:** wear three hats over the current gameplay and menus — (1) a **brainstormer** asking what else this app can become for the map/aviation market, (2) a **director of world-class sim games** recommending UI / game-screen / game structures (several), (3) **three player personas** listing what needs improvement — then compile this report.

> Companion artifact (same content, with the walkthrough screenshots embedded) is published from the session; this file is the repo-canonical text.

---

## 0. Current state — what the product is on 2026-08-28 (evidence base)

An honest inventory, because every recommendation below hangs off it.

### 0.1 Entry & app modes

| Surface | Today |
|---|---|
| **Start screen** | Full-viewport overlay over the *live, dimmed sim UI*; Thailand outline, progress bar, three buttons: 🗺 Explore · 🎓 Tour (5 min) · 🛸 Play — Sky Guardian. Keys 1/2/3 + Enter; last choice persisted. |
| **Freestyle (Explore)** | 5 aircraft (Mavic 3 / C172 / Learjet / B777 / UFO), Easy ↔ Realistic (`K`), full systems stack (battery, RTH, link, geofence, wind, G-limits), 144-volume nationwide catalog, terrain relief, day/night, live ADS-B + traffic heatmap, 4 themes, 20-element view registry, focus mode, quick-warp chips. |
| **Learning (Tour)** | Scripted Express (10 stops, ~5 min) and Full country (28 stops, ~22 min) tours: warp → orbit → narration cards, labels forced on, learning UI profile applied. Passive — no recall, no quiz, no branching. |
| **Game (Sky Guardian)** | FSM IDLE→BRIEFING→WAVE→DEBRIEF. Two modes: **SCRAMBLE** (fly into a called airspace, type its designator under time pressure) and **INTERCEPT** (defend a CTR: rail-gun UFOs behind typing-gated shields + crawler ground units, integrity meter). Three tiers (CADET/PILOT/ACE), multi-wave escalation, six-step tutorial, ATC radio with TTS, procedural audio, local best-score persistence. |

### 0.2 Menu / screen inventory

- **Right panel** (six collapsible groups): TOUR · VIEW (theme, per-mode tabs, 20 visibility rows, reset) · WORLD (≈18 display toggles + ground detail + time of day + live flights + heat) · TRAFFIC (flights list, radio log) · FLIGHT (controls, altitude limits) · INFO (legend, drone rules, group filters, warp chips, filterable 144-row airspace list).
- **HUD** (top-left): telemetry rows, heading tape, sim-speed/aircraft row, flight history strip, inside-chips, Altitude/Horizon/Pause buttons, CAAT toggle, PRO/MIN chip.
- **Instruments:** altitude tape with reference bands + 90 m AGL line; artificial horizon (fixed center-screen); minimap radar with ⚙ options popover.
- **Cards/overlays:** briefing (mode + tier + bullets + tutorial offer), debrief, abort-confirm, typing challenge, tour overlay, identify card stack, controls hint `?`, alert banner + chips, place label.
- **Persistence:** ~15 `kuson.*` localStorage keys (visibility registry, theme, panel state, game stats, audio, heat settings…).

### 0.3 Build-health findings from the live walkthrough (new, actionable)

1. **P0 — Declutter is dead in the current build.** Every frame logs `[loop:declutter] ReferenceError: declutterLayers is not defined` (`src/main.js:1171`). `declutterLayers` is a `const` inside `bootstrap()` (line 687) while `loop()` (line 1017) is a sibling top-level function — the B11 declutter laws (label fades, ring dimming, district-label hiding) never run, and the console floods (364 errors in a ~6-minute session; `_safe` masks the crash). One-line fix: hoist to module scope (pattern already used by every other layer the loop touches).
2. **First impression is the interior wash.** A fresh Explore spawn is *inside* the Bangkok CTR + VTR1 stack at 200 m: the entire viewport is purple/yellow film with hatching (screenshot 02). Interior-fade helps but the "hero" exterior cage view — the product's best image — is never what a new user sees first. The tour is the only path that shows it.
3. **Default preset is 100× (10 000 km/h) even for a fresh profile.** The HUD reads `100× (10000 km/h)` on first Explore; one `W` press flings a learner across the country. Spec-intended, but wrong default for the first five minutes.
4. **Advisory banner is effectively permanent** over Bangkok (`ADVISORY — controlled airspace within 5 NM` in every walkthrough shot). Banner fatigue was called out in the 2026-07-02 report (V5); the priority queue landed, but the *baseline* advisory still owns the screen center-top in the capital.
5. **Map-primary (`M`) layering gaps:** the artificial horizon and altitude tape stay drawn over the 2D chart; at several zooms the basemap tiles rendered "API KEY REQUIRED" watermarks in this harness (CARTO raster endpoint) — verify in production; a tile-source fallback matters if map-primary becomes a first-class learning surface (§2, §3-P2).
6. **Game objective UI is subtle mid-wave.** In the INTERCEPT shot, no strong on-screen target cue reads at a glance (strip is small/edge-clipped at 1600×900); the abort-confirm card, by contrast, is exemplary.
7. Panel IA, themes, wave input-scoping, exact-restore all behaved as spec'd in the walkthrough — the B11 skeleton is genuinely solid.

---

## 1. HAT 1 — The Brainstormer: what else can this become?

*Voice: product brainstorm, grounded in what the codebase already does cheaply.*

The repo is five products wearing one trench coat. The reusable organs: an **AIP→JSON airspace pipeline** (`scripts/build_airspaces.py`), a **terrain baker** (SRTM→binary grid), a **zero-build 3D airspace renderer** with alerting/geofence physics, a **live ADS-B layer with enrichment + a persistent traffic heatmap**, a **scripted tour engine** (JSON stops + narration + camera), and a **typing/ATC pedagogy loop**. Each direction below names who it serves, why this codebase is already close, and what's missing.

### 1.0 Reach multipliers first (do these before any pivot)

| Multiplier | Why it gates everything else |
|---|---|
| **Thai language UI + narration** | The stated audience is a Bangkok hobbyist/teenager; the entire UI is English. Every direction below doubles its Thai market with a locale file. The tour JSON is already structured for it (`lines[]` per stop). |
| **Mobile/touch** | Currently desktop-gated (`mobileNotice`). Thailand is mobile-first; a "2D chart + inspect" subset (§1.2, §2-D) works beautifully on phones even if 6-DoF flight stays desktop. |
| **Hosted demo + PWA offline** | It's a static site — GitHub Pages/Cloudflare is free distribution. Offline PWA (all data is local except tiles) makes it field-usable. |
| **Shareability** | Score cards, airspace permalinks (`#VTBD-CTR`), screenshot/photo mode. Zero viral surface today. |

### 1.1 CAAT compliance & training companion ⭐ (strongest market pull)

**The market moved toward this app.** CAAT's rules effective **May 17, 2026** require training, electronic registration, and online flight permits for medium-risk drone operations; registration already implies a **40-question online test**, and every camera drone must register (CAAT + NBTC). Tens of thousands of tourists and locals per year now face a test about *exactly the shapes this sim renders*.

- **What exists:** the volumes, the rules summary panel, the 90 m AGL line, tiered geofence with correct vocabulary (advisory/authorisation/no-fly), strict-CAAT toggle, tour engine, typing-recall game.
- **What to add:** a **question bank mapped to scenarios** ("You're here, 60 m AGL — legal? why not?" → fly the answer), a **mock-exam mode** (40 questions, timed, pass line), printable/exportable practice record, Thai localization, and a "registration walkthrough" explainer (CAAT + NBTC steps, linking to official portals).
- **Who pays:** B2C prosumers (exam anxiety is a proven willingness-to-pay); **B2B drone schools** licensing it as courseware — Thailand's certified-training ecosystem just became mandatory for a segment, and schools need engaging lab material. Also insurers/retailers bundling "learn before you fly."
- **Risk:** regulatory drift — mitigated by the existing `source`/AIRAC discipline and the disclaimer posture (train *for* the official test, never replace official sources).

### 1.2 "Can I fly here?" — the Thailand pre-flight check (Aloft/B4UFLY analog)

The US normalized app-based airspace awareness (FAA's B4UFLY → Aloft; LAANC at 500+ facilities). Thailand's equivalent consumer surface is weak. This app already computes point-in-volume + tier verdicts in real time — the same query as "can I fly at this pin?"

- **Add:** a location-first read-only mode (search/pin → verdict card: which volumes, floors/ceilings, the tier, what a hobbyist must do, distance-to-nearest-boundary), permit-path links, NOTAM/TFR ingestion later.
- **Positioning discipline:** *educational pre-check* that routes to CAAT for decisions — keep the liability posture; data currency (AIRAC refresh cadence) becomes the real product.
- **Why it's cheap:** identify-mode + geofence + the catalog are 80% of it; the missing 20% is a search box, a verdict card, and mobile layout.

### 1.3 Live-sky products (the ADS-B layer wants an audience)

- **Spotter/avgeek companion:** the flights list already enriches callsign→airline/route/logo/photo and has follow-cam + route arcs. Add "spotting mode" (sit at VTBS threshold, guess type/airline before the label reveals, streaks) and it's a plane-spotting game nobody else has in 3D.
- **Embeddable news explainer:** when an airspace story breaks (airport closure, royal-zone violation, joint exercise), media want a 3D "why" view. An iframe embed with a deep link to a volume + caption mode is a distribution engine.
- **Heatmap as data product:** the IndexedDB density grid (alt-binned!) is a week away from "Thailand's sky, this month" visual stories and a public aggregate dataset.

### 1.4 The engine as a franchise: "Airspace Sim: {Country}"

The pipeline is the moat: AIP ENR parse → catalog JSON → terrain bake → tour script. Nothing is Thailand-specific except data and `ORIGIN`. **OpenAIP** integration would light up dozens of countries at "approximate" fidelity instantly, with per-country curation as the quality tier. Community data packs (the JSON schema is already documented in the README) make it a platform. White-label for flight schools/regulators in the region (Vietnam, Indonesia, Philippines have booming drone scenes and similar chart-literacy gaps).

### 1.5 Education & institutions

- **Classroom kit:** teacher dashboard (assign tour/quiz, see completion), lesson-plan PDFs riding the tour engine, projector-friendly theme. Thai STEM programs + university ATM/aviation-management courses (144 real volumes beats any slide deck).
- **Museum/airport kiosk:** attract-loop (auto-orbit tour) + 2-minute guided challenge; the UFO preset is already the crowd-pleaser.

### 1.6 Adjacent gameplay markets (lighter bets)

- **ATC-lite mode:** the long-lived ATC-game niche (*I am an Air Traffic Controller 4*, *Endless ATC*) proves appetite for calm, systemic airspace play. The sim has volumes + live traffic + an ATC radio grammar — a "sequence three arrivals through the TMA without conflicts" mode reuses all of it from the controller's seat.
- **VFR familiarization:** GA students prepping VTBD/VTBS transits get a chart-to-3D rehearsal tool (pairs with §2-D's chart-first structure).
- **UTM/U-space sandbox:** corridors and geo-fencing demos for regulators/universities as Thailand's drone-delivery conversations mature — a credibility play more than a revenue play.

**Brainstormer's verdict:** the center of gravity is **1.1 + 1.2** (compliance learning + pre-flight check) — same data, same renderer, real regulatory tailwind, defensible locally — with **1.0** as the gate and **1.4** as the long-game platform.

---

## 2. HAT 2 — The Sim-Games Director: structures I'd actually ship

*Voice: someone whose job is games that pull you back nightly and quietly teach you a real skill.*

**Diagnosis in one line:** this is a **simulator shell with a game bolted on** — three excellent verbs (fly, learn, defend) with no noun connecting them: no home, no map of "what's next," no visible growth, menus that are settings drawers rather than a game's front door. The craft quality is high (exact-restore, input scoping, the abort card); the *shape* is missing.

**Principles I hold every structure to:**
1. **Fun in 30 seconds, purpose in 3 minutes.** A fresh player must see the hero view (exterior cages) and touch the sticks inside half a minute.
2. **The airspace is the level map.** Geography *is* the content — never hide it behind abstract menus.
3. **Learning is the progression system.** Mastery of real volumes = XP. If the player can't feel themselves getting smarter, we lost the premise.
4. **One screen, one job.** Explore ≠ settings ≠ mission select. Today the right panel does five jobs.
5. **Session shapes:** 3-min (daily), 10-min (mission/wave), 30-min (tour/free) — each reachable in ≤2 clicks from launch.

### Structure A — "Career Shell" (hub-and-spoke; my primary recommendation)

```
BOOT → HOME (Ops Room)
        ├── THAILAND MAP  ← mission select drawn ON the real chart
        │     ├── region pins: missions, tours, challenges (locked/starred)
        │     └── click volume → info / "Master this airspace" ladder
        ├── FLY NOW  (Explore, one click, remembers loadout)
        ├── ACADEMY  (tours, lessons, mock exam — §1.1 lives here)
        ├── SKY GUARDIAN  (SCRAMBLE/INTERCEPT wave ladder)
        └── PILOT LOG (profile: rank, badges, mastered volumes, stats, heatmap)
```

- **Meta-progression:** ranks (Student → Certified → Commander) fed by *any* activity; per-volume mastery stars (visited → identified under pressure → aced quiz). "I know Bangkok's sky" becomes a collectible truth. The Duolingo skill tree, laid over real geography.
- **Why it fits:** every spoke already exists as code; the hub is one new screen + a save profile. The start screen's three buttons *are* the embryo.
- **Cost:** the hub must be gorgeous or it's bureaucracy. Budget real art time for the map screen.

### Structure B — "Arcade Rotation" (session-first; lowest lift, fastest retention win)

Front door = three cards: **⚡ Daily Flight** (one seeded 3-minute challenge/day — same for everyone, score + shareable card; the Wordle loop), **🎯 Missions** (curated 5–10 min scenarios with grades: Photograph the palace *legally*; Deliver Chao Phraya crossing under 90 m; Intercept over Ubon), **🗺 Free Fly**. In-game UI is HUD-only; **Esc = pause menu** (resume/restart/settings/quit — the app currently has *no* pause menu; `P` freezes physics while the whole desk stays interactive). Debrief = score + **one fact you learned** + "tomorrow's flight at 00:00."
- **Why:** it manufactures the return visit with almost no new systems — SCRAMBLE waves + tour stops recombine into missions; the seed is a date.

### Structure C — "Layered Cockpit" (pro/sim-first; the MSFS-style toolbar)

Keep Explore primary. Kill the monolithic right panel:
- **Top-center toolbar** of small icons — Layers · Traffic · Weather/Time · Instruments · Camera · Settings — each opening a *small floating pod*, one at a time.
- **Radial quick-menu** on a held key/gamepad button for in-flight switches (aircraft, camera, map, identify).
- **Settings become a real modal** (Controls / Display / Audio / Gameplay / Data) separated from live *layer* toggles; the 20-row registry stays as the power-user "Layout" tab.
- **Why:** the current panel mixes tours, 18 world toggles, traffic feeds, and legal text in one scroll (walkthrough shot 04); pods give each job a screen. This is the structure the *simmer* persona keeps asking for (§3-P1).

### Structure D — "Chart-First Flip" (2D↔3D as the core learning mechanic)

For the learner who wants 2D first (§3-P2): entry is a **full-screen interactive chart** (map-primary made first-class): tap volume → plain-language card ("What this means for your drone"); altitude **slice slider** ("show the sky at 150 m") reshapes the chart; a **Fly here** button drops you into 3D at that exact spot — the flip *is* the aha moment, both directions (`M` in 3D returns to the annotated chart). Lesson cards and the mock exam ride the chart, not the 3D scene. Fix the instrument-overlay + tile-source issues (§0.3-5) as part of making this surface first-class.

### How they combine (my actual recommendation)

Ship **B inside A**: Career Shell as the frame; Daily Flight as its first card; **D** becomes ACADEMY's face (chart-first learning); **C** lands last as Explore's quality-of-life pass. Sequence: **B (2–3 weeks) → A-hub (4–6) → D (4) → C (ongoing polish)**.

### Screen-level directives (regardless of structure)

1. **Start screen sells the fantasy:** cinematic exterior-cage flyover behind the buttons (not the dimmed live desk), name the paths by outcome — *Explore the sky · Learn the airspace · Defend the skies* — and add a fourth slot the moment Daily exists.
2. **First-run flow:** spawn *outside* the wash at golden hour aimed at the Bangkok stack (the hero shot), 1× Mavic default, 100× as a discovered "warp" upgrade; 60-second interactive onboarding (fly → enter volume → identify) replacing the passive tip.
3. **Unify the card system:** briefing/debrief/confirm/typing/tour cards share one visual grammar (the abort card is the standard — spread it).
4. **Objective clarity in-wave:** 3D target beacon + edge-of-screen arrow + distance; the ATC text stays as flavor, never as the only pointer (walkthrough shot 10 shows how quiet the current strip is).
5. **Menu = controller + keyboard parity** (the sim already has gamepad flight; menus are mouse-only).
6. **Accessibility:** the colorblind hatching is genuinely good; add UI scale, reduced-motion, and dyslexia-friendly font toggle to VIEW.

---

## 3. HAT 3 — Three players walk out of a session

### P1 — "Nok", general sim player (weekend flight-simmer, has MSFS)

*Loved:* the physics surprise (stall + G-limits in a browser!), instant aircraft swap, night city.
*Needs, ranked:*
1. **A reason to fly:** no runways-as-gameplay, no landing challenge, no weather to fight — Explore has zero goals. Even three "landing challenge" strips + a wind slider would hook me.
2. **Feel & feedback:** no cockpit or airframe in 1st person, chase-cam only via `V`; wants camera presets (wing/tower/cinematic orbit), replay of my last minute, a photo mode.
3. **Weather:** wind exists (invisible); give me visible weather — rain over the Gulf, monsoon clouds, METAR-driven if live data is a flex.
4. **Realistic mode discoverability:** it hides behind `K`; put a Flight Model toggle on the HUD and in a pause menu.
5. **The 100×/UFO default undermines the sim fantasy** — fine as an unlock, wrong as the greeting.
*Quote:* "It flies better than it welcomes."

### P2 — "Priya", wants to *understand* the airspace, 2D first (drone owner, pre-exam)

*Loved:* the tour narration voice ("that red drum…"), the legend, identify cards, the drone-rules summary.
*Needs, ranked:*
1. **Let me start flat.** I want the chart first (Structure D): tap shapes, read plain-language meaning, *then* fly in. Map-primary exists but is a keyboard shortcut (`M`) I'd never find, with instruments drawn over it.
2. **Ask me questions.** The tour never checks me; SCRAMBLE checks only IDs. Per-stop micro-quiz + a real mock exam (§1.1) turns 22 passive minutes into retained knowledge. The typing challenge is secretly a flashcard system — schedule it (spaced repetition on volumes I've met).
3. **"What does this mean for ME?"** Identify cards say `Base/Ceiling 0–3,353 m` — translate per persona: "Your Mavic: not here, ever. GA: clearance required."
4. **Thai, please.** My exam is my motivation; my English is fine but my father's isn't.
5. **Bookmarks + printable one-pager** per province ("my flying spots"), and search by place name, not just airspace name.
6. **Trust cues:** the `approx` badges are honest — surface data vintage (AIRAC date) on every card, not just the README.
*Quote:* "It taught me the sky's shapes; I still don't know if I may press the take-off button in my soi."

### P3 — "Ball", the gamer (plays evenings; brought friends)

*Loved:* typing-as-unlock is fresh; INTERCEPT's shield gate; escalating waves; the abort card's decisiveness.
*Needs, ranked:*
1. **Juice:** hits need crunch — hitmarkers, kill confirmations, screen shake budget, combo/streak toasts, wave-clear stinger. The systems are there; the *feedback* is polite.
2. **Progression:** score is a number in localStorage. Give me ranks/unlocks (liveries, tracer colors, new defended airports), per-airport leaderboards — even local-friends boards — and a season of weekly modifiers.
3. **Fairness & pacing:** wave 1 CADET INTERCEPT is mathematically unlosable (known); typing mid-dogfight on ACE is rote memorization, not skill — alternatives: multiple-choice under fire, or type *before* engaging to arm. Restart-wave should be one key.
4. **Show me the target:** I lost contacts to the *finding*, not the fight (see §2 directive 4).
5. **Session shape:** a wave night is 25+ min invisible commitment; show wave length up front, add a 5-minute "quick defense."
6. **Let me share the win:** end-card screenshot with score/airport/tier, one key.
*Quote:* "First game where my drone license studying shot back."

### Cross-persona quick wins (small, high leverage)

| Fix | Serves | Effort |
|---|---|---|
| Hoist `declutterLayers` (P0 bug §0.3-1) | all | trivial |
| Fresh-spawn outside the wash + 1× default | all | S |
| Esc pause menu (resume/restart/settings/quit) | all | S |
| Target beacon + screen-edge arrow in waves | P3, P1 | S |
| Per-stop tour micro-quiz (3 questions) | P2 | S–M |
| Plain-language line on identify cards | P2 | S |
| Chart-first entry tile on start screen (map-primary promoted) | P2 | M |
| Daily Flight seed + share card | P3, P1 | M |
| Thai locale file (UI strings + short tour) | P2, market | M |
| Landing challenges ×3 | P1 | M |

---

## 4. Priorities — if only three things happen this quarter

1. **First Five Minutes pass** (§0.3-2/3, §2 directives 1–2, pause menu): the product's quality is invisible behind its greeting.
2. **Structure B (Daily + Missions + share cards)** riding the existing wave/tour machinery: retention with minimal new systems.
3. **ACADEMY seed = chart-first mode + mock exam + Thai strings** (§1.1 + §2-D): aligns the product with the May-2026 regulatory tailwind — the moment the market is asking for exactly this.

*(And merge the one-line declutter fix today.)*

---

## 5. Sources & inputs

- Live walkthrough of this repo (12 screenshots + console log), 2026-08-28, headless Chromium 1600×900.
- Repo docs: `docs/30-spec/SPEC.md` (§3.16–3.19), `docs/FaceliftReport.md` (2026-07-02 survey V1–V9), `docs/state_TODO.md` (deferred ledger), `STATUS.yaml`, `docs/journal.md` (B7–B11, path-heatmap waves).
- Market references (accessed 2026-08-28):
  - CAAT 2026 drone-rule tightening (training, e-registration, online permits from 2026-05-17): [nationthailand.com](https://www.nationthailand.com/news/general/40066155); registration/test overviews: [droneth.or.th](https://droneth.or.th/en/drones-in-thailand/), [drone-laws.com](https://drone-laws.com/drone-laws-in-thailand/), [droneandslr.com](https://droneandslr.com/drone-law/thailand/)
  - US airspace-awareness app ecosystem (B4UFLY→Aloft, LAANC scale): [aloft.ai](https://www.aloft.ai/feature/laanc/), [airspacelink.com](https://airspacelink.com/solutions-for-pilots), [autopylot.io](https://www.autopylot.io/b4ufly/)
  - ATC-game niche longevity: [I am an Air Traffic Controller 4 (Steam)](https://store.steampowered.com/app/1348390/I_am_an_Air_Traffic_Controller_4/), [Endless ATC (itch.io)](https://startgrid.itch.io/endlessatc), [series history](https://en.wikipedia.org/wiki/Air_Traffic_Controller_(series))

> **Disclaimer posture unchanged:** educational visualization only; not for flight planning; every compliance-adjacent direction in §1 keeps CAAT/AIP as the authority.
