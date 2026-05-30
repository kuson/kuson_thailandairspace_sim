// sky.js — atmospheric sky dome + sun disc (Phase 2 P2.T1; Betterment-2 P4.T1).
//
// Uses the three.js Sky shader (Preetham analytical scattering) + a soft
// sun-disc sprite, sharing the scene DirectionalLight's sun direction.
//
// Betterment-2 P4.T1 (operator report E3 "skies should be blue — it's dark as
// space"): the root cause was that the sky dome was added at the world origin
// and never moved, so flying away from Bangkok (or climbing in the 100× UFO)
// put the camera near the edge of the 450 km sky box — half the view became
// black void. Fixes:
//   1. updateSky() re-centres the dome + sun on the camera every frame, so the
//      sky always fully surrounds the viewer (no black wedge).
//   2. Richer Preetham params for a vivid daytime blue.
//   3. Altitude transition: full blue up to ~60 km AMSL, fading toward space
//      black by ~100 km (the UFO is the only preset that climbs that high).
import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";

// Base Preetham params (sea-level). Altitude scales rayleigh/mie toward 0 to
// fade the dome to black at extreme altitude.
// Lower turbidity (cleaner air) + higher rayleigh push the daytime dome to a
// vivid, saturated blue (operator: "make the skies blue"). mie trimmed so the
// sun's white halo doesn't wash the blue out near the horizon.
const BASE = { turbidity: 3, rayleigh: 4, mieCoefficient: 0.004, mieDirectionalG: 0.8 };
const SKY_BLUE_CEILING_M = 60_000;   // full blue at/below this
const SKY_SPACE_M        = 100_000;  // ~black at/above this
const SUN_DISTANCE = 200_000;

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
 * Install the sky dome and sun sprite. Returns a rig to pass to updateSky()
 * every frame.
 */
export function installSky(scene, renderer, sunDir) {
  const sky = new Sky();
  sky.scale.setScalar(450_000);

  const u = sky.material.uniforms;
  u.turbidity.value       = BASE.turbidity;
  u.rayleigh.value        = BASE.rayleigh;
  u.mieCoefficient.value  = BASE.mieCoefficient;
  u.mieDirectionalG.value = BASE.mieDirectionalG;
  u.sunPosition.value.copy(sunDir);
  scene.add(sky);

  const sunSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: _sunDiscTexture(),
      transparent: true,
      depthWrite: false,
      depthTest: false,
      fog: false,
    }),
  );
  sunSprite.position.copy(sunDir).multiplyScalar(SUN_DISTANCE);
  sunSprite.scale.set(18_000, 18_000, 1);
  sunSprite.renderOrder = -1;
  scene.add(sunSprite);

  return { sky, sunSprite, sunDir: sunDir.clone() };
}

/**
 * Per-frame update: re-centre the dome + sun on the camera so the sky always
 * surrounds the viewer, and fade the dome toward space-black above 60 km.
 *
 * @param rig     return value of installSky()
 * @param camPos  THREE.Vector3 camera/eye world position
 * @param altM    altitude AMSL in metres (for the space transition)
 */
export function updateSky(rig, camPos, altM = 0) {
  if (!rig) return;
  // Follow the camera horizontally + vertically — the dome is centred on the
  // eye so its far wall is always 225 km away in every direction.
  rig.sky.position.set(camPos.x, 0, camPos.z);
  rig.sunSprite.position.set(
    camPos.x + rig.sunDir.x * SUN_DISTANCE,
    rig.sunDir.y * SUN_DISTANCE,
    camPos.z + rig.sunDir.z * SUN_DISTANCE,
  );

  // Altitude fade: k = 1 (full blue) at/below 60 km → 0 (~black) at/above 100 km.
  let k = 1;
  if (altM > SKY_BLUE_CEILING_M) {
    k = Math.max(0, 1 - (altM - SKY_BLUE_CEILING_M) / (SKY_SPACE_M - SKY_BLUE_CEILING_M));
  }
  const u = rig.sky.material.uniforms;
  u.rayleigh.value       = BASE.rayleigh * k;
  u.mieCoefficient.value = BASE.mieCoefficient * k;
  u.turbidity.value      = BASE.turbidity * k + 0.05;
  rig.sunSprite.material.opacity = 0.4 + 0.6 * k;
}
