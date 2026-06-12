// ufo.js — UFO entity layer: spawn / orbit / banish over airspace volumes.
import * as THREE from "three";
import { FT_TO_M } from "../coords.js";
import { buildLiveAircraftModel } from "../drone.js";

// Shared glow texture (built once, never disposed — reused by all UFOs).
const _glowTex = (() => {
  const SIZE = 128;
  const c = document.createElement("canvas");
  c.width = SIZE; c.height = SIZE;
  const ctx = c.getContext("2d");
  const grad = ctx.createRadialGradient(SIZE / 2, SIZE / 2, 0, SIZE / 2, SIZE / 2, SIZE / 2);
  grad.addColorStop(0,   "rgba(255,255,255,1)");
  grad.addColorStop(0.3, "rgba(255,255,255,0.6)");
  grad.addColorStop(1,   "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SIZE, SIZE);
  const tex = new THREE.CanvasTexture(c);
  return tex;
})();

// Temp vectors reused in update() — no per-frame allocation.
const _tmpBox  = new THREE.Box3();
const _tmpSize = new THREE.Vector3();

export class UfoLayer {
  /**
   * @param {THREE.Scene} scene
   * @param {{ layer: object }} deps  — layer is the AirspaceLayer instance.
   */
  constructor(scene, { layer }) {
    this.layer  = layer;
    this.group  = new THREE.Group();
    scene.add(this.group);
    this.ufos   = new Map();   // id (number) → entity
    this._seq   = 0;
  }

  /** @returns {number} active UFO count */
  get count() { return this.ufos.size; }

  /**
   * Spawn a UFO orbiting the given airspace.
   * @param {string} airspaceId
   * @returns {number|null} entity id, or null on failure.
   */
  spawnAt(airspaceId) {
    const c = this.layer.compiled.find((c) => c.airspace.id === airspaceId);
    if (!c) {
      console.error(`[UfoLayer] airspace not found: ${airspaceId}`);
      return null;
    }
    const a = c.airspace;
    const baseY = ((a.lowerFt + a.upperFt) / 2) * FT_TO_M;

    // Build and normalise model to bounding-sphere diameter ≈ 30 m.
    const mesh = buildLiveAircraftModel("ufo");
    _tmpBox.setFromObject(mesh);
    _tmpBox.getSize(_tmpSize);
    const span = Math.max(_tmpSize.x, _tmpSize.y, _tmpSize.z) || 1;
    mesh.scale.setScalar(30 / span);

    // Glow sprite — shared texture, per-UFO material so we can set its colour.
    const colour = c.color ?? 0x66ffcc;
    const glowMat = new THREE.SpriteMaterial({
      map:        _glowTex,
      color:      colour,
      transparent: true,
      blending:   THREE.AdditiveBlending,
      depthWrite: false,
      opacity:    0.7,
    });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.setScalar(600);

    const holder = new THREE.Group();
    holder.add(mesh);
    holder.add(glow);
    this.group.add(holder);

    const id = ++this._seq;
    this.ufos.set(id, {
      id,
      holder,
      mesh,
      glow,
      center:   { x: c.centroid.x, z: c.centroid.z },
      baseY,
      angle:    Math.random() * Math.PI * 2,
      angVel:   (Math.PI * 2) / 45,   // full orbit in 45 s
      radius:   2000,
      bobPhase: Math.random() * Math.PI * 2,
      t:        0,
      state:    "ORBIT",
      fade:     1,
    });
    return id;
  }

  /**
   * Begin the banish animation for a UFO.
   * @param {number} id
   */
  banish(id) {
    const u = this.ufos.get(id);
    if (!u) return;
    u.state = "BANISH";
    u.t     = 0;
  }

  /**
   * Per-frame update.
   * @param {number} dt  seconds since last frame
   */
  update(dt) {
    for (const u of this.ufos.values()) {
      u.t += dt;

      if (u.state === "ORBIT") {
        u.angle += u.angVel * dt;
        u.holder.position.set(
          u.center.x + u.radius * Math.cos(u.angle),
          u.baseY    + 60      * Math.sin(u.t * 0.8 + u.bobPhase),
          u.center.z + u.radius * Math.sin(u.angle),
        );
        // Slow yaw spin of the mesh body.
        u.mesh.rotation.y += 0.4 * dt;
        // Glow pulse.
        u.glow.material.opacity = 0.5 + 0.25 * Math.sin(u.t * 2.2);

      } else if (u.state === "BANISH") {
        const prog = u.t / 0.6;   // 0→1 over 0.6 s
        if (prog >= 1) {
          this._dispose(u);
          continue;
        }
        // Scale up and fade out.
        const s = 1 + 2 * prog;
        u.holder.scale.setScalar(s);
        const op = 1 - prog;
        u.mesh.traverse((o) => {
          if (o.material) {
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) {
              m.transparent = true;
              m.opacity     = op;
            }
          }
        });
        u.glow.material.opacity = op * 0.7;
      }
    }
  }

  /**
   * Immediately dispose all UFOs (abort path — no animation).
   */
  clear() {
    for (const u of this.ufos.values()) this._dispose(u);
  }

  // ── internal ──────────────────────────────────────────────────────────────

  _dispose(u) {
    this.group.remove(u.holder);
    // Traverse mesh geometry + materials; do NOT dispose the shared _glowTex.
    u.mesh.traverse((o) => {
      o.geometry?.dispose?.();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m.dispose();
      }
    });
    // Dispose the per-UFO glow material only (texture is shared — skip it).
    u.glow.material.map = null;   // detach shared texture before dispose
    u.glow.material.dispose();
    this.ufos.delete(u.id);
  }
}
