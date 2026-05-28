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

// P3.T5 will fill this in: airspeed, pitch (γ), bank, yaw, throttle;
// drag, thrust, stall, induced drag with bank.
export class FixedWingModel {
  constructor({ body, Vs = 24.7, Vne = 80, clMax = 1.4, cd0 = 0.027, thrustMax = 800, mass = 757 } = {}) {
    this.body = body ?? new RigidBody({ mass });
    this.Vs = Vs;
    this.Vne = Vne;
    this.clMax = clMax;
    this.cd0 = cd0;
    this.thrustMax = thrustMax;
    this.airspeedMs = 0;
    this.pitchRad = 0;
    this.bankRad = 0;
    this.yawRad = 0;
    this.throttle = 0;
  }

  // P3.T5 will replace this stub with stall + energy-trade logic.
  step(_dt, _input) {
    // intentionally empty — T2 scaffolding only
  }
}
