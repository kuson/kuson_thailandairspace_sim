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

// P3.T3 will fill this in: commanded vs actual tilt lerp, horizontal
// accel from g·tan(actualTilt), vertical thrust integrator, drag.
export class QuadrotorModel {
  constructor({ body, maxTiltRad = 0.35, tauAtt = 0.08, maxClimbMs = 6, tauThrottle = 0.4, kDrag = 0.5 } = {}) {
    this.body = body ?? new RigidBody();
    this.maxTiltRad = maxTiltRad;
    this.tauAtt = tauAtt;
    this.maxClimbMs = maxClimbMs;
    this.tauThrottle = tauThrottle;
    this.kDrag = kDrag;
    this.commandedTilt = new THREE.Vector3();   // x = roll, z = pitch
    this.actualTilt = new THREE.Vector3();
    this.commandedThrust = 0;
    this.currentThrust = 0;
  }

  // P3.T3 will replace this stub with the full second-order controller.
  step(_dt, _input) {
    // intentionally empty — T2 scaffolding only
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
