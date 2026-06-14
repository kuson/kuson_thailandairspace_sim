// flyto.js — smooth camera/drone transitions for catalog fly-to and undo/redo.
import * as THREE from "three";
import { elevationAt } from "./terrain.js";
import { worldToGeo } from "./coords.js";

// B10 fixup: clearance held over terrain during a warp so the path arcs over
// mountains instead of tunnelling through them (only arrival was clamped
// before). Eased to a near-surface margin on final approach so a genuinely
// low destination altitude is still reached.
const FLYOVER_CLEARANCE = 120;

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
    const x = f.x + (t.x - f.x) * u;
    let   y = f.y + (t.y - f.y) * u;
    const z = f.z + (t.z - f.z) * u;
    // B10 fixup: clamp the lerped path above terrain so warps ride over peaks.
    // Full clearance through the journey, eased to a near-surface margin over
    // the final 15% (approach → 0 at u=1) so a low target altitude still lands.
    const ll = worldToGeo(x, z);
    const approach = Math.min(1, (1 - u) / 0.15);
    const clearance = 1.5 + (FLYOVER_CLEARANCE - 1.5) * approach;
    const floorY = elevationAt(ll.lat, ll.lon) + clearance;
    if (y < floorY) y = floorY;
    this.drone.position.set(x, y, z);
    this.drone.bodyYaw = lerpAngle(f.yaw, t.yaw, u);
    this.drone.bodyPitch = lerpAngle(f.pitch, t.pitch, u);
    this.drone.yaw = this.drone.bodyYaw;
    this.drone.pitch = this.drone.bodyPitch;
    this.drone._syncCamera();
    if (this.t >= this.duration) {
      this.active = false;
      this.drone.flightLocked = false;
      this.drone.hover = false;
      // B10.T3: arrival clamp — physicsStep doesn't run while flightLocked,
      // so refresh the terrain floor here or the drone can sit underground
      // for up to 0.5 s on mountain arrivals.
      const floor = this.drone.resampleTerrainFloor();
      if (this.drone.position.y < floor) this.drone.position.y = floor;
      this.onComplete?.();
    }
    return true;
  }
}
