// aim.js — AimMode: reticle, FOV zoom, and fire input for INTERCEPT wave.
//
// LISTENER-LEAK PREVENTION:
//   All event handlers are stored as bound arrow functions on the instance and
//   only attached in enable() / removed in disable(). A guard in enable() bails
//   immediately if already active, so repeated enable() calls cannot stack
//   duplicate listeners.
//
// FOV EASING:
//   update(dt) linearly interpolates camera.fov toward the target (58 when
//   active, originalFov when not). The lerp rate is chosen so the transition
//   completes in ≤ 150 ms. updateProjectionMatrix() is called only when the
//   fov value actually changed. When inactive AND fov is already restored,
//   update() returns immediately — zero per-frame cost in the idle path.
//
// FIRE INPUT:
//   mousedown button 0 fires only while drone.locked === true (first unlocked
//   click gives pointer-lock per the FPS pattern — that click is consumed by
//   drone.dom, not us, so we never see it while !drone.locked).
//   KeyF held = autofire: fires once per frame while held; T3 will impose
//   the real cooldown. Ignored while a text INPUT/TEXTAREA is focused.

const FOV_AIM    = 58;
// Duration (seconds) for the FOV easing transition to complete.
const FOV_EASE_S = 0.150;

export class AimMode {
  /**
   * @param {{ camera: THREE.PerspectiveCamera, drone: object }} deps
   */
  constructor({ camera, drone }) {
    this._camera  = camera;
    this._drone   = drone;
    /** @type {number} original fov read at construction time */
    this._origFov = camera.fov;
    /** @type {number} current eased fov (mirrors camera.fov) */
    this._curFov  = camera.fov;
    /** @type {number} °/s rate so the full origFov→FOV_AIM span finishes in FOV_EASE_S */
    this._fovRate = Math.abs(this._origFov - FOV_AIM) / FOV_EASE_S;

    /** @type {boolean} */
    this._active = false;

    /** @type {boolean} KeyF held state */
    this._fHeld = false;

    /** @type {HTMLElement|null} reticle DOM node, created lazily */
    this._reticle = null;

    /** @type {Function[]} registered onFire callbacks */
    this._fireCbs = [];

    // Bound handlers — stored so the same reference is passed to both
    // addEventListener and removeEventListener.
    this._onMouseDown = (e) => {
      if (e.button !== 0) return;
      if (!this._drone.locked) return;
      this._emitFire();
    };
    this._onKeyDown = (e) => {
      if (e.code !== "KeyF") return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.repeat) return; // handled by _fHeld staying true
      this._fHeld = true;
    };
    this._onKeyUp = (e) => {
      if (e.code !== "KeyF") return;
      this._fHeld = false;
    };
  }

  // ── Public API ────────────────────────────────────────────────────────────

  get active() { return this._active; }

  /**
   * Register a callback invoked on each fire event.
   * @param {Function} cb
   */
  onFire(cb) {
    this._fireCbs.push(cb);
  }

  /** Remove a previously registered fire callback. */
  offFire(cb) {
    const i = this._fireCbs.indexOf(cb);
    if (i >= 0) this._fireCbs.splice(i, 1);
  }

  /**
   * Enable aim mode: show reticle, start FOV easing toward 58°, attach input.
   * Idempotent — safe to call when already active.
   */
  enable() {
    if (this._active) return;
    this._active = true;
    this._ensureReticle();
    this._reticle.style.display = "block";
    window.addEventListener("mousedown", this._onMouseDown);
    window.addEventListener("keydown",   this._onKeyDown);
    window.addEventListener("keyup",     this._onKeyUp);
  }

  /**
   * Disable aim mode: hide reticle, ease FOV back, detach input.
   * Idempotent — safe to call when already inactive.
   */
  disable() {
    if (!this._active) return;
    this._active = false;
    this._fHeld  = false;
    if (this._reticle) this._reticle.style.display = "none";
    window.removeEventListener("mousedown", this._onMouseDown);
    window.removeEventListener("keydown",   this._onKeyDown);
    window.removeEventListener("keyup",     this._onKeyUp);
  }

  /**
   * Per-frame update. Call from the render loop with dt in seconds.
   * Zero cost when never enabled (fov already at original, inactive).
   * @param {number} dt  frame delta in seconds
   */
  update(dt) {
    const target = this._active ? FOV_AIM : this._origFov;

    // Fast-exit: nothing to do.
    if (!this._active && this._curFov === this._origFov) return;

    // Ease fov toward target.
    const step = this._fovRate * dt;
    const prev = this._curFov;
    if (Math.abs(this._curFov - target) <= step) {
      this._curFov = target;
    } else {
      this._curFov += (target > this._curFov ? 1 : -1) * step;
    }

    if (this._curFov !== prev) {
      this._camera.fov = this._curFov;
      this._camera.updateProjectionMatrix();
    }

    // Autofire: KeyF held fires every frame (T3 will gate on cooldown).
    if (this._active && this._fHeld) {
      const tag = document.activeElement?.tagName;
      if (tag !== "INPUT" && tag !== "TEXTAREA") {
        this._emitFire();
      }
    }
  }

  /**
   * Tear down — detach listeners, remove reticle from DOM.
   */
  dispose() {
    this.disable();
    this._reticle?.remove();
    this._reticle = null;
    this._fireCbs = [];
  }

  // ── Private ───────────────────────────────────────────────────────────────

  _emitFire() {
    for (const cb of this._fireCbs) {
      try { cb(); } catch (e) { console.error("[aim:fire]", e); }
    }
  }

  /** Create the #reticle DOM node lazily on first enable. */
  _ensureReticle() {
    if (this._reticle) return;
    const el = document.createElement("div");
    el.id = "reticle";
    el.style.display = "none";
    document.body.appendChild(el);
    this._reticle = el;
  }
}
