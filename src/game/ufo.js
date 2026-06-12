// ufo.js — UFO entity layer: spawn / orbit / banish over airspace volumes.
// B9.T4: combat behaviors — shield, evade, attack-run, destroy.
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
const _tmpVec  = new THREE.Vector3();

// Constants for combat behaviors.
const ATTACK_SPEED     = 70;        // m/s
const ATTACK_REACH_R   = 400;       // m — triggers onReachTarget
const EVADE_DURATION   = 6;         // s
const EVADE_SPEED_MUL  = 1.5;
const EVADE_JINK_MIN   = 0.8;       // s
const EVADE_JINK_MAX   = 1.4;       // s
const EVADE_MAX_DEG    = 60;        // ° from current travel heading
const RETREAT_DURATION = 15;        // s before despawn
const RETREAT_CLIMB    = 30;        // m/s upward
const RETREAT_SPEED    = 60;        // m/s horizontal
const SHIELD_GLOW_MUL  = 1.6;      // glow opacity multiplier while shielded
const BASE_GLOW_SCALE  = 600;       // px — existing glow sprite scale
const FLASH_DURATION   = 0.25;      // s for white emissive pulse

export class UfoLayer {
  /**
   * @param {THREE.Scene} scene
   * @param {{ layer: object, audio?: object }} deps
   *   layer — AirspaceLayer instance (compiled, airspacesAt).
   *   audio — optional audio handle (installAudio result); null-safe throughout.
   */
  constructor(scene, { layer, audio = null }) {
    this.layer  = layer;
    this.audio  = audio;
    this.group  = new THREE.Group();
    scene.add(this.group);
    this.ufos   = new Map();   // id (number) → entity
    this._seq   = 0;

    /** Fired once when an ATTACK_RUN entity reaches its target. @type {(id:number)=>void} */
    this.onReachTarget = null;
    /** Fired at destruction (after explosion). @type {(id:number, position:THREE.Vector3)=>void} */
    this.onExplode     = null;
  }

  /** @returns {number} active UFO count */
  get count() { return this.ufos.size; }

  /**
   * Spawn a UFO orbiting the given airspace.
   *
   * @param {string} airspaceId
   * @param {{ combat?: boolean, shielded?: boolean, orbitRadius?: number }} [opts]
   *   combat:false (default) — pure ORBIT with no hp/shield semantics.
   *   combat:true  — sets hp=3, behavior=ORBIT, applies shield if shielded:true.
   * @returns {number|null} entity id, or null on failure.
   */
  spawnAt(airspaceId, opts = {}) {
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
    glow.scale.setScalar(BASE_GLOW_SCALE);

    const holder = new THREE.Group();
    holder.add(mesh);
    holder.add(glow);
    this.group.add(holder);

    const id = ++this._seq;
    const orbitRadius = (opts.combat && opts.orbitRadius != null) ? opts.orbitRadius : 2000;

    // ── Combat: clone materials per-entity so white flash can't cross-leak ──
    // modelUFO() already builds fresh materials per call (called above), but
    // we clone them explicitly for combat spawns as a belt-and-suspenders
    // guarantee — harmless for non-combat since we never mutate them there.
    let combatMats = null;
    if (opts.combat) {
      combatMats = [];
      mesh.traverse((o) => {
        if (o.isMesh && o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          const cloned = mats.map((m) => {
            const cm = m.clone();
            cm.transparent = true;
            return cm;
          });
          o.material = cloned.length === 1 ? cloned[0] : cloned;
          combatMats.push(...cloned);
        }
      });
    }

    const entity = {
      id,
      holder,
      mesh,
      glow,
      combatMats,           // null for non-combat
      center:   { x: c.centroid.x, z: c.centroid.z },
      baseY,
      angle:    Math.random() * Math.PI * 2,
      angVel:   (Math.PI * 2) / 45,   // full orbit in 45 s
      radius:   orbitRadius,
      bobPhase: Math.random() * Math.PI * 2,
      t:        0,
      state:    "ORBIT",
      fade:     1,

      // ── combat fields (non-combat entities: these are ignored) ──
      combat:   !!opts.combat,
      hp:       opts.combat ? 3 : null,
      shielded: opts.combat ? !!opts.shielded : false,
      behavior: opts.combat ? "ORBIT" : null,

      // EVADE
      evadeTimer:      0,
      evadePrev:       null,      // behavior before EVADE
      evadeHeading:    0,         // current jink heading (radians)
      evadeJinkTimer:  0,
      evadeJinkPeriod: EVADE_JINK_MIN,

      // ATTACK_RUN
      attackTarget:    null,      // THREE.Vector3 copy
      reachFired:      false,

      // RETREAT
      retreatTimer:    0,
      retreatDir:      null,      // THREE.Vector3 unit horizontal direction

      // FLASH
      flashTimer:      0,

      // Base glow opacity (normal, non-shielded).
      baseGlowOpacity: 0.7,
    };

    // Apply initial shield glow if shielded.
    if (entity.shielded) {
      glow.material.opacity = entity.baseGlowOpacity * SHIELD_GLOW_MUL;
    }

    // Place the holder on its orbit immediately — position must never depend
    // on the first update() tick (a behavior transition can precede it).
    holder.position.set(
      entity.center.x + entity.radius * Math.cos(entity.angle),
      entity.baseY,
      entity.center.z + entity.radius * Math.sin(entity.angle),
    );

    this.ufos.set(id, entity);
    return id;
  }

  /**
   * Begin the banish animation for a UFO (SCRAMBLE path — non-combat).
   * @param {number} id
   */
  banish(id) {
    const u = this.ufos.get(id);
    if (!u) return;
    u.state = "BANISH";
    u.t     = 0;
  }

  /**
   * Set combat behavior for a live entity.
   * @param {number} id
   * @param {"ORBIT"|"EVADE"|"ATTACK_RUN"|"RETREAT"} behavior
   * @param {{ target?: THREE.Vector3 }} [opts]
   */
  setBehavior(id, behavior, opts = {}) {
    const u = this.ufos.get(id);
    if (!u || !u.combat) return;
    this._transitionBehavior(u, behavior, opts);
  }

  /**
   * Toggle shield state on a combat entity.
   * @param {number} id
   * @param {boolean} on
   */
  setShielded(id, on) {
    const u = this.ufos.get(id);
    if (!u || !u.combat) return;
    u.shielded = on;
    // Glow scale reflects shield status immediately.
    // (opacity is set each frame; set it here too so it takes effect instantly.)
    u.glow.material.opacity = on
      ? u.baseGlowOpacity * SHIELD_GLOW_MUL
      : u.baseGlowOpacity;
  }

  /**
   * Apply damage to a combat entity.
   * @param {number} id
   * @param {number} dmg
   */
  takeHit(id, dmg) {
    const u = this.ufos.get(id);
    if (!u || !u.combat) return;
    if (u.shielded) return;   // weapons already pinged — no-op
    if (u.state === "BANISH" || u.state === "DESTROY") return;

    u.hp -= dmg;
    if (u.hp <= 0) {
      this._explode(u);
    } else {
      // Trigger white flash.
      u.flashTimer = FLASH_DURATION;
      // Trigger EVADE (store previous behavior if not already evading).
      if (u.behavior !== "EVADE") {
        this._transitionBehavior(u, "EVADE", {});
      }
    }
  }

  /**
   * Return all live combat entities as descriptors for external targeting.
   * @returns {Array<{id:number, position:THREE.Vector3, shielded:boolean, hp:number, behavior:string}>}
   */
  getCombatEntities() {
    const out = [];
    for (const u of this.ufos.values()) {
      if (u.combat) {
        out.push({
          id:       u.id,
          position: u.holder.position,
          shielded: u.shielded,
          hp:       u.hp,
          behavior: u.behavior,
        });
      }
    }
    return out;
  }

  /**
   * Per-frame update.
   * @param {number} dt  seconds since last frame
   */
  update(dt) {
    for (const u of this.ufos.values()) {
      u.t += dt;

      // ── White flash (combat non-fatal hit) ────────────────────────────────
      if (u.flashTimer > 0) {
        u.flashTimer -= dt;
        const intensity = Math.max(0, u.flashTimer / FLASH_DURATION);
        if (u.combatMats) {
          for (const m of u.combatMats) {
            if (m.emissive !== undefined) {
              m.emissive.setScalar(intensity);
            }
          }
        }
        if (u.flashTimer <= 0 && u.combatMats) {
          for (const m of u.combatMats) {
            if (m.emissive !== undefined) m.emissive.setScalar(0);
          }
        }
      }

      // ── State machine ──────────────────────────────────────────────────────
      if (u.state === "ORBIT") {
        this._updateOrbit(u, dt);

      } else if (u.state === "BANISH") {
        this._updateBanish(u, dt);

      } else if (u.state === "DESTROY") {
        this._updateDestroy(u, dt);

      } else if (u.state === "COMBAT") {
        // Top-level combat dispatcher — routes to behavior sub-handlers.
        switch (u.behavior) {
          case "ORBIT":      this._updateOrbit(u, dt);       break;
          case "EVADE":      this._updateEvade(u, dt);       break;
          case "ATTACK_RUN": this._updateAttackRun(u, dt);   break;
          case "RETREAT":    this._updateRetreat(u, dt);     break;
          default:           this._updateOrbit(u, dt);       break;
        }
      }
    }
  }

  /**
   * Immediately dispose all UFOs (abort path — no animation).
   */
  clear() {
    for (const u of this.ufos.values()) this._dispose(u);
  }

  // ── internal — behavior sub-handlers ──────────────────────────────────────

  _updateOrbit(u, dt) {
    u.angle += u.angVel * dt;
    u.holder.position.set(
      u.center.x + u.radius * Math.cos(u.angle),
      u.baseY    + 60      * Math.sin(u.t * 0.8 + u.bobPhase),
      u.center.z + u.radius * Math.sin(u.angle),
    );
    // Slow yaw spin of the mesh body.
    u.mesh.rotation.y += 0.4 * dt;
    // Glow pulse (respects shield multiplier for combat entities).
    const basePulse = 0.5 + 0.25 * Math.sin(u.t * 2.2);
    if (u.combat && u.shielded) {
      u.glow.material.opacity = basePulse * SHIELD_GLOW_MUL;
    } else {
      u.glow.material.opacity = basePulse;
    }
  }

  _updateBanish(u, dt) {
    const prog = u.t / 0.6;   // 0→1 over 0.6 s
    if (prog >= 1) {
      this._dispose(u);
      return;
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

  _updateDestroy(u, dt) {
    // Fast fade-out for combat destruction — reuses the same opacity-fade approach
    // as BANISH but with a tighter 0.4 s window and no scale-up.
    const prog = u.t / 0.4;
    if (prog >= 1) {
      this._dispose(u);
      return;
    }
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

  _updateEvade(u, dt) {
    // Advance jink timer and pick a new heading offset when it expires.
    u.evadeJinkTimer += dt;
    if (u.evadeJinkTimer >= u.evadeJinkPeriod) {
      u.evadeJinkTimer = 0;
      u.evadeJinkPeriod = EVADE_JINK_MIN + Math.random() * (EVADE_JINK_MAX - EVADE_JINK_MIN);
      const offsetRad = ((Math.random() * 2 - 1) * EVADE_MAX_DEG) * (Math.PI / 180);
      u.evadeHeading += offsetRad;
    }

    // Move laterally at evade speed fixed at transition time (radius-decoupled).
    const speed = u.evadeSpeed;
    u.holder.position.x += Math.cos(u.evadeHeading) * speed * dt;
    u.holder.position.z += Math.sin(u.evadeHeading) * speed * dt;
    u.holder.position.y  = u.baseY + 60 * Math.sin(u.t * 0.8 + u.bobPhase);
    u.mesh.rotation.y += 0.8 * dt;

    // Glow pulse with shield multiplier.
    const basePulse = 0.5 + 0.25 * Math.sin(u.t * 2.2);
    u.glow.material.opacity = u.shielded ? basePulse * SHIELD_GLOW_MUL : basePulse;

    // Advance evade timer; resume previous behavior when expired.
    u.evadeTimer += dt;
    if (u.evadeTimer >= EVADE_DURATION) {
      this._transitionBehavior(u, u.evadePrev ?? "ORBIT", {
        target: u.attackTarget,   // re-wire attack target if resuming ATTACK_RUN
      });
    }
  }

  _updateAttackRun(u, dt) {
    if (!u.attackTarget) {
      // No target — fall back to orbit.
      this._transitionBehavior(u, "ORBIT", {});
      return;
    }

    const pos = u.holder.position;
    _tmpVec.copy(u.attackTarget).sub(pos);
    const dist = _tmpVec.length();

    if (!u.reachFired && dist <= ATTACK_REACH_R) {
      u.reachFired = true;
      if (typeof this.onReachTarget === "function") {
        this.onReachTarget(u.id);
      }
      this._transitionBehavior(u, "RETREAT", {});
      return;
    }

    // Steer toward target at ATTACK_SPEED.
    if (dist > 0.1) {
      _tmpVec.normalize();
      pos.addScaledVector(_tmpVec, ATTACK_SPEED * dt);
    }
    u.mesh.rotation.y += 0.6 * dt;

    const basePulse = 0.5 + 0.25 * Math.sin(u.t * 2.2);
    u.glow.material.opacity = u.shielded ? basePulse * SHIELD_GLOW_MUL : basePulse;
  }

  _updateRetreat(u, dt) {
    // Climb and move away from attack target (or fallback heading).
    if (u.retreatDir) {
      u.holder.position.x += u.retreatDir.x * RETREAT_SPEED * dt;
      u.holder.position.z += u.retreatDir.z * RETREAT_SPEED * dt;
    }
    u.holder.position.y += RETREAT_CLIMB * dt;
    u.mesh.rotation.y += 0.3 * dt;

    const basePulse = 0.4 + 0.2 * Math.sin(u.t * 2.2);
    u.glow.material.opacity = basePulse;

    u.retreatTimer += dt;
    if (u.retreatTimer >= RETREAT_DURATION) {
      // Use existing fade-despawn path.
      u.state = "BANISH";
      u.t     = 0;
    }
  }

  // ── internal — combat transitions ─────────────────────────────────────────

  /**
   * Transition a combat entity to a new behavior.
   * Also flips u.state to "COMBAT" for newly-combat entities on first transition.
   * @param {object} u entity
   * @param {string} behavior
   * @param {{ target?: THREE.Vector3 }} opts
   */
  _transitionBehavior(u, behavior, opts) {
    const prev = u.behavior;
    u.behavior = behavior;
    // Ensure the top-level state machine dispatches via COMBAT.
    if (u.state !== "COMBAT") u.state = "COMBAT";

    switch (behavior) {
      case "EVADE": {
        // Store previous behavior so we can resume it.
        u.evadePrev      = prev !== "EVADE" ? prev : (u.evadePrev ?? "ORBIT");
        u.evadeTimer     = 0;
        u.evadeJinkTimer = 0;
        u.evadeJinkPeriod = EVADE_JINK_MIN + Math.random() * (EVADE_JINK_MAX - EVADE_JINK_MIN);
        // Seed initial jink heading from current travel direction.
        const pos = u.holder.position;
        u.evadeHeading = Math.atan2(
          pos.z - u.center.z,
          pos.x - u.center.x,
        );
        // Fix evade speed at transition time, decoupled from orbital radius.
        // ATTACK_RUN evades at ATTACK_SPEED×mul; orbit/other evades at capped linear speed.
        if (u.evadePrev === "ATTACK_RUN") {
          u.evadeSpeed = ATTACK_SPEED * EVADE_SPEED_MUL;
        } else {
          u.evadeSpeed = Math.min(u.angVel * u.radius, 120) * EVADE_SPEED_MUL;
        }
        break;
      }
      case "ATTACK_RUN": {
        if (opts.target) {
          u.attackTarget = opts.target.clone();
        }
        u.reachFired = false;
        break;
      }
      case "RETREAT": {
        // Retreat direction = away from attack target (or away from center).
        const from = u.attackTarget ?? new THREE.Vector3(u.center.x, 0, u.center.z);
        u.retreatDir = new THREE.Vector3()
          .copy(u.holder.position)
          .sub(from)
          .setY(0)
          .normalize();
        // Fallback: if zero vector, pick a random horizontal direction.
        if (u.retreatDir.lengthSq() < 0.01) {
          const a = Math.random() * Math.PI * 2;
          u.retreatDir.set(Math.cos(a), 0, Math.sin(a));
        }
        u.retreatTimer = 0;
        break;
      }
      case "ORBIT":
      default:
        // Reseed orbit angle to the entity's current bearing from centroid so
        // _updateOrbit snaps to the circle at the correct angular position,
        // not the stale pre-EVADE angle (which would teleport the entity).
        u.angle = Math.atan2(
          u.holder.position.z - u.center.z,
          u.holder.position.x - u.center.x,
        );
        break;
    }
  }

  _explode(u) {
    // Store position before disposal for the callback.
    const explosionPos = u.holder.position.clone();

    // Null-safe audio.
    if (this.audio) this.audio.play("explode");

    // Fire external callback for spark pool etc.
    if (typeof this.onExplode === "function") {
      this.onExplode(u.id, explosionPos);
    }

    // Transition to fast-fade destroy path.
    u.state = "DESTROY";
    u.t     = 0;
    // Clear flash timer so emissive pulse doesn't interfere.
    u.flashTimer = 0;
    if (u.combatMats) {
      for (const m of u.combatMats) {
        if (m.emissive !== undefined) m.emissive.setScalar(0);
      }
    }
  }

  // ── internal — disposal ───────────────────────────────────────────────────

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
