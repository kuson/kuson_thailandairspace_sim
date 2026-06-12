// gameMode.js — finite-state machine for the game flow.
//
// States cycle IDLE → BRIEFING → WAVE → DEBRIEF → IDLE.  abort() is legal
// from any non-IDLE state and short-circuits back to IDLE immediately.
// The class is inert while IDLE: update() returns at the top without touching
// any dep.  Later tasks fill the BRIEFING/WAVE/DEBRIEF bodies.
//
// Deps injected at construction:
//   layer      — AirspaceLayer instance (wave geometry queries).
//   startFlyTo — the function defined in main.js (camera transition).
//   getDronePos — () => drone.position (live world-space position).
//   atc        — AtcRadio instance (optional; wired in B7.T5).
//   ufos       — UfoLayer instance (optional; wired in B7.T6).

const LEGAL = {
  IDLE:     ["BRIEFING"],
  BRIEFING: ["WAVE", "IDLE"],
  WAVE:     ["DEBRIEF", "IDLE"],
  DEBRIEF:  ["IDLE"],
};

export class GameMode {
  /** @param {{ layer: object, startFlyTo: Function, getDronePos: Function, atc?: object, ufos?: object }} deps */
  constructor({ layer, startFlyTo, getDronePos, atc, ufos }) {
    this.layer       = layer;
    this.startFlyTo  = startFlyTo;
    this.getDronePos = getDronePos;
    this.atc         = atc  ?? null;
    this.ufos        = ufos ?? null;
    this.state       = "IDLE";
    this._listeners  = new Map(); // event -> Set<cb>
  }

  // ── tiny emitter ───────────────────────────────────────────────────────────

  /**
   * Subscribe to an event.
   * @param {string} event
   * @param {Function} cb
   * @returns {Function} unsubscribe
   */
  on(event, cb) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(cb);
    return () => this._listeners.get(event)?.delete(cb);
  }

  /** @param {string} event  @param {*} payload */
  _emit(event, payload) {
    this._listeners.get(event)?.forEach((cb) => cb(payload));
  }

  // ── transition guard ───────────────────────────────────────────────────────

  /**
   * Attempt a state transition.  Logs and returns false if illegal.
   * @param {string} next
   * @returns {boolean}
   */
  _enter(next) {
    if (!LEGAL[this.state]?.includes(next)) {
      console.error(`[GameMode] illegal transition ${this.state} → ${next}`);
      return false;
    }
    this.state = next;
    this._emit("state", next);
    return true;
  }

  // ── public API ─────────────────────────────────────────────────────────────

  /** Transition IDLE → BRIEFING. */
  start() {
    return this._enter("BRIEFING");
  }

  /** Return to IDLE from any non-IDLE state; emits "abort" first. */
  abort() {
    if (this.state === "IDLE") return;
    this._emit("abort", this.state);
    this.state = "IDLE";
    this._emit("state", "IDLE");
  }

  /**
   * Per-frame tick.  Returns immediately in IDLE (no dep access).
   * @param {number} dt  seconds since last frame
   */
  update(dt) {
    if (this.state === "IDLE") return;
    switch (this.state) {
      case "BRIEFING":
        // placeholder — B7.T5+ will fill this body
        break;
      case "WAVE":
        // placeholder — B7.T8 will fill this body
        break;
      case "DEBRIEF":
        // placeholder — B7.T8 will fill this body
        break;
    }
  }
}
