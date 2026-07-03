// nightSky.js — B11.T12 star field + moon.
//
// Two objects, both gated by nightFactor alone (NOT the "City lights"
// checkbox — that toggle only governs cityLights.js's ground-level points;
// stars + moon are simply part of the night sky itself, same as how the sky
// dome's colour already responds to nightFactor with no separate toggle).
//   - stars: ONE THREE.Points, ~1200 points, on a 550 km dome radius
//     (inside the 600 km camera far plane), additive + logdepth.
//   - moon: a Sprite using the same canvas-radial-gradient recipe as the sun
//     disc in sky.js, positioned opposite the sun's azimuth at a fixed 45°
//     elevation on the same dome radius.
// Both FOLLOW THE CAMERA in x/z every frame (mirrors sky.js's updateSky()
// re-centring the sky dome + sun sprite on camPos) so neither parallaxes
// like a nearby object — see update() below.
//
// API: installNightSky({ scene, daynight, camera })
//   → { update() }

import * as THREE from "three";

// ---------------------------------------------------------------------------
// Deterministic PRNG — Mulberry32, fixed in-file seed. Only used at install
// time to scatter the star field once; never re-seeded, never touches Date.
// ---------------------------------------------------------------------------
function _mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const STAR_SEED = 20260702;   // same date-seed convention as gen_city_lights.py

const STAR_COUNT = 1200;
const DOME_RADIUS_M = 550_000;   // 550 km — inside the 600 km camera far plane
const STAR_SIZE_MIN_PX = 1.0;
const STAR_SIZE_MAX_PX = 3.0;
const STAR_BRIGHT_FRACTION = 0.06;   // "a few brighter outliers"
const STAR_BRIGHT_SIZE_MAX_PX = 6.0;

const MOON_DISTANCE_M = DOME_RADIUS_M;   // sits on the same dome as the stars
const MOON_ELEVATION_DEG = 45;
const MOON_SCALE_M = 14_000;             // ~14 km, within the 12-16 km design range

// ---------------------------------------------------------------------------
// Star shader — additive point sprites, per-vertex size, single warm-white
// tint (no per-star colour attribute needed — real starlight reads ~white/
// pale-blue at this scale, and the design only calls for size variation).
// ---------------------------------------------------------------------------
// The renderer runs logarithmicDepthBuffer: true (main.js) — every custom
// ShaderMaterial MUST include the logdepthbuf chunks or the log-depth write
// mismatches the built-in materials' and the points fail depth test against
// everything, rendering zero pixels (B10 post-mortem, paid for in blood).
const _starVertexShader = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aSize;
uniform float uPixelRatio;
void main() {
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uPixelRatio;
  gl_Position = projectionMatrix * mvPos;
  #include <logdepthbuf_vertex>
}
`;

const _starFragmentShader = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D uTex;
uniform float uOpacity;
uniform vec3 uColor;
void main() {
  #include <logdepthbuf_fragment>
  // Same alpha-mask-only recipe as cityLights.js: the canvas texture's RGB
  // samples as ~0 (colour-management quirk, commit 2e04555 post-mortem) —
  // take colour from the uniform, falloff from the texture alpha only.
  float mask = texture2D(uTex, gl_PointCoord).a;
  gl_FragColor = vec4(uColor, mask * uOpacity);
}
`;

const STAR_COLOR = new THREE.Color(0xdce8ff);   // pale cool white

function _starGlowTexture() {
  const SIZE = 32;
  const c = document.createElement("canvas");
  c.width = SIZE; c.height = SIZE;
  const ctx = c.getContext("2d");
  const grad = ctx.createRadialGradient(SIZE / 2, SIZE / 2, 0, SIZE / 2, SIZE / 2, SIZE / 2);
  grad.addColorStop(0,    "rgba(255,255,255,1)");
  grad.addColorStop(0.4,  "rgba(255,255,255,0.5)");
  grad.addColorStop(1,    "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SIZE, SIZE);
  return new THREE.CanvasTexture(c);
}

// ---------------------------------------------------------------------------
// Moon texture — same 128px radial-gradient canvas recipe as sky.js's
// _sunDiscTexture(), pale cool tint instead of warm.
// ---------------------------------------------------------------------------
function _moonDiscTexture() {
  const size = 128;
  const cvs = document.createElement("canvas");
  cvs.width = size; cvs.height = size;
  const ctx = cvs.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0.00, "rgba(238, 242, 255, 1.0)");
  grad.addColorStop(0.35, "rgba(220, 228, 245, 0.8)");
  grad.addColorStop(0.65, "rgba(200, 212, 235, 0.25)");
  grad.addColorStop(1.00, "rgba(200, 212, 235, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * @param {object} opts
 * @param {THREE.Scene} opts.scene
 * @param {{ getNightFactor: () => number }} opts.daynight
 * @param {THREE.Camera} opts.camera
 * @param {{ sunDir: THREE.Vector3 }} [opts.skyRig] — live sun-direction rig
 *   from installSky() (main.js already holds this at the call site). Optional:
 *   if omitted the moon falls back to a fixed opposite-of-original-sun bearing.
 * @returns {{ update: () => void }}
 */
export function installNightSky({ scene, daynight, camera, skyRig }) {
  // -------------------------------------------------------------------------
  // Star field geometry — scattered once at install time on a unit sphere,
  // radius baked to DOME_RADIUS_M. Positions stored relative to the dome
  // centre; update() re-centres the whole Points object on the camera x/z
  // every frame (see below) rather than rewriting the buffer.
  // -------------------------------------------------------------------------
  const rand = _mulberry32(STAR_SEED);
  const positions = new Float32Array(STAR_COUNT * 3);
  const sizes     = new Float32Array(STAR_COUNT);
  for (let i = 0; i < STAR_COUNT; i++) {
    // Uniform point on a sphere (Marsaglia-ish via rejection would need more
    // draws from the same stream; a simple cos-theta/phi parametrisation is
    // deterministic and even enough for a decorative star dome).
    const u = rand();
    const v = rand();
    const theta = 2 * Math.PI * u;        // azimuth
    const cosPhi = 1 - 2 * v;              // -1..1, uniform over sphere area
    const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
    // Fold to the upper hemisphere only (y >= 0) — a full-sphere scatter would
    // waste half the points below the horizon, where fog/terrain occlude them
    // in practice anyway.
    const y = Math.abs(cosPhi);
    const x = sinPhi * Math.cos(theta);
    const z = sinPhi * Math.sin(theta);
    const base = i * 3;
    positions[base]     = x * DOME_RADIUS_M;
    positions[base + 1] = y * DOME_RADIUS_M;
    positions[base + 2] = z * DOME_RADIUS_M;

    const bright = rand() < STAR_BRIGHT_FRACTION;
    sizes[i] = bright
      ? STAR_SIZE_MAX_PX + rand() * (STAR_BRIGHT_SIZE_MAX_PX - STAR_SIZE_MAX_PX)
      : STAR_SIZE_MIN_PX + rand() * (STAR_SIZE_MAX_PX - STAR_SIZE_MIN_PX);
  }

  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  starGeo.setAttribute("aSize",    new THREE.BufferAttribute(sizes,     1));

  const starMat = new THREE.ShaderMaterial({
    uniforms: {
      uTex:        { value: _starGlowTexture() },
      uOpacity:    { value: 0 },
      uColor:      { value: STAR_COLOR },
      // Set once at install (decorative dome, not a real-world-metres
      // projection like cityLights.js) — same cap convention as main.js's
      // renderer.setPixelRatio(Math.min(devicePixelRatio, 2)) / DPR_MAX.
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
    },
    vertexShader:   _starVertexShader,
    fragmentShader: _starFragmentShader,
    transparent:    true,
    depthWrite:     false,
    // Additive dome markers, same depthTest-off treatment as every other
    // additive light source in this codebase (sun disc, city lights, UFO
    // glow) — real-hardware verified pattern, see cityLights.js comment.
    depthTest:      false,
    blending:       THREE.AdditiveBlending,
  });

  const stars = new THREE.Points(starGeo, starMat);
  stars.name = "night-sky-stars";
  stars.visible = false;
  stars.renderOrder = -2;   // behind the sun/moon sprites (-1) and sky (default)
  // Dome is always fully populated and re-centred on the camera every frame
  // (never partially filled like cityLights' async buffer) — but it still
  // spans the full 550 km radius, so a per-frame boundingSphere recompute is
  // wasted work for an object that's either fully visible or fully culled.
  stars.frustumCulled = false;

  // -------------------------------------------------------------------------
  // Moon sprite — mirrors sky.js's sun-disc sprite recipe exactly (Sprite +
  // SpriteMaterial + canvas radial-gradient CanvasTexture), just a paler tint
  // and positioned opposite the sun.
  // -------------------------------------------------------------------------
  const moon = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: _moonDiscTexture(),
      transparent: true,
      depthWrite: false,
      depthTest: false,
      fog: false,
      opacity: 0,
    }),
  );
  moon.name = "night-sky-moon";
  moon.visible = false;
  moon.renderOrder = -1;
  moon.scale.set(MOON_SCALE_M, MOON_SCALE_M, 1);

  const group = new THREE.Group();
  group.name = "night-sky";
  group.add(stars);
  group.add(moon);
  scene.add(group);

  // Fallback bearing if no skyRig was supplied — opposite of the ORIGINAL
  // (noon) sun direction's horizontal bearing, held fixed. Only exercised if
  // main.js is ever refactored to call this without skyRig; the wired path
  // always passes it (see main.js).
  const _fallbackDir = new THREE.Vector3(-0.5, 0, -0.4).normalize();

  // Scratch vector — reused every frame, no per-frame allocation.
  const _moonPos = new THREE.Vector3();

  function _updateMoonPosition(camPos) {
    const sunDir = skyRig && skyRig.sunDir ? skyRig.sunDir : _fallbackDir;
    // Horizontal compass bearing of the sun in the world's X/Z ground plane
    // (X = East, +Z = South per coords.js) — independent of daynight.js's
    // internal X/Y sweep parametrisation, so this stays correct regardless
    // of how the day-arc itself is implemented.
    const sunAzimuth = Math.atan2(sunDir.x, -sunDir.z);   // 0 = North, +π/2 = East
    const moonAzimuth = sunAzimuth + Math.PI;              // opposite side of sky
    const elevRad = (MOON_ELEVATION_DEG * Math.PI) / 180;
    const horizR = Math.cos(elevRad) * MOON_DISTANCE_M;
    const moonY  = Math.sin(elevRad) * MOON_DISTANCE_M;
    const moonX  = Math.sin(moonAzimuth) * horizR;
    const moonZ  = -Math.cos(moonAzimuth) * horizR;
    _moonPos.set(camPos.x + moonX, moonY, camPos.z + moonZ);
    moon.position.copy(_moonPos);
  }

  // ---------------------------------------------------------------------------
  // update — called every frame from main.js, right after sky-follow/daynight
  // (needs the current frame's nightFactor + the current sun direction).
  // ---------------------------------------------------------------------------
  function update() {
    const factor = daynight.getNightFactor();
    const camPos = camera.position;

    // Dome + moon FOLLOW THE CAMERA in x/z (mirrors sky.js's updateSky()
    // re-centring) so neither parallaxes like a nearby object.
    stars.position.set(camPos.x, 0, camPos.z);
    _updateMoonPosition(camPos);

    const visible = factor >= 0.05;
    stars.visible = visible;
    moon.visible  = visible;
    starMat.uniforms.uOpacity.value = visible ? factor : 0;
    moon.material.opacity           = visible ? 0.85 * factor : 0;
  }

  return { group, stars, moon, update };
}
