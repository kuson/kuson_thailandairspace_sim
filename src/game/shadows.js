// shadows.js — Altitude-faded shadow blobs (B9.T7).
// ONE shared PlaneGeometry + CanvasTexture.
// Per-blob: cloned MeshBasicMaterial (so opacity is independent), shared texture.
// Usage:
//   import { makeShadowBlob } from "./shadows.js";
//   const blob = makeShadowBlob(scene, 60);        // baseSize metres
//   blob.update(x, z, groundY, agl);               // call per-frame (uses cached values)
//   blob.hide();                                    // force invisible
//   blob.dispose();                                 // remove mesh + dispose cloned mat

import * as THREE from "three";

// ── Module-level singletons — NEVER disposed ──────────────────────────────

// 128×128 radial gradient: opaque dark centre → fully transparent edge.
const _canvas = (() => {
  const c = document.createElement("canvas");
  c.width  = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0,   "rgba(0,0,0,0.8)");
  grad.addColorStop(1,   "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return c;
})();

const _shadowTex = new THREE.CanvasTexture(_canvas);

// Unit-size horizontal plane (rotation baked in so each Mesh sits flat).
const _planeGeo = (() => {
  const g = new THREE.PlaneGeometry(1, 1);
  g.rotateX(-Math.PI / 2);   // lay flat on XZ plane
  return g;
})();

// Base material — cloned per blob so opacity is per-entity.
const _baseMat = new THREE.MeshBasicMaterial({
  map:         _shadowTex,
  transparent: true,
  depthWrite:  false,
  side:        THREE.DoubleSide,
});

// ── Scale/opacity law ──────────────────────────────────────────────────────
// k = 1 when agl ≤ 200 m, 0 when agl ≥ 2000 m, linear between.
// scale  = baseSize × (0.5 + 0.5k)
// opacity = 0.35 × k
// visible = k > 0

const AGL_FULL  = 200;    // m — full blob below this
const AGL_ZERO  = 2000;   // m — invisible above this
const OP_MAX    = 0.35;

function _computeK(agl) {
  if (agl <= AGL_FULL)  return 1;
  if (agl >= AGL_ZERO)  return 0;
  return 1 - (agl - AGL_FULL) / (AGL_ZERO - AGL_FULL);
}

// ── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a shadow blob and add its mesh to `parent` (scene or group).
 * @param {THREE.Object3D} parent   Scene or group to add the mesh to.
 * @param {number}         baseSize Diameter in world metres at full size.
 * @returns {{ update(x:number, z:number, groundY:number, agl:number):void,
 *             hide():void,
 *             dispose():void }}
 */
export function makeShadowBlob(parent, baseSize) {
  const mat  = _baseMat.clone();
  const mesh = new THREE.Mesh(_planeGeo, mat);
  mesh.renderOrder = -1;   // draw under entities
  mesh.visible = false;    // hidden until the first update() positions it
  parent.add(mesh);

  function update(x, z, groundY, agl) {
    const k = _computeK(agl);
    if (k <= 0) {
      mesh.visible = false;
      return;
    }
    mesh.visible     = true;
    const s          = baseSize * (0.5 + 0.5 * k);
    mesh.scale.setScalar(s);
    mesh.position.set(x, groundY + 1, z);
    mat.opacity      = OP_MAX * k;
  }

  function hide() {
    mesh.visible = false;
  }

  function dispose() {
    parent.remove(mesh);
    mat.dispose();
  }

  return { update, hide, dispose };
}
