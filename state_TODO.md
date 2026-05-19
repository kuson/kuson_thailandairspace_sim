# Thai Airspace Sim — State & TODO (single source of truth)

> Update this file at the end of every session, after appending to `journal.md`. Tick a box only after the matching pass criterion has been verified (in browser for UI, in code review for logic).
>
> Conventions:
> - `[x]` — done and verified.
> - `[ ]` — open.
> - `[~]` — in progress / partial.
> - `[?]` — needs operator confirmation in a real browser.

---

## 1. Current state (as of 2026-05-20, session c)

### Build & run
- [x] Single-page app, no build step. Open via `python3 -m http.server` (or any static server) and hit `index.html`.
- [x] Three.js r0.170.0 loaded via importmap from unpkg CDN.
- [x] ES modules: `main.js` → `drone.js`, `airspace.js`, `ui.js`, `coords.js`, `ground.js`, `geocode.js`, `geolocation.js`, `flyto.js`, `identify.js`, `flightHistory.js`.
- [x] Data loaded from `./data/airspaces.json` (**147 volumes**, nationwide catalog incl. full ENR 5.1 P/R/D + RTAF/RTN military areas).
- [x] `scripts/build_airspaces.py` + source extracts for catalog regeneration. **Parser bug-fixed 2026-05-20** (radius token-ID confusion, decimal-second handling in vertex regex).
- [x] MIT license file present.

### Scene
- [x] Sky: flat `scene.background` + fog (no sky sphere).
- [x] Ground: zoom-9 base **7×7 following drone** + zoom-11 detail at Y=0.4 over base at Y=0; fallback plane follows drone.
- [x] Horizon compass: N/S/E/W sprites + poles at **200 km world-cardinal offset from drone**, updated each frame.
- [x] Fixed camera clip: near=2, far=600k.

### Airspaces
- [x] Wireframe cages + on-demand highlight fill (identify / catalog fly-to only).
- [x] Optional 3D sprite labels with floor/ceiling toggle; distance-scaled **14–28 px** clamp.
- [x] Identify mode (`I`): center-ray pick, volume highlight fill, **bottom info cards** (no floating 3D identify labels).
- [x] Point-in-volume hit-test; 40 000 ft overview fly-to.
- [x] Panel filter box for airspace list.
- [x] **Military airspaces (RTAF/RTN) shown by default** — display-option checkbox checked on load.

### Drone & input
- [x] 6-DoF + **absolute speed presets** (1×=50 km/h … 100×=10 000 km/h) + Shift boost ×3 + hover + pointer-lock.
- [x] Default preset **100×** on load.
- [x] **`↓` down**, **`←` left**, **`→` right** camera toggles (same key → front view); **`D` strafe right** restored.
- [x] `I` identify toggle; `flightLocked` during fly-to; camera modes cleared on fly-to start.

### HUD
- [x] Lat/Lon DMS; alt.
- [x] **Place label** — bottom-center transparent text (Amphoe, Province via Nominatim); removed from HUD panel.
- [x] **Horizontal slip HDG compass** — bottom cyan lubber triangle (no centerline), large cyan N/E/S/W cardinals, inertial smoothing (τ≈0.14 s), gradient housing, 30° numerals + digital readout.
- [x] **Identify bottom panel** — stacked category-colored cards (name, radius, base/ceiling) when `I` mode hits volumes.
- [x] Speed + preset label/target km/h; **flight history** Undo/Redo; inside chips (cached DOM).

### Startup
- [x] **GPS start** via `geolocation.js` when permitted and inside Thailand; fallback Bangkok 200 m AMSL.
- [x] Radar **map underlay on** and **center aircraft on** by default.

### Radar / minimap
- [x] Map underlay: per-tile bounds at zoom 8, circular clip.
- [x] **FOV cone** toggle (dashed triangle, 70° camera FoV, 80 km reach).
- [x] **Center aircraft** default on; drag-pan when off; scroll zoom; double-click recenter.
- [x] Nadir crosshair on radar when in down view.
- [x] **Identify / fly-to highlight** on radar — brighter fill, thicker stroke, dashed accent outline.

### Educational panel
- [x] **Live panel title** — current airspace name(s) from aircraft position.
- [x] Display options; legend; **collapsible Thailand drone rules (default collapsed)**; warp fly-to list; filter box; reset; collapse.
- [x] **Resume flight removed** — replaced by HUD undo/redo.

### Render stability
- [x] Highlight fill only when active; fixed camera clip; detail ground at Y=0.4; `logarithmicDepthBuffer`.
- [x] Ground tiles follow drone nationwide.

### UX
- [x] Loading splash; controls hint (arrow views, `D` strafe, presets, radar center default); mobile fallback notice.
- [x] Crosshairs + nadir info + view-mode badge overlays.

### Documentation
- [x] `README.md`, `spec.md`, `journal.md`, `state_TODO.md`, `claude.md`.

---

## 2. Browser-verification checklist (run after every code-touching session)

Operator should walk through `spec.md §6` in a real browser. Until then these are `[?]`:

- [?] Loading splash disappears within ~2 s; GPS prompt handled.
- [?] OSM tiles render at GPS/Bangkok start; base + detail follow drone to Phuket/Chiang Mai warp.
- [?] Click → pointer-lock; WASD/QE move; mouse looks.
- [?] `Space` hover; `Esc` releases pointer.
- [?] Catalog warp + Undo/Redo; Reset clears history.
- [?] Alt+Tab no stuck-W.
- [?] Speed presets: 1× slow, 100× fast; preset name in SPD line.
- [?] `↓`/`←`/`→` view toggles + badge “press again for front view”; `D` strafes right.
- [?] HDG tape inertia visible when turning quickly; digital degrees immediate.
- [?] Identify mode (`I`): bottom stacked cards with category colors, radius, base/ceiling.
- [?] Horizon N/S/E/W follow aircraft position nationwide.
- [?] Radar center aircraft on by default; uncheck enables drag-pan.
- [?] Drone rules section collapsed by default; expands on click.
- [?] No flicker flying through nested CTR/TMA.
- [?] 3D labels toggle; height sub-toggle.
- [?] Panel title shows current airspace(s); filter box works.
- [?] Movement works after catalog warp (hover not stuck).

---

## 3. Open TODOs

### High value (next pass)
- [x] Expand ENR 5.1 coverage in `build_airspaces.py` — all VTP/VTR/VTD codes from AIP extract now parsed (147-volume catalog).
- [x] **2026-05-20:** Fix AIP parser radius/vertex bugs — 11 zones (VTD24/25/29, VTR3/5/6/12, VTP36/37, VTD34-1/-2) restored to authentic sizes. See `journal.md` 2026-05-20 (a).
- [ ] Re-verify VTR8 polygon against AIP ENR 5.1 DDMMSS source.
- [ ] Trace true Thai-Cambodian border for VTR62 polygon (currently straight-line closes through Cambodia — overstates area on that side).
- [ ] Sample arc segments for VTD34 / VTD58 / VTD17 instead of straight-line chord between endpoints.
- [ ] Add a smoke-test rig (Playwright or Puppeteer) covering the verification checklist in §2.

### Medium
- [ ] Per-airspace teleport altitude clamp for very tall volumes.
- [ ] Indicate which tile failed to load (debug OSM rate-limiting).
- [ ] On-screen "approximate" reminder when inside an approximate volume.
- [ ] Bundle offline Amphoe/Province lookup table to avoid Nominatim dependency.

### Low
- [ ] Frame-budget logger behind `?debug=1`.
- [ ] `data/airspaces.schema.json` for IDE validation.
- [ ] Document local-tangent-plane math in `coords.js`.

### Out of scope for Phase 1 (parked)
- [ ] Terrain, AGL/AMSL split, FL conversion, NOTAMs, mobile/touch.

---

## 4. Known caveats (do NOT silently "fix" without re-spec)

- Flat tangent plane anchored at Bangkok; beyond ~300 km coordinates drift — catalog spans all of Thailand anyway.
- `lowerFt`/`upperFt` treated as metres above Y=0 regardless of ref tags.
- OSM + Nominatim depend on network and third-party policy.
- Wireframe-cage volumes trade solid fill for render stability — educational clarity preserved via ribs + optional labels.
- 135 of 147 catalog volumes are approximate (parsed ENR 5.1 arcs/coast segments, airport CTR/TMA overlays). 69 entries reference RTAF/RTN military operations.
- VTR62 EASTERN AREA (54 k km²) and VTD58 Surat Thani (35 k km²) are *correctly* parsed from the AIP — they are intentionally large training corridors. Their straight-line polygon closures (ignoring the Thai-Cambodian border / 30 NM arc segments) overstate area slightly; flagged `approximate: true`.

---

## 5. Recently-completed sessions (most recent first)

| Date | Operator | Focus | journal.md block |
|---|---|---|---|
| 2026-05-20 | Cursor Agent | PLACE bottom-center; HDG compass lubber/cardinals; military default on | 2026-05-20 (c) |
| 2026-05-20 | Cursor Agent | Radar identify highlight; PLACE moved to bottom-right overlay | 2026-05-20 (b) |
| 2026-05-20 | Claude Code (Opus 4.7, session 53fdf4b8…) | AIP parser radius/vertex bug fix — 11 oversized zones corrected | 2026-05-20 (a) |
| 2026-05-19 | Cursor Agent | Full ENR 5.1 military/P/R/D catalog (145 volumes) | 2026-05-19 (l) |
| 2026-05-19 | Cursor Agent | HDG compass polish + inertia; identify bottom panel | 2026-05-19 (k) |
| 2026-05-19 | Cursor Agent | Horizontal slip HDG compass (aviation tape style) | 2026-05-19 (j) |
| 2026-05-19 | Cursor Agent | Arrow camera views, HDG compass, horizon compass, radar default, collapsible rules | 2026-05-19 (i) |
| 2026-05-19 | Cursor Agent | Speed presets, D/B camera, radar center aircraft | 2026-05-19 (h) |
| 2026-05-19 | Cursor Agent | Flight history, GPS start, 68 airspaces, label scale, ground follow | 2026-05-19 (g) |
| 2026-05-19 | Cursor Agent | Radar zoom/pan, identify, fly-to, panel title | 2026-05-19 (f) |
| 2026-05-19 | Cursor Agent | E1/E2/E3 fixes: sky, ground z-fight, map tiles, pan flicker | 2026-05-19 (e) |
| 2026-05-19 | Cursor Agent | Sim-speed buttons (1–100×), movement flicker fixes | 2026-05-19 (c) |
| 2026-05-19 | Claude Code (Sonnet, session 53fdf4b8) | Consolidation, audit, 7 bug fixes, doc files written | 2026-05-19 (b) |
| 2026-05-19 | Claude Dispatch ×3 (web) | Initial build of Phase 1 | 2026-05-19 (a) |
