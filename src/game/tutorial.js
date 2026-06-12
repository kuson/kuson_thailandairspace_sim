// tutorial.js — 60-second interactive tutorial (B8.T7).
//
// Runs a six-step sequence that introduces W-flight, mouse-look, ring flight,
// identify mode, radio typing, and signals done to the game stats.
//
// Design rules:
//   • Constructor builds nothing.  start() creates DOM + scene objects.
//   • update(dt) is called every frame from the main loop; does its own
//     sub-rate gating for the identify pick (≤ 2 Hz).
//   • Esc listener registered ONCE at start(), gated on active && !typing.isOpen.
//   • All THREE objects (rings) live in a dedicated Group added/removed from
//     scene; disposed on every exit path (finish and abort).
//   • No per-frame allocations in update().

import * as THREE from "three";
import { pickAirspacesAlongRay } from "../identify.js";
import { setGameStats } from "./score.js";

// ── Ring geometry constants ─────────────────────────────────────────────────

const RING_RADIUS       = 150;   // torus major radius  (m)
const RING_TUBE         = 12;    // torus tube radius   (m)
const RING_SEGS_R       = 8;
const RING_SEGS_T       = 32;
const RING_DISTANCES    = [600, 1300, 2100];   // ahead of drone (m)
const RING_POP_DIST     = 150;   // drone must come within this (m)
const RING_COLOR        = 0x66ffcc;
const RING_OPACITY      = 0.85;

// ── Step indices ────────────────────────────────────────────────────────────

const STEP_FORWARD    = 0;
const STEP_LOOK       = 1;
const STEP_RINGS      = 2;
const STEP_IDENTIFY   = 3;
const STEP_TYPE       = 4;
const STEP_DONE       = 5;

const STEP_TEXT = [
  "HOLD W TO FLY FORWARD",
  "MOVE THE MOUSE TO LOOK AROUND",
  "FLY THROUGH THE RINGS",
  "PRESS I AND AIM AT AN AIRSPACE",
  "RADIO CHECK — TYPE THE AIRSPACE NAME",
  "TUTORIAL COMPLETE — you are ready.\nPress Enter to fly, or choose Play for SCRAMBLE.",
];

// Threshold for step 1 (cumulative W hold, seconds).
const W_HOLD_THRESHOLD = 1.0;
// Threshold for step 2 (cumulative |Δbody yaw|, radians).
const YAW_DELTA_THRESHOLD = 0.5;
// Identify sub-rate interval (seconds between pick calls).
const IDENTIFY_CHECK_INTERVAL = 0.5;

export class Tutorial {
  /**
   * @param {{
   *   scene:  THREE.Scene,
   *   camera: THREE.Camera,
   *   drone:  object,
   *   layer:  object,
   *   typing: object,
   *   audio?: object,
   * }} deps
   */
  constructor({ scene, camera, drone, layer, typing, audio }) {
    this._scene  = scene;
    this._camera = camera;
    this._drone  = drone;
    this._layer  = layer;
    this._typing = typing;
    this._audio  = audio ?? null;

    /** @type {boolean} */
    this._active = false;

    // DOM card element (created on start).
    /** @type {HTMLElement|null} */
    this._card = null;

    // Current step index.
    this._step = 0;

    // Step-1 accumulator: cumulative seconds W has been held.
    this._wHoldS = 0;
    // Step-2 accumulator: cumulative |Δ yaw| in radians.
    this._yawDelta = 0;
    // Step-2 state: last known bodyYaw sample.
    this._lastYaw = 0;
    // Step-4 accumulator: time since last identify pick check.
    this._identifyAccS = 0;
    // Step-5 flag: whether we're currently waiting for the 1-s re-offer delay.
    this._typingRetryTimer = 0;
    this._typingRetryPending = false;

    // THREE ring group (added to scene on start, removed on finish/abort).
    /** @type {THREE.Group|null} */
    this._ringGroup = null;
    // Array of { mesh, center: THREE.Vector3, popped: bool }.
    this._rings = [];

    // Esc listener reference (stored to gate correctly; registered once).
    this._escListener = null;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  get active() { return this._active; }

  /** Build DOM card, add ring group to scene, start step sequencer. */
  start() {
    if (this._active) return;
    this._active = true;
    this._step   = 0;

    // Reset all accumulators.
    this._wHoldS             = 0;
    this._yawDelta           = 0;
    this._lastYaw            = this._drone.bodyYaw ?? 0;
    this._identifyAccS       = 0;
    this._typingRetryTimer   = 0;
    this._typingRetryPending = false;

    // Create ring group (rings added in _enterStep).
    this._ringGroup = new THREE.Group();
    this._rings = [];
    this._scene.add(this._ringGroup);

    // Build the instruction card.
    this._buildCard();

    // Register the Esc abort listener once.
    if (!this._escListener) {
      this._escListener = (e) => {
        if (!this._active) return;
        if (this._typing?.isOpen) return;
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.abort();
        }
      };
      window.addEventListener("keydown", this._escListener, true);
    }

    this._enterStep(STEP_FORWARD);
  }

  /**
   * Called each frame from the main loop.
   * @param {number} dt  delta-time in seconds
   */
  update(dt) {
    if (!this._active) return;

    switch (this._step) {
      case STEP_FORWARD:  this._updateForward(dt);  break;
      case STEP_LOOK:     this._updateLook(dt);     break;
      case STEP_RINGS:    this._updateRings(dt);    break;
      case STEP_IDENTIFY: this._updateIdentify(dt); break;
      case STEP_TYPE:     this._updateType(dt);     break;
      // STEP_DONE: wait for Enter/Esc/click — no per-frame logic needed.
    }
  }

  /** Abort tutorial from any step — disposes rings, hides card, active=false. */
  abort() {
    if (!this._active) return;
    this._active = false;
    this._disposeRings();
    this._hideCard();
  }

  // ── Step entry ─────────────────────────────────────────────────────────────

  _enterStep(step) {
    this._step = step;
    this._setCardText(STEP_TEXT[step]);

    if (step === STEP_RINGS) {
      this._spawnRings();
    }

    if (step === STEP_TYPE) {
      this._startTypingChallenge();
    }

    if (step === STEP_DONE) {
      this._onDone();
    }
  }

  // ── Per-step update helpers ────────────────────────────────────────────────

  _updateForward(dt) {
    if (this._drone.keys?.has("w")) {
      this._wHoldS += dt;
      if (this._wHoldS >= W_HOLD_THRESHOLD) {
        this._audio?.play("chime");
        this._enterStep(STEP_LOOK);
      }
    }
  }

  _updateLook(dt) {
    const currentYaw = this._drone.bodyYaw ?? 0;
    const delta = Math.abs(currentYaw - this._lastYaw);
    // Wrap-around: clamp delta to [0, π].
    const wrapped = delta > Math.PI ? Math.abs(delta - 2 * Math.PI) : delta;
    this._yawDelta += wrapped;
    this._lastYaw   = currentYaw;

    if (this._yawDelta >= YAW_DELTA_THRESHOLD) {
      this._audio?.play("chime");
      this._enterStep(STEP_RINGS);
    }
  }

  _updateRings(dt) {
    const pos = this._drone.position;
    for (const r of this._rings) {
      if (r.popped) continue;
      const dx = pos.x - r.center.x;
      const dz = pos.z - r.center.z;
      const dy = pos.y - r.center.y;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < RING_POP_DIST) {
        r.popped = true;
        this._popRing(r);
      }
    }
    const allPopped = this._rings.length > 0 && this._rings.every((r) => r.popped);
    if (allPopped) {
      this._enterStep(STEP_IDENTIFY);
    }
  }

  _updateIdentify(dt) {
    this._identifyAccS += dt;
    if (this._identifyAccS < IDENTIFY_CHECK_INTERVAL) return;
    this._identifyAccS = 0;

    if (!this._drone.identifyMode) return;
    try {
      const picks = pickAirspacesAlongRay(this._camera, this._layer);
      if (picks && picks.size > 0) {
        this._audio?.play("chime");
        this._enterStep(STEP_TYPE);
      }
    } catch {
      // pickAirspacesAlongRay can throw if layer isn't ready — ignore.
    }
  }

  _updateType(dt) {
    if (this._typingRetryPending) {
      this._typingRetryTimer -= dt;
      if (this._typingRetryTimer <= 0) {
        this._typingRetryPending = false;
        this._startTypingChallenge();
      }
    }
  }

  // ── Ring helpers ───────────────────────────────────────────────────────────

  _spawnRings() {
    // Remove any stale rings first (this also tears down the group), then
    // re-create the group — _disposeRings() nulls it.
    this._disposeRings();
    this._ringGroup = new THREE.Group();
    this._scene.add(this._ringGroup);
    this._rings = [];

    const dronePos = this._drone.position;
    const yaw      = this._drone.bodyYaw ?? 0;
    const sinY     = Math.sin(yaw);
    const cosY     = Math.cos(yaw);

    for (const dist of RING_DISTANCES) {
      const cx = dronePos.x + sinY * dist;
      const cy = dronePos.y;
      const cz = dronePos.z - cosY * dist;   // Three.js: -Z is forward

      const geo = new THREE.TorusGeometry(RING_RADIUS, RING_TUBE, RING_SEGS_R, RING_SEGS_T);
      const mat = new THREE.MeshBasicMaterial({
        color:       RING_COLOR,
        transparent: true,
        opacity:     RING_OPACITY,
        blending:    THREE.AdditiveBlending,
        depthWrite:  false,
        side:        THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(cx, cy, cz);

      // Orient the torus so its axis (local +Z by default) points toward the
      // drone: compute the heading back from the ring to the drone and set
      // rotation.y accordingly.  The torus faces the drone.
      const backYaw = Math.atan2(
        dronePos.x - cx,
        dronePos.z - cz,   // note: atan2(x, z) = bearing in Three.js
      );
      mesh.rotation.y = backYaw;

      this._ringGroup.add(mesh);
      const center = new THREE.Vector3(cx, cy, cz);
      this._rings.push({ mesh, center, popped: false });
    }
  }

  _popRing(r) {
    this._audio?.play("chime");
    this._ringGroup.remove(r.mesh);
    r.mesh.geometry.dispose();
    r.mesh.material.dispose();
  }

  _disposeRings() {
    for (const r of this._rings) {
      if (!r.popped) {
        this._ringGroup?.remove(r.mesh);
        r.mesh.geometry.dispose();
        r.mesh.material.dispose();
      }
    }
    this._rings = [];
    if (this._ringGroup) {
      this._scene.remove(this._ringGroup);
      this._ringGroup = null;
    }
  }

  // ── Typing helpers ─────────────────────────────────────────────────────────

  _startTypingChallenge() {
    if (!this._typing) {
      // No typing dep — skip step.
      this._enterStep(STEP_DONE);
      return;
    }
    this._typing.open({
      prompt:   "PRACTICE — type the designator",
      target:   "Bangkok CTR",
      answers:  ["VTBD-CTR", "Bangkok CTR"],
      timeoutS: 300,
    }).then((result) => {
      if (result?.correct) {
        this._audio?.play("chime");
        this._enterStep(STEP_DONE);
      } else {
        // Cancelled — re-offer after 1 s.
        this._typingRetryPending = true;
        this._typingRetryTimer   = 1.0;
      }
    }).catch(() => {
      // Treat promise rejection as cancel.
      this._typingRetryPending = true;
      this._typingRetryTimer   = 1.0;
    });
  }

  // ── Done / finish ──────────────────────────────────────────────────────────

  _onDone() {
    setGameStats({ tutorialDone: true });
    // Re-show card with done message and wire Enter/Esc/click to dismiss.
    this._setCardText(STEP_TEXT[STEP_DONE]);

    const dismiss = (e) => {
      if (e?.type === "keydown") {
        if (e.key !== "Enter" && e.key !== "Escape") return;
        e.preventDefault();
        e.stopImmediatePropagation();
      }
      window.removeEventListener("keydown", dismiss, true);
      this._card?.removeEventListener("click", dismiss);
      this._active = false;
      this._disposeRings();
      this._hideCard();
    };

    window.addEventListener("keydown", dismiss, true);
    this._card?.addEventListener("click", dismiss);
  }

  // ── Card DOM helpers ───────────────────────────────────────────────────────

  _buildCard() {
    if (this._card) {
      this._card.removeAttribute("hidden");
      return;
    }
    const card = document.createElement("div");
    card.className = "tut-card";

    this._cardText = document.createElement("div");
    this._cardText.className = "tut-card-text";

    const hint = document.createElement("div");
    hint.className = "tut-card-hint";
    hint.textContent = "Skip (Esc)";

    card.appendChild(this._cardText);
    card.appendChild(hint);
    document.body.appendChild(card);
    this._card = card;
  }

  _setCardText(text) {
    if (!this._cardText) return;
    this._cardText.textContent = text;
  }

  _hideCard() {
    if (!this._card) return;
    this._card.setAttribute("hidden", "");
  }
}
