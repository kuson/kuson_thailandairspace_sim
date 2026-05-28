// P3.T2: physics scaffolding for Phase 3.
//
// RigidBody owns position / velocity / attitude / angular velocity and
// integrates them with semi-implicit Euler (velocity-first, then
// position). QuadrotorModel and FixedWingModel are stubs that wrap a
// RigidBody and will be filled in by P3.T3 (Mavic 3 second-order
// controller) and P3.T5 (fixed-wing stall + energy trade) respectively.
//
// Pass criterion for T2 (console probe): given v=(1,0,0) m/s, run 60
// steps at 1/120 s → position.x ≈ 0.5 m within float epsilon.

import * as THREE from "three";

const _scratchQ = new THREE.Quaternion();
const _scratchV = new THREE.Vector3();

export class RigidBody {
  constructor({ mass = 1, position, velocity, attitudeQ, angularVelocity } = {}) {
    this.mass = mass;
    this.position = position ?? new THREE.Vector3();
    this.velocity = velocity ?? new THREE.Vector3();
    this.attitudeQ = attitudeQ ?? new THREE.Quaternion();
    this.angularVelocity = angularVelocity ?? new THREE.Vector3();
  }

  // Semi-implicit Euler: integrate velocity first, then advance position
  // using the *new* velocity. Stable for the dt range (1/120 s) we use.
  // `force` and `torque` are world-frame vectors; either may be omitted
  // for a ballistic step.
  step(dt, force, torque) {
    if (force) {
      this.velocity.addScaledVector(force, dt / this.mass);
    }
    this.position.addScaledVector(this.velocity, dt);

    if (torque) {
      this.angularVelocity.addScaledVector(torque, dt / this.mass);
    }
    const w = this.angularVelocity;
    const wLen = w.length();
    if (wLen > 1e-9) {
      const half = wLen * dt * 0.5;
      const s = Math.sin(half) / wLen;
      _scratchQ.set(w.x * s, w.y * s, w.z * s, Math.cos(half));
      this.attitudeQ.premultiply(_scratchQ).normalize();
    }
  }
}

// P3.T3: second-order quadrotor controller for Mavic 3 (DRONE flightMode).
//
// State held here (not in the host Drone): the tilt actuator (commanded vs
// actual pitch/roll), the throttle actuator (commanded climb vs current
// climb), and a world-frame horizontal velocity. The host owns yaw (mouse
// look) and the world position vector; step() mutates the position in place
// and returns the new attitude so the Drone can publish bodyPitch / bodyRoll
// to the HUD.
//
// Sign conventions match Three.js mesh.rotation with order "YXZ":
//   - actualPitch > 0 = nose UP  (X-rotation: +Y → +Z)
//   - actualRoll  > 0 = left bank (Z-rotation: +X → +Y, right wing up)
// Sticks therefore command:
//   - pitchStick = +1 → nose-up command (W in this sim binds to -1, S to +1)
//   - rollStick  = +1 → left-bank command (A to +1, D to -1)
//   - throttleStick = +1 → climb (E to +1, Q to -1)
//
// Horizontal accel comes from leaning the lift vector:
//   a_forward_body = -g · tan(actualPitch)   (+pitch = nose-up = backward)
//   a_right_body   = -g · tan(actualRoll)    (+roll  = left bank = leftward)
// Rotated into world by yaw; drag = -velocity · K_DRAG.
//
// Vertical: throttle commands a target climb rate (m/s); current climb rate
// lerps toward it with time constant TAU_THROTTLE. No gravity-vs-thrust
// integration — the controller acts like an altitude-hold drone (which is
// what the Mavic 3 does in P-mode), not a free body.
export class QuadrotorModel {
  constructor({ body, maxTiltRad = 0.35, tauAtt = 0.08, maxClimbMs = 6, tauThrottle = 0.4, kDrag = 0.5 } = {}) {
    this.body = body ?? new RigidBody();
    this.maxTiltRad = maxTiltRad;
    this.tauAtt = tauAtt;
    this.maxClimbMs = maxClimbMs;
    this.tauThrottle = tauThrottle;
    this.kDrag = kDrag;

    // Actuator state.
    this.commandedPitch = 0;
    this.commandedRoll = 0;
    this.actualPitch = 0;
    this.actualRoll = 0;
    this.commandedClimb = 0;     // m/s target
    this.currentClimb = 0;       // m/s actual (lags commanded by tauThrottle)

    // World-frame horizontal velocity (y-component unused; vertical lives in
    // currentClimb). Persisted so coast-to-stop produces a visible decay.
    this.velocityHoriz = new THREE.Vector3();
  }

  /**
   * Reset all actuator + velocity state. Called on mode entry / preset change
   * so a stale lean doesn't carry over when the user switches aircraft.
   */
  reset() {
    this.commandedPitch = 0;
    this.commandedRoll = 0;
    this.actualPitch = 0;
    this.actualRoll = 0;
    this.commandedClimb = 0;
    this.currentClimb = 0;
    this.velocityHoriz.set(0, 0, 0);
  }

  /**
   * Advance one fixed step.
   * @param {number} dt seconds (host enforces 1/120).
   * @param {{
   *   pitchStick: number,     // [-1,+1], +1 = nose-up command
   *   rollStick: number,      // [-1,+1], +1 = left-bank command
   *   throttleStick: number,  // [-1,+1], +1 = climb command
   *   yaw: number,            // bodyYaw rad (Three.js Y-rotation)
   *   position: THREE.Vector3 // mutated in place
   * }} input
   * @returns {{pitch:number, roll:number, climb:number, horizSpeed:number}}
   */
  step(dt, input) {
    const G = 9.81;
    const clamp1 = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);

    this.commandedPitch = clamp1(input.pitchStick) * this.maxTiltRad;
    this.commandedRoll  = clamp1(input.rollStick)  * this.maxTiltRad;
    this.commandedClimb = clamp1(input.throttleStick) * this.maxClimbMs;

    // First-order actuator lag. Using dt/tau capped at 1 so an oversize step
    // (after a long pause) just snaps to target instead of overshooting.
    const tiltAlpha = Math.min(1, dt / this.tauAtt);
    this.actualPitch += (this.commandedPitch - this.actualPitch) * tiltAlpha;
    this.actualRoll  += (this.commandedRoll  - this.actualRoll)  * tiltAlpha;

    const throttleAlpha = Math.min(1, dt / this.tauThrottle);
    this.currentClimb += (this.commandedClimb - this.currentClimb) * throttleAlpha;

    // Body-frame accel from tilt.
    const a_fwd_body   = -G * Math.tan(this.actualPitch);
    const a_right_body = -G * Math.tan(this.actualRoll);

    // Rotate body accel into world using yaw only (level-flight approximation
    // — exact for small tilts, which is everything ≤ MAX_TILT_RAD = 20°).
    // Matches Drone.forward()/right() at pitch=0.
    const sy = Math.sin(input.yaw), cy = Math.cos(input.yaw);
    const fwdX = -sy, fwdZ = -cy;
    const rgtX =  cy, rgtZ = -sy;
    let ax = a_fwd_body * fwdX + a_right_body * rgtX;
    let az = a_fwd_body * fwdZ + a_right_body * rgtZ;

    // Horizontal drag.
    ax -= this.velocityHoriz.x * this.kDrag;
    az -= this.velocityHoriz.z * this.kDrag;

    // Semi-implicit Euler: integrate velocity first, then position.
    this.velocityHoriz.x += ax * dt;
    this.velocityHoriz.z += az * dt;
    input.position.x += this.velocityHoriz.x * dt;
    input.position.z += this.velocityHoriz.z * dt;
    input.position.y += this.currentClimb * dt;

    return {
      pitch: this.actualPitch,
      roll: this.actualRoll,
      climb: this.currentClimb,
      horizSpeed: Math.hypot(this.velocityHoriz.x, this.velocityHoriz.z),
    };
  }
}

// P3.T5: second-order fixed-wing flight model with stall + energy trade.
//
// State held here (not in the host Drone): airspeed scalar, flight-path
// angle γ (pitchRad — pitch and γ are conflated by the lift=weight
// assumption — exact in coordinated level flight, close enough at the
// shallow climbs/descents this sim supports), bank, throttle, and the
// target bank (for the A/D ease-to-level behaviour). The host owns yaw
// (mouse-look adds to it) and the world position; step() mutates the
// position in place and returns the new attitude + airspeed + a yawDelta
// so the host can advance bodyYaw.
//
// Energy trade: dv = (thrust - drag - m·g·sin(γ)) / m · dt.
// Pitching up at idle bleeds airspeed via the gravity term until v drops
// below 1.05·Vs, at which point a fixed-rate nose-down rotation forces
// recovery (γ -= 0.5·dt rad/s) plus a small altitude sink (-5 m/s) so
// the stall is felt as both pitch drop and altitude loss.
//
// Bank coupling: induced drag rises with bank because load factor
// n = 1/cos(bank) → required cl² scales as 1/cos²(bank). Total drag
// coefficient cd = cd0 + kInduced · (1/cos(bank))². At 45° this doubles
// the induced term, so a sustained 45° bank bleeds airspeed unless the
// throttle is pushed.
//
// Yaw rate from bank: ω = g · tan(bank) / max(v, Vs)  — the level-turn
// equation (unchanged from the old _updateAirplane). The host adds the
// returned yawDelta to bodyYaw each step.
//
// Sign conventions match Three.js mesh.rotation with order "YXZ":
//   - pitchRad > 0 = nose UP   (E key adds, Q key subtracts)
//   - bankRad  > 0 = left bank (A key adds, D key subtracts)
//
// Per-preset aero tuning lives in FW_PRESETS below; configure(presetId)
// switches the model to a preset and rebalances throttle so the new
// preset enters at its cruise speed without bleeding off immediately.
export const FW_PRESETS = {
  cessna172: {
    Vs: 23.5, Vne: 80, clMax: 1.4, cd0: 0.027, kInduced: 0.013,
    wingAreaM2: 16.2, mass: 1100, thrustMax: 2200, cruiseMs: 62.8,
    spoolTimeS: 3,         // P3.T8: small piston, fast power response
  },
  learjet: {
    Vs: 47, Vne: 195, clMax: 1.6, cd0: 0.020, kInduced: 0.013,
    wingAreaM2: 23.5, mass: 8300, thrustMax: 35000, cruiseMs: 236,
    spoolTimeS: 5,         // P3.T8: small jet, moderate spool
  },
  b777: {
    Vs: 71, Vne: 280, clMax: 1.8, cd0: 0.018, kInduced: 0.013,
    wingAreaM2: 428, mass: 250000, thrustMax: 880000, cruiseMs: 256,
    spoolTimeS: 8,         // P3.T8: heavy turbofan, slow spool
  },
};

export class FixedWingModel {
  constructor(opts = {}) {
    this.body = opts.body ?? new RigidBody({ mass: opts.mass ?? 1100 });
    // Aero tuning defaults to Cessna 172; overwritten by configure().
    Object.assign(this, FW_PRESETS.cessna172, opts);

    this.airspeedMs = this.cruiseMs;
    this.pitchRad = 0;
    this.bankRad = 0;
    this._targetBank = 0;
    this.targetThrottle = this._cruiseThrottle();
    this.throttleRateScale = 1 / (this.spoolTimeS || 2);
    this.throttle = this.targetThrottle;
    this._spoolActive = false;       // default-constructed: no preset switch yet
    this.stalled = false;
  }

  /** Throttle needed to balance drag at level cruise — keeps a preset
   *  switch from immediately bleeding airspeed. */
  _cruiseThrottle() {
    const RHO = 1.225;
    const v = this.cruiseMs;
    const cd = this.cd0 + this.kInduced;     // level flight, loadFactor=1
    const drag = 0.5 * RHO * v * v * cd * this.wingAreaM2;
    return Math.min(1, drag / this.thrustMax);
  }

  /**
   * Switch aero tuning to a preset and rebalance airspeed / throttle.
   * Returns true on success, false if presetId isn't a fixed-wing.
   *
   * P3.T8: throttle enters at 0 (idle) with the cruise-throttle stored
   * as targetThrottle. step() lerps toward the target at the per-preset
   * spool rate (1 / spoolTimeS) so a 777 takes ~8 s of auto-spool to
   * reach cruise power, a Cessna ~3 s. Any user stick input cancels
   * the auto-spool (the human takes over) but still moves throttle at
   * the per-preset rate, so heavy aircraft also feel sluggish under
   * direct commands.
   */
  configure(presetId) {
    const cfg = FW_PRESETS[presetId];
    if (!cfg) return false;
    Object.assign(this, cfg);
    this.airspeedMs = cfg.cruiseMs;
    this.pitchRad = 0;
    this.bankRad = 0;
    this._targetBank = 0;
    this.targetThrottle = this._cruiseThrottle();
    this.throttleRateScale = 1 / (cfg.spoolTimeS || 2);
    this.throttle = 0;            // idle on preset switch - spool-up felt
    this._spoolActive = true;     // auto-ramp toward targetThrottle
    this.stalled = false;
    return true;
  }

  /**
   * Advance one fixed step.
   * @param {number} dt seconds (host enforces 1/120).
   * @param {{
   *   pitchStick: number,     // [-1,+1], +1 = nose-up command (E key)
   *   rollStick: number,      // [-1,+1], +1 = left-bank command (A key)
   *   throttleStick: number,  // [-1,+1], +1 = throttle up (W key)
   *   yaw: number,            // bodyYaw rad
   *   position: THREE.Vector3 // mutated in place
   * }} input
   * @returns {{pitch:number, roll:number, yawDelta:number,
   *            airspeed:number, throttle:number, stalled:boolean}}
   */
  step(dt, input) {
    const G = 9.81;
    const RHO = 1.225;
    const clamp1 = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);

    // ---- Throttle (W = up, S = down) ----
    // P3.T8: rate is per-preset (1 / spoolTimeS). Auto-spool toward
    // targetThrottle runs only after a fresh preset switch and is
    // cancelled by any direct stick input.
    const tStick = clamp1(input.throttleStick);
    if (tStick !== 0) {
      this._spoolActive = false;
      this.throttle += tStick * this.throttleRateScale * dt;
    } else if (this._spoolActive) {
      const delta = this.targetThrottle - this.throttle;
      const slew = this.throttleRateScale * dt;
      if (Math.abs(delta) <= slew) {
        this.throttle = this.targetThrottle;
        this._spoolActive = false;
      } else {
        this.throttle += (delta > 0 ? slew : -slew);
      }
    }
    if (this.throttle < 0) this.throttle = 0;
    if (this.throttle > 1.2) this.throttle = 1.2;

    // ---- Roll command (A/D) ----
    const ROLL_MAX = Math.PI / 4;                   // ±45°
    const ROLL_RATE = (90 * Math.PI) / 180;         // 90°/s commanded
    const rollCmd = clamp1(input.rollStick);
    if (rollCmd !== 0) {
      this._targetBank += rollCmd * ROLL_RATE * dt;
    } else {
      this._targetBank *= Math.max(0, 1 - dt * 1.2);   // ease to level
    }
    if (this._targetBank < -ROLL_MAX) this._targetBank = -ROLL_MAX;
    if (this._targetBank >  ROLL_MAX) this._targetBank =  ROLL_MAX;
    this.bankRad += (this._targetBank - this.bankRad) * Math.min(1, dt * 4.5);

    // ---- Pitch command (Q = down, E = up) ----
    const PITCH_RATE = (35 * Math.PI) / 180;        // 35°/s
    this.pitchRad += clamp1(input.pitchStick) * PITCH_RATE * dt;

    // ---- Stall: below 1.05·Vs, force nose-down + extra altitude sink.
    // Applied AFTER pitch stick so the stall always pulls toward recovery
    // even if the user is holding nose-up.
    const stallThreshold = 1.05 * this.Vs;
    this.stalled = this.airspeedMs < stallThreshold;
    if (this.stalled) {
      this.pitchRad -= 0.5 * dt;
      input.position.y -= 5 * dt;
    }
    const PITCH_LIM = (60 * Math.PI) / 180;
    if (this.pitchRad < -PITCH_LIM) this.pitchRad = -PITCH_LIM;
    if (this.pitchRad >  PITCH_LIM) this.pitchRad =  PITCH_LIM;

    // ---- Aero forces ----
    const v = Math.max(this.airspeedMs, 0.1);
    const loadFactor = 1 / Math.cos(this.bankRad);          // n
    const cd = this.cd0 + this.kInduced * loadFactor * loadFactor;
    const drag = 0.5 * RHO * v * v * cd * this.wingAreaM2;
    const thrust = this.throttle * this.thrustMax;

    // dv = (thrust - drag - m·g·sin(γ)) / m · dt
    const dv = (thrust - drag - this.mass * G * Math.sin(this.pitchRad)) / this.mass * dt;
    this.airspeedMs += dv;
    if (this.airspeedMs < 0) this.airspeedMs = 0;
    if (this.airspeedMs > this.Vne) this.airspeedMs = this.Vne;

    // ---- Yaw rate from bank (level-turn equation) ----
    const yawRate = (G * Math.tan(this.bankRad)) / Math.max(v, this.Vs);
    const yawDelta = yawRate * dt;

    // ---- Translation: velocity vector points along (yaw, pitch).
    // Use input.yaw (pre-delta) — at 1/120 s the in-step yaw change is
    // ~ 1e-3 rad and the per-step position step is small enough that the
    // accumulated yaw error vanishes.
    const cosP = Math.cos(this.pitchRad), sinP = Math.sin(this.pitchRad);
    const fx = -Math.sin(input.yaw) * cosP;
    const fy =  sinP;
    const fz = -Math.cos(input.yaw) * cosP;
    input.position.x += fx * this.airspeedMs * dt;
    input.position.y += fy * this.airspeedMs * dt;
    input.position.z += fz * this.airspeedMs * dt;

    return {
      pitch: this.pitchRad,
      roll: this.bankRad,
      yawDelta,
      airspeed: this.airspeedMs,
      throttle: this.throttle,
      stalled: this.stalled,
    };
  }
}
