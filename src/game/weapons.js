// weapons.js — B9.T3: hitscan, heat, tracers, sparks, tones for INTERCEPT wave.
//
// Pooling policy (no per-shot allocation):
//   Tracers : pool of 8 THREE.Line objects created at construction, reused via
//             a free-list cursor. Each fire picks the oldest-retired tracer.
//   Sparks  : ONE THREE.Points with a 64-vert preallocated Float32Array for
//             positions and a Float32Array for color (rgb = tint * fading-alpha).
//             A free-list cursor wraps through the 64 slots; a burst of 6–10
//             verts is assigned per hit — dead verts have rgb=0 and are
//             excluded from the draw range (setDrawRange updates per frame).
//             Default burst = warm ember (1.0, 0.75, 0.35); shield flash =
//             blue-white (0.6, 0.8, 1.0), 4 sparks.
//
// Module-level temp vectors (scratch math — no per-frame allocation):
//   _tmpFwd, _tmpOrigin, _tmpMuzzle, _tmpVel, _tmpPos — THREE.Vector3.
//
// Heat bar: lazy #heatBar (outer) + #heatBarFill (inner) div.
// CSS block added immediately after the #reticle block in index.html (B9.T2).

import * as THREE from "three";

// ---------------------------------------------------------------------------
// Pure exported helper — no THREE dependency (testable with bare node)
// ---------------------------------------------------------------------------

/**
 * Nearest positive t for ray→sphere intersection (analytical, no allocations).
 * Ray origin (ox,oy,oz), unit direction (dx,dy,dz).
 * Sphere center (cx,cy,cz), radius r.
 * Returns nearest positive t, or Infinity on miss / behind-camera.
 */
export function raySphereT(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const fx = ox - cx;
  const fy = oy - cy;
  const fz = oz - cz;
  // a = 1 (unit direction assumed)
  const b    = 2 * (fx * dx + fy * dy + fz * dz);
  const c    = fx * fx + fy * fy + fz * fz - r * r;
  const disc = b * b - 4 * c;
  if (disc < 0) return Infinity;
  const sqrtD = Math.sqrt(disc);
  const t0 = (-b - sqrtD) * 0.5;
  const t1 = (-b + sqrtD) * 0.5;
  if (t1 <= 0) return Infinity;
  return t0 > 0 ? t0 : t1;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RANGE      = 4000;   // metres — hitscan cutoff
const HEAT_PER_SHOT  = 8;      // +8 per fire
const HEAT_DECAY     = 30;     // −30/s
const HEAT_MAX       = 100;
const OVERHEAT_TIME  = 1.5;    // lockout seconds
const COOLDOWN       = 0.12;   // min seconds between shots

const TRACER_POOL    = 8;
const TRACER_LIFE    = 0.08;   // seconds to fade

const SPARK_POOL     = 64;     // total preallocated vertices
const SPARK_BURST_MIN = 6;
const SPARK_BURST_MAX = 10;
const SPARK_LIFE     = 0.5;    // seconds to fade / gravity step
const SPARK_GRAVITY  = -9.8 * 20; // exaggerated gravity (world scale)

// ---------------------------------------------------------------------------
// Module-level scratch vectors — NEVER reallocated after construction
// ---------------------------------------------------------------------------

const _tmpFwd      = new THREE.Vector3();
const _tmpOrigin   = new THREE.Vector3();
const _tmpMuzzle   = new THREE.Vector3();
const _tmpDown     = new THREE.Vector3(0, -1, 0);
const _tmpImpact   = new THREE.Vector3(); // scratch for hit-point — never per-shot alloc

// ---------------------------------------------------------------------------
// class Weapons
// ---------------------------------------------------------------------------

export class Weapons {
  /**
   * @param {THREE.Scene}   scene
   * @param {THREE.Camera}  camera
   * @param {object}        audio     — the audio instance (audio.play(name))
   * @param {Function}      getTargets — () => Array<{ id, kind, position, radius, shielded, takeHit(dmg) }>
   */
  constructor({ scene, camera, audio, getTargets }) {
    this._scene      = scene;
    this._camera     = camera;
    this._audio      = audio;
    this._getTargets = getTargets ?? (() => []);

    // Stats (T6 reads these)
    this.shots = 0;
    this.hits  = 0;

    // Heat state
    this._heat      = 0;
    this._overheated = false;
    this._overheatTimer = 0;
    this._cooldownTimer = 0;

    // Pooled scene objects
    this._tracerGroup = new THREE.Group();
    scene.add(this._tracerGroup);
    this._tracers = this._buildTracerPool();

    this._sparksObj = this._buildSparkPool();
    scene.add(this._sparksObj);

    // Heat bar DOM (created lazily in _ensureHeatBar)
    this._heatBar     = null;
    this._heatBarFill = null;
    this._heatBarVisible = false;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Attempt a shot. Respects cooldown + overheat lockout.
   * Performs hitscan, draws tracer, triggers sparks/tones on hit.
   */
  fire() {
    if (this._overheated) return;
    if (this._cooldownTimer > 0) return;

    this.shots++;
    this._heat = Math.min(HEAT_MAX, this._heat + HEAT_PER_SHOT);
    this._cooldownTimer = COOLDOWN;
    this._audio?.play("fire");

    if (this._heat >= HEAT_MAX && !this._overheated) {
      this._overheated    = true;
      this._overheatTimer = OVERHEAT_TIME;
      this._audio?.play("overheat");
    }

    // Compute ray origin (camera center) and direction.
    this._camera.getWorldPosition(_tmpOrigin);
    this._camera.getWorldDirection(_tmpFwd); // unit vec

    // Muzzle origin for tracer visual: slightly forward+down so the tracer
    // is visible from the player's perspective but the HIT ray is reticle-true.
    _tmpMuzzle.copy(_tmpOrigin)
      .addScaledVector(_tmpFwd,   2)
      .addScaledVector(_tmpDown,  1.5);

    const hit = this._findTarget(_tmpOrigin, _tmpFwd);

    // Impact point (or max-range point for miss tracer)
    let impactT = hit ? hit.t : MAX_RANGE;
    const impactX = _tmpOrigin.x + _tmpFwd.x * impactT;
    const impactY = _tmpOrigin.y + _tmpFwd.y * impactT;
    const impactZ = _tmpOrigin.z + _tmpFwd.z * impactT;

    // Draw tracer muzzle → impact
    this._fireTracer(
      _tmpMuzzle.x, _tmpMuzzle.y, _tmpMuzzle.z,
      impactX, impactY, impactZ
    );

    if (hit) {
      this.hits++;
      _tmpImpact.set(impactX, impactY, impactZ);
      if (hit.target.shielded) {
        this._audio?.play("shieldPing");
        // Small blue-white flash — allocation-free via scratch vector
        this.spawnBurstAt(_tmpImpact, { count: 4, color: { r: 0.6, g: 0.8, b: 1.0 } });
      } else {
        hit.target.takeHit(1);
        this._audio?.play("spark");
        this.spawnBurstAt(_tmpImpact);
      }
    }
  }

  /**
   * Per-frame update: heat decay, lockout timer, tracer fades, spark physics.
   * Near-zero cost when nothing active.
   * @param {number} dt  seconds since last frame
   */
  update(dt) {
    // ── cooldown ──
    if (this._cooldownTimer > 0) {
      this._cooldownTimer = Math.max(0, this._cooldownTimer - dt);
    }

    // ── overheat lockout ──
    if (this._overheated) {
      this._overheatTimer -= dt;
      if (this._overheatTimer <= 0) {
        this._overheated = false;
        this._heat = 0;
      }
    } else {
      // heat decay while not overheated
      if (this._heat > 0) {
        this._heat = Math.max(0, this._heat - HEAT_DECAY * dt);
      }
    }

    // ── heat bar ──
    this._updateHeatBar();

    // ── tracer fades ──
    let anyTracerActive = false;
    for (const tr of this._tracers) {
      if (!tr.active) continue;
      anyTracerActive = true;
      tr.age += dt;
      if (tr.age >= TRACER_LIFE) {
        tr.line.visible = false;
        tr.active = false;
      } else {
        tr.line.material.opacity = 1 - tr.age / TRACER_LIFE;
      }
    }

    // ── spark physics ──
    let anySparkActive = false;
    let maxDrawVert = 0;
    const pos   = this._sparksObj.geometry.attributes.position;
    const alpha = this._sparksObj.geometry.attributes.color; // r channel = alpha

    for (let i = 0; i < SPARK_POOL; i++) {
      const s = this._sparkSlots[i];
      if (!s.active) continue;
      anySparkActive = true;
      s.age += dt;
      if (s.age >= SPARK_LIFE) {
        s.active = false;
        alpha.setXYZ(i, 0, 0, 0);
        continue;
      }
      // Gravity
      s.vy += SPARK_GRAVITY * dt;
      s.x  += s.vx * dt;
      s.y  += s.vy * dt;
      s.z  += s.vz * dt;
      pos.setXYZ(i, s.x, s.y, s.z);
      const a = Math.max(0, 1 - s.age / SPARK_LIFE);
      // Write RGB tint scaled by fading alpha so sparks dim in their own color
      alpha.setXYZ(i, s.tintR * a, s.tintG * a, s.tintB * a);
      if (i > maxDrawVert) maxDrawVert = i;
    }

    if (anySparkActive) {
      pos.needsUpdate   = true;
      alpha.needsUpdate = true;
      this._sparksObj.geometry.setDrawRange(0, maxDrawVert + 1);
      this._sparksObj.visible = true;
    } else if (this._sparksObj.visible) {
      this._sparksObj.visible = false;
    }
  }

  /**
   * Spawn a burst of sparks at the given world position.
   * Called internally on hit; exposed so T4 can trigger explosion sparks.
   * Passing `_tmpImpact` as position is safe: coords are copied into slot state
   * synchronously before this method returns.
   * @param {THREE.Vector3} position
   * @param {{ count?: number, color?: { r, g, b } }} [opts]
   *   count  — number of sparks (defaults to random 6–10)
   *   color  — RGB tint (defaults to warm ember ≈ 1.0, 0.75, 0.35)
   */
  spawnBurstAt(position, opts) {
    const count = (opts && opts.count != null)
      ? opts.count
      : SPARK_BURST_MIN + Math.floor(Math.random() * (SPARK_BURST_MAX - SPARK_BURST_MIN + 1));

    // Tint defaults to warm ember; shield flash passes blue-white.
    const tintR = (opts && opts.color) ? opts.color.r : 1.00;
    const tintG = (opts && opts.color) ? opts.color.g : 0.75;
    const tintB = (opts && opts.color) ? opts.color.b : 0.35;

    const pos   = this._sparksObj.geometry.attributes.position;
    const alpha = this._sparksObj.geometry.attributes.color;

    for (let n = 0; n < count; n++) {
      // Find a free slot (wrap around)
      const i = this._nextSparkSlot();
      const s = this._sparkSlots[i];
      s.active = true;
      s.age    = 0;
      s.x      = position.x;
      s.y      = position.y;
      s.z      = position.z;
      // Store RGB tint on the slot — 3 numbers, no object
      s.tintR  = tintR;
      s.tintG  = tintG;
      s.tintB  = tintB;
      // Random velocity sphere — exaggerated for visibility
      const speed = 30 + Math.random() * 80;
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.random() * Math.PI;
      s.vx = speed * Math.sin(phi) * Math.cos(theta);
      s.vy = speed * Math.cos(phi) + 20; // slight upward bias
      s.vz = speed * Math.sin(phi) * Math.sin(theta);
      pos.setXYZ(i, s.x, s.y, s.z);
      // Full-brightness tint at spawn; update() will scale by fading alpha
      alpha.setXYZ(i, tintR, tintG, tintB);
    }
    pos.needsUpdate   = true;
    alpha.needsUpdate = true;
    this._sparksObj.visible = true;
  }

  /** Show the heat bar (called by T6 on wave start). */
  setActive(active) {
    this._heatBarVisible = active;
    if (!active) {
      if (this._heatBar) this._heatBar.style.display = "none";
    } else {
      this._ensureHeatBar();
      this._heatBar.style.display = "block";
    }
  }

  showHeatBar() { this.setActive(true);  }
  hideHeatBar() { this.setActive(false); }

  /**
   * Allow T6 to swap the target provider at runtime.
   * @param {Function} fn
   */
  setTargetsProvider(fn) {
    this._getTargets = fn;
  }

  dispose() {
    // Tracers
    for (const tr of this._tracers) {
      tr.line.geometry.dispose();
      tr.line.material.dispose();
    }
    this._tracerGroup.clear();
    this._scene.remove(this._tracerGroup);

    // Sparks
    this._sparksObj.geometry.dispose();
    this._sparksObj.material.dispose();
    this._scene.remove(this._sparksObj);

    // Heat bar
    this._heatBar?.remove();
    this._heatBar = null;
    this._heatBarFill = null;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * Find the nearest target within MAX_RANGE whose sphere the ray intersects.
   * @param {THREE.Vector3} origin  camera world position
   * @param {THREE.Vector3} dir     unit camera forward
   * @returns {{ target, t } | null}
   */
  _findTarget(origin, dir) {
    const targets = this._getTargets();
    let bestT  = Infinity;
    let bestTgt = null;

    for (const tgt of targets) {
      const t = raySphereT(
        origin.x, origin.y, origin.z,
        dir.x,    dir.y,    dir.z,
        tgt.position.x, tgt.position.y, tgt.position.z,
        tgt.radius
      );
      if (t < bestT && t <= MAX_RANGE) {
        bestT   = t;
        bestTgt = tgt;
      }
    }
    return bestTgt ? { target: bestTgt, t: bestT } : null;
  }

  /** Draw a tracer from (x0,y0,z0) to (x1,y1,z1) using the pool. */
  _fireTracer(x0, y0, z0, x1, y1, z1) {
    // Find the least-recently-used (or inactive) slot
    const tr = this._tracers[this._tracerCursor];
    this._tracerCursor = (this._tracerCursor + 1) % TRACER_POOL;

    const pts = tr.line.geometry.attributes.position;
    pts.setXYZ(0, x0, y0, z0);
    pts.setXYZ(1, x1, y1, z1);
    pts.needsUpdate = true;

    tr.line.material.opacity = 1;
    tr.line.visible = true;
    tr.age    = 0;
    tr.active = true;
  }

  // ── Pool builders ──────────────────────────────────────────────────────────

  _buildTracerPool() {
    const tracers = [];
    this._tracerCursor = 0;

    const mat = new THREE.LineBasicMaterial({
      color:        0xffdd44,
      transparent:  true,
      opacity:      1,
      depthWrite:   false,
      blending:     THREE.AdditiveBlending,
    });

    for (let i = 0; i < TRACER_POOL; i++) {
      // Geometry preallocated with 2 points; positions updated per shot.
      const geo = new THREE.BufferGeometry();
      const verts = new Float32Array(6); // x0,y0,z0,x1,y1,z1
      geo.setAttribute(
        "position",
        new THREE.BufferAttribute(verts, 3).setUsage(THREE.DynamicDrawUsage)
      );
      geo.setDrawRange(0, 2);

      // Each tracer gets its own material clone so opacity can differ.
      const lineMat = mat.clone();
      const line = new THREE.Line(geo, lineMat);
      line.frustumCulled = false;
      line.visible = false;
      this._tracerGroup.add(line);

      tracers.push({ line, age: 0, active: false });
    }

    mat.dispose(); // base mat no longer needed (clones own it)
    return tracers;
  }

  _buildSparkPool() {
    const posArr   = new Float32Array(SPARK_POOL * 3); // x,y,z per vert
    const colorArr = new Float32Array(SPARK_POOL * 3); // rgb = tint * fading-alpha

    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(posArr, 3).setUsage(THREE.DynamicDrawUsage)
    );
    // We abuse the "color" attribute to carry per-vertex alpha in the r channel.
    // The material uses vertexColors so it reads this; we can multiply per-vert.
    geo.setAttribute(
      "color",
      new THREE.BufferAttribute(colorArr, 3).setUsage(THREE.DynamicDrawUsage)
    );
    geo.setDrawRange(0, 0);

    const mat = new THREE.PointsMaterial({
      size:         3,
      vertexColors: true,
      transparent:  true,
      opacity:      1,
      depthWrite:   false,
      blending:     THREE.AdditiveBlending,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.visible = false;

    // Slot state array (parallel to geometry verts — no object per spark)
    this._sparkSlots = [];
    this._sparkCursor = 0;
    for (let i = 0; i < SPARK_POOL; i++) {
      this._sparkSlots.push({
        active: false, age: 0,
        x: 0, y: 0, z: 0,
        vx: 0, vy: 0, vz: 0,
        tintR: 1.00, tintG: 0.75, tintB: 0.35, // warm ember default
      });
    }

    return points;
  }

  /** Advance spark cursor and return next slot index (wraps). */
  _nextSparkSlot() {
    const i = this._sparkCursor;
    this._sparkCursor = (this._sparkCursor + 1) % SPARK_POOL;
    return i;
  }

  // ── Heat bar ───────────────────────────────────────────────────────────────

  _ensureHeatBar() {
    if (this._heatBar) return;

    const outer = document.createElement("div");
    outer.id = "heatBar";
    outer.style.display = "none";
    document.body.appendChild(outer);

    const fill = document.createElement("div");
    fill.id = "heatBarFill";
    outer.appendChild(fill);

    this._heatBar     = outer;
    this._heatBarFill = fill;
  }

  _updateHeatBar() {
    if (!this._heatBarVisible) return;
    this._ensureHeatBar();

    const pct = this._heat / HEAT_MAX * 100;
    this._heatBarFill.style.height = `${pct}%`;

    if (this._overheated) {
      this._heatBar.classList.add("overheat");
    } else {
      this._heatBar.classList.remove("overheat");
    }
  }
}
