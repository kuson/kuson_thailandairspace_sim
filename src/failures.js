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

// P4.T2: Return-to-Home state machine.
//
// Pure state machine — no THREE, no DOM. The host Drone passes telemetry
// in and applies the override stick state to its quadrotor controller
// in place of the human pilot's input. Three trigger paths:
//   1. Battery telemetry.batteryPct drops below LOW_BAT_PCT (25%).
//   2. Signal-loss telemetry.signalLostS exceeds SIGNAL_TIMEOUT_S (3 s).
//      [Wired in P4.T3 — for now the host passes null.]
//   3. Manual engage() via the H key.
//
// States:
//   INACTIVE
//   → ASCEND        climb to home.y + rthAltitudeAGL  (60 m default)
//   → FLY_HOME      face launch, glide forward to within 5 m laterally
//   → DESCEND       throttle down to land
//   → LANDED        terminal state; .active drops to false
//
// Mavic-only by contract: the host only calls step() from _updateDrone
// (FlightMode.DRONE), so the override sticks ride the QuadrotorModel
// pipeline.
const RTH_DEFAULTS = Object.freeze({
  rthAltitudeAGL: 60,    // metres above launch elevation
  lowBatteryPct: 25,
  signalTimeoutS: 3,
  arriveRadiusM: 5,      // FLY_HOME → DESCEND when within this lateral m
  landY: 2,              // DESCEND → LANDED when y drops below this
});

export class ReturnToHome {
  constructor(opts = {}) {
    Object.assign(this, RTH_DEFAULTS, opts);
    this.home = { x: 0, y: 0, z: 0 };
    this.active = false;
    /** 'manual' | 'battery' | 'signal' | null */
    this.reason = null;
    /** 'INACTIVE' | 'ASCEND' | 'FLY_HOME' | 'DESCEND' | 'LANDED' */
    this.state = "INACTIVE";
  }

  /** Snap the launch position. Host calls this on first DRONE-mode
   *  takeoff (y >= 1.5 m heuristic) or on explicit user "set home". */
  setHome(pos) {
    this.home = { x: pos.x, y: pos.y, z: pos.z };
  }

  engage(reason) {
    if (this.active) return;
    this.active = true;
    this.reason = reason ?? "manual";
    this.state = "ASCEND";
  }

  disengage() {
    this.active = false;
    this.reason = null;
    this.state = "INACTIVE";
  }

  /**
   * Advance the state machine.
   * @param {number} dt seconds
   * @param {{
   *   position: { x:number, y:number, z:number },
   *   yaw: number,
   *   batteryPct?: number|null,    // null = no battery telemetry
   *   signalLostS?: number|null,   // null = no signal telemetry (T3)
   * }} telemetry
   * @returns {{
   *   pitchStick:number, rollStick:number, throttleStick:number,
   *   yaw:number, state:string, reason:string|null
   * } | null}
   *   override stick state when active, null otherwise so the host
   *   keeps pilot input.
   */
  step(dt, telemetry) {
    // Auto-trigger conditions (only when currently inactive).
    if (!this.active) {
      if (telemetry.batteryPct != null && telemetry.batteryPct < this.lowBatteryPct) {
        this.engage("battery");
      } else if (telemetry.signalLostS != null && telemetry.signalLostS > this.signalTimeoutS) {
        this.engage("signal");
      }
    }
    if (!this.active) return null;

    const pos = telemetry.position;
    const dx = this.home.x - pos.x;
    const dz = this.home.z - pos.z;
    const lateralDist = Math.hypot(dx, dz);
    const targetY = this.home.y + this.rthAltitudeAGL;

    let pitchStick = 0, rollStick = 0, throttleStick = 0;
    let yaw = telemetry.yaw;

    switch (this.state) {
      case "ASCEND":
        throttleStick = +1;
        if (pos.y >= targetY - 2) {
          this.state = "FLY_HOME";
        }
        break;

      case "FLY_HOME":
        if (lateralDist > this.arriveRadiusM) {
          // Face launch (yaw convention matches Drone.forward(): forward
          // unit vec = (-sin yaw, _, -cos yaw)). To point at (dx, dz)
          // solve -sin yaw = dx/|d|, -cos yaw = dz/|d|.
          yaw = Math.atan2(-dx, -dz);
          // Mavic: pitchStick = -1 commands nose-down = forward flight.
          pitchStick = -1;
          throttleStick = 0;     // hold altitude
        } else {
          this.state = "DESCEND";
        }
        break;

      case "DESCEND":
        throttleStick = -1;
        if (pos.y < this.landY) {
          this.state = "LANDED";
        }
        break;

      case "LANDED":
        // Stay parked; host battery reset handles recharge after 2 s.
        this.active = false;
        break;
    }

    return { pitchStick, rollStick, throttleStick, yaw,
             state: this.state, reason: this.reason };
  }
}
