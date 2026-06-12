// crawlers.js — Ground crawler raider layer (B9.T5).
// Crawlers spawn on a ring around a defended airport and converge at 15 m/s.
// Terrain-following (≤2 Hz elevation sample), hp=2, reach-base + explode callbacks.
import * as THREE from "three";
import { worldToGeo } from "../coords.js";
import { elevationAt } from "../terrain.js";
import { makeShadowBlob } from "./shadows.js";

// ── Shared geometry + material (module-level singletons — NEVER disposed) ──

// Low-poly dark dome: icosahedron subdivided once, flattened on Y axis → ~25 m wide.
const _domeGeo = (() => {
  const g = new THREE.IcosahedronGeometry(12.5, 1);
  // Flatten the lower hemisphere: push vertices below centre up to equator.
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < 0) pos.setY(i, 0);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
})();

const _domeMat = new THREE.MeshStandardMaterial({
  color: 0x1a1a2e,
  roughness: 0.85,
  metalness: 0.3,
  transparent: true,
  opacity: 0.92,
});

// Glow ring: torus ~25 m diameter, thin cross-section.
const _ringGeo = new THREE.TorusGeometry(13, 1.2, 8, 32);

const _ringMat = new THREE.MeshStandardMaterial({
  color: 0xff2222,
  emissive: new THREE.Color(0xff2222),
  emissiveIntensity: 1.2,
  transparent: true,
  opacity: 0.85,
});

// Elevation sample interval (seconds) → ≤2 Hz.
const ELEV_INTERVAL = 0.5;
const CRAWL_SPEED   = 15;     // m/s
const REACH_DIST    = 500;    // m — triggers onReachBase
const FADE_DURATION = 0.35;   // s for destroy fade-out
const GROUND_OFFSET = 12;     // m above terrain

export class CrawlerLayer {
  /**
   * @param {THREE.Scene} scene
   * @param {{ layer?: object, audio?: object }} deps
   *   layer — optional AirspaceLayer (unused by crawlers; kept for signature parity).
   *   audio — optional audio handle (installAudio result); null-safe throughout.
   */
  constructor(scene, { layer = null, audio = null } = {}) {
    this.layer  = layer;
    this.audio  = audio;
    this.group  = new THREE.Group();
    scene.add(this.group);
    this.crawlers = new Map();  // id (number) → entity
    this._seq     = 0;

    /** Fired once when a crawler reaches within 500 m of the airport. @type {(id:number)=>void} */
    this.onReachBase = null;
    /** Fired at destruction (hp≤0). @type {(id:number, position:THREE.Vector3)=>void} */
    this.onExplode   = null;
  }

  /** @returns {number} active crawler count */
  get count() { return this.crawlers.size; }

  /**
   * Spawn `count` crawlers evenly spaced on a ring of radius `distM` metres
   * around `airportPos`, all converging toward the airport at 15 m/s.
   *
   * @param {THREE.Vector3} airportPos  World-space position of the airport centre.
   * @param {number}        count       Number of crawlers to spawn.
   * @param {number}        [distM]     Ring radius in metres (default 10 000).
   * @returns {number[]} Array of spawned entity ids.
   */
  spawnRing(airportPos, count, distM = 10_000) {
    const ids = [];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const sx = airportPos.x + distM * Math.cos(angle);
      const sz = airportPos.z + distM * Math.sin(angle);

      // Initial elevation sample.
      const { lat, lon } = worldToGeo(sx, sz);
      const groundY = elevationAt(lat, lon) + GROUND_OFFSET;

      // Build per-entity mesh instances (share module-level geo+mat).
      const dome = new THREE.Mesh(_domeGeo, _domeMat);
      const ring = new THREE.Mesh(_ringGeo, _ringMat);
      ring.rotation.x = Math.PI / 2;   // lay ring flat on ground plane

      const holder = new THREE.Group();
      holder.add(dome);
      holder.add(ring);
      holder.position.set(sx, groundY, sz);
      this.group.add(holder);

      // Unit direction toward airport (XZ only, terrain handles Y).
      const dx = airportPos.x - sx;
      const dz = airportPos.z - sz;
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      const dir = new THREE.Vector2(dx / len, dz / len);

      // Shadow blob: crawlers sit at groundY+12, so AGL≈12 → always full-size.
      const shadow = makeShadowBlob(this.group, 35);

      const id = ++this._seq;
      const entity = {
        id,
        holder,
        dome,
        ring,
        dir,
        airportPos: airportPos.clone(),
        groundY,
        elevTimer: 0,
        hp: 2,
        state: "MOVE",    // "MOVE" | "DESTROY"
        t: 0,
        reachedBase: false,
        fade: 1,
        shadow,
      };

      this.crawlers.set(id, entity);
      ids.push(id);
    }
    return ids;
  }

  /**
   * Apply damage to a crawler by id.
   * @param {number} id
   * @param {number} dmg
   */
  takeHit(id, dmg) {
    const c = this.crawlers.get(id);
    if (!c || c.state !== "MOVE") return;
    c.hp -= dmg;
    if (c.hp <= 0) {
      this._explode(c);
    }
  }

  /**
   * Per-frame update. Call from main loop with delta-time seconds.
   * @param {number} dt
   */
  update(dt) {
    for (const c of this.crawlers.values()) {
      c.t += dt;

      if (c.state === "MOVE") {
        this._updateMove(c, dt);
      } else if (c.state === "DESTROY") {
        this._updateDestroy(c, dt);
      }
    }
  }

  /**
   * Returns combat-targeting data for all live crawlers (T6 wiring).
   * @returns {{ id: number, position: THREE.Vector3, shielded: boolean, hp: number, kind: string }[]}
   */
  getCombatEntities() {
    const out = [];
    for (const c of this.crawlers.values()) {
      if (c.state !== "MOVE") continue;
      out.push({
        id:       c.id,
        position: c.holder.position,
        shielded: false,
        hp:       c.hp,
        kind:     "crawler",
      });
    }
    return out;
  }

  /**
   * Returns live crawler world positions for radar blip provider (T6 wires).
   * @returns {{ x: number, z: number }[]}
   */
  radarBlips() {
    const out = [];
    for (const c of this.crawlers.values()) {
      if (c.state !== "MOVE") continue;
      out.push({ x: c.holder.position.x, z: c.holder.position.z });
    }
    return out;
  }

  /**
   * Immediately remove all crawlers (abort path — no animation).
   */
  clear() {
    for (const c of this.crawlers.values()) this._dispose(c);
  }

  /**
   * Dispose the entire layer: remove from scene, dispose all entities.
   * Shared geometry + materials are module-level singletons — do NOT dispose them.
   */
  dispose() {
    this.clear();
    this.group.parent?.remove(this.group);
  }

  // ── internal ──────────────────────────────────────────────────────────────

  _updateMove(c, dt) {
    // Terrain follow: resample at ≤2 Hz.
    c.elevTimer += dt;
    if (c.elevTimer >= ELEV_INTERVAL) {
      c.elevTimer = 0;
      const { lat, lon } = worldToGeo(c.holder.position.x, c.holder.position.z);
      c.groundY = elevationAt(lat, lon) + GROUND_OFFSET;
    }
    c.holder.position.y = c.groundY;

    // Advance toward airport at 15 m/s.
    c.holder.position.x += c.dir.x * CRAWL_SPEED * dt;
    c.holder.position.z += c.dir.y * CRAWL_SPEED * dt;

    // Shadow blob: crawler sits at groundY+GROUND_OFFSET (agl≈12 → always full-size).
    c.shadow.update(
      c.holder.position.x,
      c.holder.position.z,
      c.groundY - GROUND_OFFSET,  // terrain surface (groundY already includes offset)
      GROUND_OFFSET,              // agl ≈ constant 12 m
    );

    // Slow yaw spin for visual flavour.
    c.ring.rotation.z += 0.6 * dt;

    // Check reach-base condition.
    if (!c.reachedBase) {
      const ap = c.airportPos;
      const px = c.holder.position.x - ap.x;
      const pz = c.holder.position.z - ap.z;
      const dist = Math.sqrt(px * px + pz * pz);
      if (dist <= REACH_DIST) {
        c.reachedBase = true;
        if (typeof this.onReachBase === "function") {
          this.onReachBase(c.id);
        }
        this._dispose(c);
      }
    }
  }

  _updateDestroy(c, dt) {
    // Hide shadow during destroy animation.
    c.shadow.hide();
    const prog = c.t / FADE_DURATION;
    if (prog >= 1) {
      this._dispose(c);
      return;
    }
    const op = 1 - prog;
    // Fade dome — material is shared so we must NOT mutate it directly;
    // use the per-instance material approach: clone on first destroy tick.
    if (!c._ownMats) {
      c._ownMats = true;
      c.dome.material = _domeMat.clone();
      c.dome.material.transparent = true;
      c.ring.material = _ringMat.clone();
      c.ring.material.transparent = true;
    }
    c.dome.material.opacity = op * 0.92;
    c.ring.material.opacity = op * 0.85;
    c.holder.scale.setScalar(1 + prog * 0.5);   // slight bloom-out
  }

  _explode(c) {
    const explosionPos = c.holder.position.clone();

    if (this.audio) this.audio.play("explode");

    if (typeof this.onExplode === "function") {
      this.onExplode(c.id, explosionPos);
    }

    c.state = "DESTROY";
    c.t     = 0;
  }

  _dispose(c) {
    this.group.remove(c.holder);
    // Only dispose per-entity cloned materials (created during destroy fade).
    if (c._ownMats) {
      c.dome.material.dispose();
      c.ring.material.dispose();
    }
    // Do NOT dispose _domeGeo, _ringGeo, _domeMat, _ringMat — module singletons.
    c.shadow.dispose();
    this.crawlers.delete(c.id);
  }
}
