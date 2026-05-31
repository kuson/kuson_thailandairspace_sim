// followController.js — "view this plane" spectator camera (Betterment-4.1 §12.6).
//
// Locks the camera onto a live Flight and tracks it as it moves (the flight's
// `.world` Vector3 is dead-reckoned every frame by LiveFlightsLayer). It does not
// touch the player drone's state beyond pausing it + hiding its mesh while active;
// it simply overrides the camera each frame AFTER drone.update has run. Released
// by Esc / any movement input (wired in main.js).
import * as THREE from "three";

const DEG2RAD = Math.PI / 180;

export class FollowController {
  constructor(drone, camera) {
    this.drone = drone;
    this.camera = camera;
    this.target = null;
    this.active = false;
    this._init = false;
    this._wasPaused = false;
    this._desired = new THREE.Vector3();
    this.onChange = null;   // (flightOrNull) → UI hook
  }

  setTarget(flight) {
    if (!flight) return;
    this.target = flight;
    if (!this.active) {
      this._wasPaused = this.drone.paused;
      this.drone.paused = true;               // freeze the player while spectating
      if (this.drone.mesh) this.drone.mesh.visible = false;
    }
    this.active = true;
    this._init = false;
    this.onChange?.(flight);
  }

  release() {
    if (!this.active) return;
    this.active = false;
    this.target = null;
    this.drone.paused = this._wasPaused;
    if (this.drone.mesh) this.drone.mesh.visible = true;
    this.onChange?.(null);
  }

  /** Per-frame; called after drone.update so it owns the camera. Returns active. */
  update(dt) {
    if (!this.active || !this.target) return false;
    const f = this.target;
    if (!f.world || f.dead || f.fade <= 0) { this.release(); return false; }
    // Chase pose: behind + above along the aircraft's nose direction.
    const hdg = (f.fix?.headingDeg ?? 0) * DEG2RAD;
    const fwdX = Math.sin(hdg), fwdZ = -Math.cos(hdg);   // world nose dir
    const back = 320, up = 110;
    this._desired.set(f.world.x - fwdX * back, f.world.y + up, f.world.z - fwdZ * back);
    if (!this._init) { this.camera.position.copy(this._desired); this._init = true; }
    else { this.camera.position.lerp(this._desired, 1 - Math.exp(-dt / 0.5)); }
    this.camera.lookAt(f.world.x, f.world.y, f.world.z);
    return true;
  }
}
