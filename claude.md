# CLAUDE.md — Operator guide for the Thai Airspace Sim project

> Read this file first in every Claude session that touches this repo.
> Read order at session start: this file → `state_TODO.md` → the latest block in `journal.md` → the matching `spec.md` section.

---

## 0. Project identity

- **What it is:** A single-page, zero-build, browser-only 3D simulator that teaches Thai airspace around Bangkok by letting a user fly a virtual drone through transparent extruded volumes.
- **Why it exists:** Educational — for a Bangkok hobbyist/teen learning what colored shapes on aeronautical charts mean.
- **What it is NOT:** A flight planner. The data is approximate where the AIP uses arcs; the earth is flat; AGL ≡ AMSL ≡ FL for visualisation.
- **Origin:** Built by three Claude Dispatch (web) sessions on 2026-05-19, then consolidated and bug-fixed in a Claude Code review pass on the same day.

---

## 1. Session protocol (mandatory)

Every session starts by reading, in order:

1. **`claude.md`** (this file) — operating principles and project boundaries.
2. **`state_TODO.md`** — single source of truth for what is done and what is open. Pick the first unchecked or `[~]` item that matches the session goal.
3. **`journal.md`** — read the **last block only** to recover the prior session's end-state, decisions, and any unfinished threads.
4. **`spec.md` §6 (acceptance criteria)** — confirm the current build still satisfies them before you make changes.

Every session ends by:

1. Appending **one new block** to `journal.md` (template at §5 below).
2. Updating boxes in `state_TODO.md` only after each pass criterion is verified — never speculatively.
3. Closing all TaskList tasks. No stuck `in_progress` items.
4. If you produced any throwaway files, delete them.

---

## 2. Required skills

A Claude session working on this repo should be ready to use, in roughly decreasing frequency:

| Skill | Why this project needs it |
|---|---|
| **superpowers:using-superpowers** | Loaded at session start; gates the rest of the skills. |
| **superpowers:systematic-debugging** | The codebase has been touched by 3 dispatches in parallel; subtle integration bugs are likely. Don't shortcut to fixes — reproduce, isolate, then patch. |
| **engineering:code-review** | Every PR-equivalent change goes through a review pass. The audit in journal block (b) is the template. |
| **engineering:debug** | For runtime issues (CORS, pointer-lock failure, WebGL context loss). |
| **engineering:testing-strategy** | When the "add smoke-test rig" TODO in `state_TODO.md §3` is picked up. |
| **engineering:documentation** | Keep `spec.md`, `README.md`, and inline comments in sync after behavioural changes. |
| **frontend-design:frontend-design** | UI polish in `index.html` styles and `ui.js` panels. The dark monospace HUD aesthetic is a fixed convention. |
| **design:accessibility-review** | Before adding more interactive controls, run a contrast/keyboard pass. |
| **superpowers:verification-before-completion** | Don't claim "fixed" without either a manual browser check (per `spec.md §6`) or a documented `[?]` in `state_TODO.md`. |
| **superpowers:test-driven-development** | If you're adding logic to `airspace.js` or `coords.js` (pure functions), write a failing test in `tests/` first. UI/Three.js code is exempt — manual verification per the checklist. |
| **superpowers:writing-plans** | For any change touching more than two files. |
| **claude-api** (only if extending) | Not used by the app today. Only relevant if a future phase adds an AI-generated airspace-quiz feature. |

> If the user invokes a skill not in this list, run it — the list is a *floor*, not a ceiling.

---

## 3. Scope discipline

Match the Golden-project methodology used elsewhere in `/Volumes/ExtremeProApple/dev/2026/`:

| Phase | What it means here |
|---|---|
| **Plan** | One row from `state_TODO.md` at a time. Define the pass criterion *before* touching code. |
| **Port** | If a feature exists in `kuson_dronemap` or any 2025 reference, read it end-to-end and adapt rather than blind-copy. |
| **Adapt** | Map types and module conventions to this app's idiom (ESM, no build, vanilla `THREE.MeshBasicMaterial`, no test framework yet). |
| **Verify** | Run the relevant subset of `spec.md §6` in a browser. If browser verification isn't feasible in-session, leave the box `[?]` and note it in journal. |
| **Commit** | This project is **not currently a git repo** (`is git repository: false` per environment). When git is initialised, follow Conventional Commits: `feat(drone): …`, `fix(airspace): …`, `chore(docs): …`. |
| **Journal** | Append a block per §5. |

### What NOT to do

- Don't add features, refactors, or "improvements" beyond the open TODO.
- Don't add docstrings, JSDoc, or type annotations to code you didn't change.
- Don't introduce a build step. No Vite, no Webpack, no TS. ESM + importmap stays.
- Don't introduce a runtime dependency beyond Three.js (already CDN-loaded).
- Don't replace `MeshBasicMaterial` with lit materials unless the spec adds lighting requirements.
- Don't silently fix the VTR8 coordinate mismatch — it's flagged in `state_TODO.md §3` for AIP re-verification.
- Don't change the earth model, the projection, or the 300 km scope without updating `spec.md` first.

---

## 4. Architectural conventions

- **No build step.** ES modules + importmap. If a feature needs npm packaging, file a `[?]` row in `state_TODO.md`, do not unilaterally bring in `node_modules`.
- **Three.js version pinned** to `0.170.0` via importmap. Bumping requires a session block that re-verifies §6.
- **Coordinates:** local tangent plane around `ORIGIN = (13.7563°N, 100.5018°E)`. East = +x, Up = +y, South = +z. Never use latitude/longitude past `coords.js` boundaries — convert at the edges.
- **Airspaces:** JSON-driven. Adding a new volume = one JSON entry. No code change should be needed for typical new volumes.
- **Materials:** `MeshBasicMaterial` everywhere. Unlit by design. Sky and ground use `CanvasTexture` / `TextureLoader` with `colorSpace = SRGBColorSpace`.
- **Globals:** `window.__sim = { scene, camera, drone, layer }` is the supported debug surface — do not remove.
- **Comments:** terse. No "what the code does"; only "why it surprises". The existing comments are the bar.

---

## 5. journal.md block template

```markdown
## YYYY-MM-DD (X) — <short label>

**Operator:** <Claude variant / human>
**Start:** <time + tz>
**Objective:** <one sentence>

### Findings
- …

### Changes applied
- `path/to/file:line` — <what>

### Decisions
- <decision> — because <reason>

### Pending verification
- [ ] <spec.md §6 item that still needs a browser run>

### Session close
- TaskList: <state>
- Files written: <list>
- Open follow-ups added to `state_TODO.md §3`: <list>
```

---

## 6. Quick commands (Bangkok-local conventions)

```sh
# Run the app
cd /Volumes/ExtremeProApple/dev/2026/kuson_thailandairspace_sim
python3 -m http.server 8000
# → http://localhost:8000/

# Quick lint of the project tree (no build, just listing what's there)
ls -la /Volumes/ExtremeProApple/dev/2026/kuson_thailandairspace_sim
find . -type f -not -path './.git/*' -not -path './node_modules/*'

# Re-read dispatch logs (still useful for archeology — see journal.md 2026-05-19 (a))
ls /Users/sintusingha/.claude/projects/-Volumes-ExtremeProApple-dev-2026-kuson-thailandairspace-sim/

# When git is initialised, snapshot before any non-trivial change
git status && git rev-parse --short HEAD
```

---

## 7. Domain norms (for Thai-context engineering questions)

When the user asks about electrical, building, or industrial standards, default to **TIS** (Thai Industrial Standard) and reference Thai bodies (TISI, MEA, PEA, EIT) unless they explicitly request another standard.

When the user asks about aviation regulations specifically, defer to **CAAT** (Civil Aviation Authority of Thailand) and the current **AIP Thailand** at <https://aip.caat.or.th/>. The app's `data/airspaces.json` cites specific AIRAC cycles in each volume's `source` field — use that to know whether a piece of data is from ENR 2.1 (2021-08-12) or ENR 5.1 (2020-11-05).

The disclaimer is non-negotiable: "Educational visualization only. Not for flight planning. Data may be approximate or out of date. Consult CAAT and current AIP Thailand." It appears in the footer, in the README, and in `airspaces.json` metadata. Do not weaken it.

---

## 8. Failure modes seen so far

| Symptom | Likely cause | Remedy |
|---|---|---|
| MCP error -32000: Connection closed | Long ctx_batch_execute pipeline | Re-issue in smaller chunks; never assume the last tool's side-effects completed. (See `journal.md` 2026-05-19 (a) for an example.) |
| `fetch ./data/airspaces.json` 404 / CORS | App opened via `file://` instead of HTTP | Start `python3 -m http.server` per `README.md`. |
| Drone keeps flying after Alt+Tab (legacy bug, fixed 2026-05-19) | Held key not removed when window lost focus | `window.blur → keys.clear()` — already in place. Don't reintroduce. |
| Hover indicator shows but movement continues (legacy bug, fixed 2026-05-19) | Old code only zeroed `vy` when no keys were pressed | Fixed by gating all WASD/QE inside `if (!this.hover)`. Don't reintroduce. |
| OSM tiles never appear | OSM blocked the referrer, CORS denial, or the user's network is offline | Procedural green fallback is intentional; not an error. |

---

## 9. When in doubt

Re-read `spec.md`. The spec is the contract. If the spec says X and the code does Y, the code is wrong unless the user is explicitly changing the contract — in which case update `spec.md` *first*, then the code.
