// P4.T1: failure & systems models. BatterySystem first; ReturnToHome,
// RadioLink, Geofence follow in P4.T2 / T3 / T5.
//
// All classes here are pure (no THREE / DOM dependency) so the math can
// be unit-tested in Node. The host Drone owns one instance of each and
// drives them from physicsStep with a small telemetry snapshot.

const DEFAULT_BATTERY = Object.freeze({
  hoverMinutes: 22,         // % per second @ pure hover  = 100 / 22·60
  cruiseMinutes: 28,        // % per second @ pure cruise (forward flight)
  maxThrottleMinutes: 15,   // % per second @ max throttle (climb / sport)
  /** Below this AGL+heuristic, count as on-ground for landing-detect. */
  groundY: 1.5,
  /** Seconds on ground before pct resets to 100. */
  groundResetSeconds: 2,
});

/**
 * Battery model for the Mavic 3 (DRONE mode). State of charge depletes
 * each step based on activity classification:
 *   - climb |vz| > 1.5 m/s              → max-throttle rate  (15-min full)
 *   - else if horizontal speed > 3 m/s  → cruise rate         (28-min full)
 *   - else                              → hover rate          (22-min full)
 * Voltage is interpolated linearly between 4S LiPo per-cell endpoints
 * (3.3 V empty / 4.2 V full) for HUD purposes - real LiPo curves dip
 * sharply near the ends but the simulation-grade linear approximation
 * is enough for the educational target.
 *
 * The chip color band lives on .state ('green' | 'yellow' | 'red').
 *
 * Pass criterion (playbook P4.T1):
 *   Mavic 3 in DRONE mode for 5 min of mixed flying → battery drops ~20%.
 *   With the calibrated rates above, 5 min pure hover loses 22.7 %,
 *   5 min pure cruise loses 17.9 %; mixed flying lands ~20 %.
 */
export class BatterySystem {
  constructor(opts = {}) {
    const cfg = { ...DEFAULT_BATTERY, ...opts };
    this.hoverRate  = 100 / (cfg.hoverMinutes        * 60);
    this.cruiseRate = 100 / (cfg.cruiseMinutes       * 60);
    this.maxRate    = 100 / (cfg.maxThrottleMinutes  * 60);
    this.groundY = cfg.groundY;
    this.groundResetSeconds = cfg.groundResetSeconds;

    this.pct = 100;
    this.voltage = 4.2;          // per cell
    this.state = "green";        // 'green' | 'yellow' | 'red'
    /** True while telemetry.isDroneMode — controls whether the chip
     *  shows live or is dimmed (handled by the UI layer). */
    this.active = false;
    this._groundT = 0;
  }

  /**
   * Advance the battery one substep.
   * @param {number} dt seconds
   * @param {{
   *   isDroneMode: boolean,
   *   climbMs: number,         // signed vertical speed (m/s)
   *   horizSpeedMs: number,    // horizontal ground speed (m/s)
   *   onGround?: boolean,      // optional override; computed from y if absent
   *   y?: number,              // world-frame altitude (used when onGround omitted)
   * }} telemetry
   */
  step(dt, telemetry) {
    this.active = !!telemetry?.isDroneMode;
    if (!this.active) return;

    const onGround = telemetry.onGround
      ?? (telemetry.y != null && telemetry.y < this.groundY);

    if (onGround) {
      this._groundT += dt;
      if (this._groundT >= this.groundResetSeconds) {
        // Sustained ground contact → "battery swap" reset. No further
        // drain while parked — the Mavic isn't burning energy on the pad.
        this.pct = 100;
        this.voltage = 4.2;
        this.state = "green";
        return;
      }
    } else {
      this._groundT = 0;
    }

    // Activity classification → drain rate.
    const climb = Math.abs(telemetry.climbMs ?? 0);
    const horiz = telemetry.horizSpeedMs ?? 0;
    let rate;
    if (climb > 1.5) {
      rate = this.maxRate;
    } else if (horiz > 3) {
      rate = this.cruiseRate;
    } else {
      rate = this.hoverRate;
    }

    this.pct -= rate * dt;
    if (this.pct < 0) this.pct = 0;

    // Per-cell voltage (linear, sim grade).
    this.voltage = 3.3 + 0.9 * (this.pct / 100);

    if (this.pct >= 30) this.state = "green";
    else if (this.pct >= 20) this.state = "yellow";
    else this.state = "red";
  }

  reset() {
    this.pct = 100;
    this.voltage = 4.2;
    this.state = "green";
    this._groundT = 0;
  }
}
