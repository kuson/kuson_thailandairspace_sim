// sky.js — atmospheric sky dome + sun disc (Phase 2 P2.T1).
//
// Replaces the flat-blue scene.background with the three.js Sky shader
// (Preetham analytical scattering) and a soft sun-disc sprite. The sun
// direction is shared with the scene's DirectionalLight so the lighting
// matches the sky's sun position.
import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";

// Radial-gradient canvas texture for the sun-disc sprite. Cached so swapping
// sun position doesn't rebuild it.
function _sunDiscTexture() {
  const size = 256;
  const cvs = document.createElement("canvas");
  cvs.width = size; cvs.height = size;
  const ctx = cvs.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0.00, "rgba(255, 248, 220, 1.0)");
  grad.addColorStop(0.25, "rgba(255, 224, 160, 0.85)");
  grad.addColorStop(0.55, "rgba(255, 200, 120, 0.25)");
  grad.addColorStop(1.00, "rgba(255, 200, 120, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Install the sky dome and sun sprite into the scene.
 *
 * @param {THREE.Scene} scene
 * @param {THREE.WebGLRenderer} renderer  (currently unused; reserved for tonemap-aware sky)
 * @param {THREE.Vector3} sunDir  unit vector from origin toward the sun
 * @returns {{ sky: Sky, sunSprite: THREE.Sprite, sunDir: THREE.Vector3 }}
 */
export function installSky(scene, renderer, sunDir) {
  const sky = new Sky();
  sky.scale.setScalar(450_000);  // safely outside camera.far / fog.far

  const u = sky.material.uniforms;
  u.turbidity.value        = 4;
  u.rayleigh.value         = 1.5;
  u.mieCoefficient.value   = 0.005;
  u.mieDirectionalG.value  = 0.8;
  u.sunPosition.value.copy(sunDir);

  scene.add(sky);

  // Soft sun-disc sprite placed in the same direction.
  const sunSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: _sunDiscTexture(),
      transparent: true,
      depthWrite: false,
      depthTest: false,         // always render in front of fog / haze
      fog: false,
    }),
  );
  const SUN_DISTANCE = 200_000;
  sunSprite.position.copy(sunDir).multiplyScalar(SUN_DISTANCE);
  sunSprite.scale.set(18_000, 18_000, 1);
  sunSprite.renderOrder = -1;   // render before opaque so it sits behind the world
  scene.add(sunSprite);

  return { sky, sunSprite, sunDir: sunDir.clone() };
}
