// flyto.js — smooth camera/drone transitions for catalog fly-to and undo/redo.
import * as THREE from "three";

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

export class FlyToController {
  constructor(drone) {
    this.drone = drone;
    this.active = false;
    this.t = 0;
    this.duration = 2.8;
    this.from = null;
    this.to = null;
    this.onComplete = null;
  }

  start(to, { duration = 0.45, onComplete, from } = {}) {
    this.from = from ?? {
      x: this.drone.position.x,
      y: this.drone.position.y,
      z: this.drone.position.z,
      yaw: this.drone.bodyYaw,
      pitch: this.drone.bodyPitch,
    };
    this.to = { ...to };
    this.t = 0;
    this.duration = duration;
    this.onComplete = onComplete ?? null;
    this.active = true;
    this.drone.flightLocked = true;
    this.drone.cameraMode = null;
  }

  cancel() {
    this.active = false;
    this.drone.flightLocked = false;
  }

  update(dt) {
    if (!this.active) return false;
    this.t += dt;
    const u = smoothstep(Math.min(1, this.t / this.duration));
    const f = this.from;
    const t = this.to;
    this.drone.position.set(
      f.x + (t.x - f.x) * u,
      f.y + (t.y - f.y) * u,
      f.z + (t.z - f.z) * u,
    );
    this.drone.bodyYaw = lerpAngle(f.yaw, t.yaw, u);
    this.drone.bodyPitch = lerpAngle(f.pitch, t.pitch, u);
    this.drone.yaw = this.drone.bodyYaw;
    this.drone.pitch = this.drone.bodyPitch;
    this.drone._syncCamera();
    if (this.t >= this.duration) {
      this.active = false;
      this.drone.flightLocked = false;
      this.drone.hover = false;
      this.onComplete?.();
    }
    return true;
  }
}
