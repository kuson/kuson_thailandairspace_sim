// atc.js — ATC radio call grammar and radio log (B7.T5).
//
// AtcRadio generates formatted ATC-style contact messages for a given
// airspace, publishes them into the alert queue at RADIO tier (auto-retracted
// after 10 s), and maintains a subscriber-notified log capped at 20 entries.
//
// Deps injected at construction:
//   layer       — AirspaceLayer instance (compiled array with centroid + airspace).
//   getDronePos — () => { x, y, z } world-space position (X=East, Z south-positive).
//   alerts      — AlertQueue singleton.
//   AlertTier   — frozen tier object (must include RADIO member).

export class AtcRadio {
  /**
   * @param {{ layer: object, getDronePos: Function, alerts: object, AlertTier: object }} deps
   */
  constructor({ layer, getDronePos, alerts, AlertTier }) {
    this.layer       = layer;
    this.getDronePos = getDronePos;
    this.alerts      = alerts;
    this.AlertTier   = AlertTier;

    /** @type {Array<{ts: number, message: string, airspaceId: string}>} */
    this.log = [];

    this._seq       = 0;
    this._timers    = new Map(); // key -> setTimeout handle
    this._listeners = [];
  }

  // ── emitter ────────────────────────────────────────────────────────────────

  /**
   * Subscribe to log updates.  Callback receives the new log entry.
   * @param {Function} cb
   * @returns {Function} unsubscribe
   */
  onMessage(cb) {
    this._listeners.push(cb);
    return () => {
      const i = this._listeners.indexOf(cb);
      if (i >= 0) this._listeners.splice(i, 1);
    };
  }

  _emit(entry) {
    for (const fn of this._listeners) fn(entry);
  }

  // ── public API ─────────────────────────────────────────────────────────────

  /**
   * Generate and publish an ATC radio call for the given airspace.
   *
   * @param {{ airspaceId: string, count?: number, kind?: string }} opts
   * @returns {{ ts: number, message: string, airspaceId: string } | null}
   */
  call({ airspaceId, count = 1, kind = "contact" }) {
    const compiled = this.layer.compiled;
    const cell = compiled.find((c) => c.airspace.id === airspaceId);
    if (!cell) {
      console.error(`[AtcRadio] airspace not found: ${airspaceId}`);
      return null;
    }

    const { centroid, airspace } = cell;
    const { shortName, lowerFt, upperFt } = airspace;

    // Bearing / distance from drone to centroid.
    // Coordinate system: X=East, Z=south-positive (north-negated).
    const pos = this.getDronePos();
    const dx  = centroid.x - pos.x;
    const dz  = centroid.z - pos.z;
    const brg = Math.round((Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360);
    const distM = Math.sqrt(dx * dx + dz * dz);
    const nm    = Math.round(distM / 1852);

    // Mid-band altitude in thousands of ft, minimum 1.
    const kft = Math.max(1, Math.round((lowerFt + upperFt) / 2 / 1000));

    const s       = count === 1 ? "" : "s";
    const brgStr  = String(brg).padStart(3, "0");
    const message = `${count} contact${s} — ${shortName}, bears ${brgStr}° for ${nm} nm, angels ${kft}`;

    // Publish into the alert queue and auto-retract after 10 s.
    const key = `radio.${this._seq++}`;
    this.alerts.publish({ key, tier: this.AlertTier.RADIO, message });

    const handle = setTimeout(() => {
      this.alerts.retract(key);
      this._timers.delete(key);
    }, 10_000);
    this._timers.set(key, handle);

    // Maintain the log (newest first, capped at 20).
    const entry = { ts: Date.now(), message, airspaceId };
    this.log.unshift(entry);
    if (this.log.length > 20) this.log.length = 20;

    this._emit(entry);
    return entry;
  }

  /** Cancel all pending retract timers. Call when tearing down. */
  dispose() {
    for (const handle of this._timers.values()) clearTimeout(handle);
    this._timers.clear();
  }
}
