// simMode.js — single source of truth for the simulator's top-level mode.
//
// P5.T7. The render loop previously had to AND/OR four independent flags
// every frame to decide what the sim was doing: `flyTo.active`,
// `tourGuide.isRunning()`, `drone.paused`, and `_applyingHistory`. That
// boolean tangle made mode-transition bugs (e.g. "tour-end leaves the sim
// stuck") hard to localise. This module collapses them into one enum with
// a single transition table, so the loop reads ONE value and every change
// is validated in one place.
//
// Nesting note: a fly-to animation runs WITHIN a tour (the tour drives
// flyTo between stops), so 'flyingTo' is only a top-level mode when NOT
// touring. resolve()'s priority order encodes that — touring outranks
// flyingTo — which is why the loop never observes flyingTo mid-tour.

export const SimMode = Object.freeze({
  FREE: "free",
  FLYING_TO: "flyingTo",
  TOURING: "touring",
  PAUSED: "paused",
  REPLAY: "replay",
});

// Legal transitions for the strict enter() API. Everything funnels through
// FREE between special modes, plus the two real nested/interrupt edges:
// touring↔flyingTo (the tour orchestrates fly-tos) and ↔paused (pause is an
// interrupt that can hit free or touring). Illegal transitions throw so the
// offending call site surfaces immediately instead of silently corrupting
// state.
const LEGAL = {
  free:     new Set(["flyingTo", "touring", "paused", "replay"]),
  flyingTo: new Set(["free", "touring", "paused"]),
  touring:  new Set(["free", "flyingTo", "paused"]),
  paused:   new Set(["free", "touring"]),
  replay:   new Set(["free"]),
};

export class SimModeMachine {
  constructor(onChange = null) {
    this._mode = SimMode.FREE;
    this._onChange = onChange;
  }

  get mode() { return this._mode; }
  is(m) { return this._mode === m; }

  canEnter(next) {
    return next === this._mode || (LEGAL[this._mode]?.has(next) ?? false);
  }

  /**
   * Strict transition. Throws on an illegal edge — this is the guarantee
   * that lets a transition bug fail loudly at its source. Used for explicit
   * programmatic transitions and exercised by the smoke checklist.
   */
  enter(next) {
    if (next === this._mode) return this._mode;
    if (!this.canEnter(next)) {
      throw new Error(`Illegal SimMode transition: ${this._mode} → ${next}`);
    }
    return this._set(next);
  }

  _set(next) {
    const prev = this._mode;
    this._mode = next;
    if (prev !== next) this._onChange?.(next, prev);
    return next;
  }

  /**
   * Tolerant per-frame derivation from the live controller signals. The
   * signals ARE ground truth (a fly-to either is or isn't animating), so
   * resolve() never throws — if the direct edge isn't in LEGAL it routes
   * through FREE rather than rejecting reality. Priority:
   * paused > replay > touring > flyingTo > free. (flyingTo is suppressed
   * while touring because the tour owns the fly-to.)
   */
  resolve(signals) {
    let next;
    if (signals.paused) next = SimMode.PAUSED;
    else if (signals.replaying) next = SimMode.REPLAY;
    else if (signals.touring) next = SimMode.TOURING;
    else if (signals.flyingTo) next = SimMode.FLYING_TO;
    else next = SimMode.FREE;

    if (next === this._mode) return next;
    if (!this.canEnter(next) && this._mode !== SimMode.FREE) {
      this._set(SimMode.FREE);
    }
    return this._set(next);
  }
}
