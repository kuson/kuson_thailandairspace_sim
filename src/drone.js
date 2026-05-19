// drone.js — 6DoF drone movement with WASD + Q/E + mouse-look, plus pointer-lock.
import * as THREE from "three";

const KMH_TO_MS = 1 / 3.6;
const BOOST_FACTOR = 3;
const PITCH_LIMIT = (85 * Math.PI) / 180;
const MOUSE_SENSITIVITY = 0.0022;
const DOWN_PITCH = -Math.PI / 2 + 0.002;

/** Absolute cruise speeds (km/h) per preset button. */
export const SPEED_PRESETS = [
  { id: "1x", label: "1×", kmh: 50 },
  { id: "cessna172", label: "Cessna 172", kmh: 226 },
  { id: "learjet", label: "Learjet", kmh: 850 },
  { id: "b777", label: "Boeing 777", kmh: 920 },
  { id: "100x", label: "100×", kmh: 10_000 },
];

export function presetById(id) {
  return SPEED_PRESETS.find((p) => p.id === id) ?? SPEED_PRESETS[0];
}

export class Drone {
  constructor(camera, domElement) {
    this.camera = camera;
    this.dom = domElement;

    this.position = new THREE.Vector3(0, 200, 0);
    this.bodyYaw = 0;
    this.bodyPitch = 0;
    this.yaw = 0;
    this.pitch = 0;

    const bodyGeo = new THREE.ConeGeometry(8, 18, 6);
    bodyGeo.rotateX(Math.PI / 2);
    const bodyMat = new THREE.MeshBasicMaterial({
      color: 0x66ffcc,
      transparent: true,
      opacity: 0.0,
    });
    this.mesh = new THREE.Mesh(bodyGeo, bodyMat);

    this.keys = new Set();
    this.hover = false;
    this.locked = false;
    this.speedPresetId = "100x";
    this.cruiseSpeedMs = presetById("100x").kmh * KMH_TO_MS;
    this.currentSpeed = 0;
    this.flightLocked = false;
    this.identifyMode = false;
    /** @type {null | 'down' | 'left' | 'right'} */
    this.cameraMode = null;
    this.onIdentifyToggle = null;
    this.onCameraModeChange = null;

    this._bindEvents();
  }

  _applyCameraMode() {
    if (this.cameraMode === "down") {
      this.yaw = this.bodyYaw;
      this.pitch = DOWN_PITCH;
    } else if (this.cameraMode === "left") {
      this.yaw = this.bodyYaw - Math.PI / 2;
      this.pitch = -0.06;
    } else if (this.cameraMode === "right") {
      this.yaw = this.bodyYaw + Math.PI / 2;
      this.pitch = -0.06;
    } else {
      this.yaw = this.bodyYaw;
      this.pitch = this.bodyPitch;
    }
  }

  _viewModeFromKey(key) {
    if (key === "arrowdown") return "down";
    if (key === "arrowleft") return "left";
    if (key === "arrowright") return "right";
    return null;
  }

  _setCameraMode(mode) {
    const next = this.cameraMode === mode ? null : mode;
    this.cameraMode = next;
    this._applyCameraMode();
    this._syncCamera();
    this.onCameraModeChange?.(this.cameraMode);
  }

  _syncCamera() {
    this.camera.position.copy(this.position);
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.mesh.position.copy(this.position);
    this.mesh.rotation.order = "YXZ";
    this.mesh.rotation.y = this.bodyYaw;
    this.mesh.rotation.x = this.bodyPitch;
  }

  _bindEvents() {
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if (k === "i") {
        this.identifyMode = !this.identifyMode;
        this.onIdentifyToggle?.(this.identifyMode);
        e.preventDefault();
        return;
      }
      const viewMode = this._viewModeFromKey(k);
      if (viewMode) {
        this._setCameraMode(viewMode);
        e.preventDefault();
        return;
      }
      if (this.flightLocked) return;
      this.keys.add(k);
      if (k === " ") {
        this.hover = !this.hover;
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", (e) => {
      if (this.flightLocked) return;
      const k = e.key.toLowerCase();
      if (this._viewModeFromKey(k)) return;
      this.keys.delete(k);
    });
    window.addEventListener("blur", () => { this.keys.clear(); });

    this.dom.addEventListener("click", () => {
      this.dom.requestPointerLock?.();
    });
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === this.dom;
    });

    let dragging = false;
    this.dom.addEventListener("mousedown", () => { dragging = true; });
    window.addEventListener("mouseup", () => { dragging = false; });
    document.addEventListener("mousemove", (e) => {
      if (this.cameraMode) return;
      if (this.locked || dragging) {
        this.bodyYaw -= e.movementX * MOUSE_SENSITIVITY;
        this.bodyPitch -= e.movementY * MOUSE_SENSITIVITY;
        this.bodyPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.bodyPitch));
        this.yaw = this.bodyYaw;
        this.pitch = this.bodyPitch;
      }
    });
  }

  forward() {
    const yaw = this.bodyYaw;
    const pitch = this.cameraMode === "down" ? 0 : this.bodyPitch;
    return new THREE.Vector3(
      -Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch),
    );
  }

  right() {
    return new THREE.Vector3(Math.cos(this.bodyYaw), 0, -Math.sin(this.bodyYaw));
  }

  headingDeg() {
    let h = (-this.bodyYaw * 180) / Math.PI;
    h = ((h % 360) + 360) % 360;
    return h;
  }

  setSpeedPreset(id) {
    const p = presetById(id);
    this.speedPresetId = p.id;
    this.cruiseSpeedMs = p.kmh * KMH_TO_MS;
  }

  /** @deprecated use setSpeedPreset */
  setSpeedMultiplier() {}

  activePreset() {
    return presetById(this.speedPresetId);
  }

  update(dt) {
    if (this.flightLocked) {
      this.currentSpeed = 0;
      return;
    }

    if (this.cameraMode) this._applyCameraMode();

    const speed = this.cruiseSpeedMs * (this.keys.has("shift") ? BOOST_FACTOR : 1);
    const fwd = this.forward();
    const rt = this.right();

    const move = new THREE.Vector3();
    let vy = 0;

    if (!this.hover) {
      if (this.keys.has("w")) move.add(fwd);
      if (this.keys.has("s")) move.sub(fwd);
      if (this.keys.has("a")) move.sub(rt);
      if (this.keys.has("d")) move.add(rt);

      if (this.keys.has("e")) vy += 1;
      if (this.keys.has("q")) vy -= 1;
    }

    if (move.lengthSq() > 0) move.normalize();
    move.multiplyScalar(speed * dt);
    this.position.add(move);
    this.position.y += vy * speed * dt;

    const horiz = move.length() / Math.max(dt, 1e-6);
    const vert = Math.abs(vy * speed);
    this.currentSpeed = Math.hypot(horiz, vert);

    if (this.position.y < 1) this.position.y = 1;
    this._syncCamera();
  }

  snapshot() {
    return {
      x: this.position.x,
      y: this.position.y,
      z: this.position.z,
      yaw: this.bodyYaw,
      pitch: this.bodyPitch,
      speedPresetId: this.speedPresetId,
      hover: this.hover,
      cameraMode: this.cameraMode,
    };
  }

  restore(s) {
    if (!s) return;
    this.bodyYaw = s.yaw;
    this.bodyPitch = s.pitch;
    this.cameraMode = s.cameraMode ?? null;
    this.teleport(s.x, s.y, s.z, s.yaw, s.pitch);
    if (s.speedPresetId) this.setSpeedPreset(s.speedPresetId);
    else if (s.speedMultiplier) this.setSpeedPreset("100x");
    this.hover = s.hover ?? false;
    this._applyCameraMode();
  }

  teleport(x, y, z, yawRad = 0, pitchRad = -0.1) {
    this.position.set(x, y, z);
    this.bodyYaw = yawRad;
    this.bodyPitch = pitchRad;
    if (!this.cameraMode) {
      this.yaw = yawRad;
      this.pitch = pitchRad;
    } else {
      this._applyCameraMode();
    }
    this._syncCamera();
  }
}
