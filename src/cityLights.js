// cityLights.js — B10.T5 night city + airport lights.
//
// ONE THREE.Points with additive ShaderMaterial (per-vertex size attribute).
// Covers THAI_CITIES + airports from data/airports.json.
// Visibility: opacity = daynight.getNightFactor() × 0.9, hidden by day.
// Toggle: setEnabled(bool) — composes with nightFactor (toggle OFF wins).
//
// API: installCityLights({ scene, daynight })
//   → { update(), setEnabled(on), reliftToTerrain() }

import * as THREE from "three";
import { THAI_CITIES } from "./cities.js";
import { geoToWorld } from "./coords.js";
import { elevationAt } from "./terrain.js";

// ---------------------------------------------------------------------------
// Shared glow texture — radial warm gradient, built once (mirrors ufo.js:14).
// ---------------------------------------------------------------------------
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
  return new THREE.CanvasTexture(c);
})();

// ---------------------------------------------------------------------------
// ShaderMaterial — minimal, per-vertex size + additive blend.
// Vertex shader scales by the `aSize` attribute; fragment samples the glow
// texture modulated by a warm amber tint and the material opacity uniform.
// ---------------------------------------------------------------------------
// The renderer runs logarithmicDepthBuffer (main.js) — every built-in
// material writes log depth, so a custom ShaderMaterial MUST include the
// logdepthbuf chunks or its conventional depth always fails the depth test
// and the points silently vanish (orchestrator-debugged in the C2 harness).
const _vertexShader = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aSize;
uniform float uScale;
varying float vAlpha;
void main() {
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  // aSize is a world-space glow diameter (metres); uScale converts world
  // size at depth -z to pixels: viewportPx / (2·tan(fov/2)). Capped so a
  // close fly-by reads as a soft glow, not a screen-filling blob.
  gl_PointSize = min(aSize * (uScale / -mvPos.z), 64.0);
  vAlpha = 1.0;
  gl_Position = projectionMatrix * mvPos;
  #include <logdepthbuf_vertex>
}
`;

const _fragmentShader = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D uTex;
uniform float uOpacity;
uniform vec3  uColor;
varying float vAlpha;
void main() {
  #include <logdepthbuf_fragment>
  vec4 t = texture2D(uTex, gl_PointCoord);
  gl_FragColor = vec4(uColor * t.rgb, t.a * uOpacity * vAlpha);
}
`;

// Warm amber city light colour.
const CITY_COLOR = new THREE.Color(0xffc878);

// Glow diameters in world metres by prominence (converted to pixels in the
// vertex shader via uScale / depth). Bangkok-class cities read ~40 px from
// 20 km out; small towns stay subtle.
const CITY_SIZE = [0, 600, 900, 1300];  // index 0 unused; prominence 1–3
const AIRPORT_SIZE = 700;                // fixed, between prominence 1 and 2

// ---------------------------------------------------------------------------
// installCityLights
// ---------------------------------------------------------------------------
/**
 * @param {object} opts
 * @param {THREE.Scene} opts.scene
 * @param {{ getNightFactor: () => number }} opts.daynight
 * @returns {{ update: () => void, setEnabled: (on: boolean) => void, reliftToTerrain: () => void }}
 */
export function installCityLights({ scene, daynight, camera, renderer }) {
  // Number of city entries (known at module load — static array).
  const CITY_COUNT = THAI_CITIES.length;
  // Airport count unknown until fetch resolves; pre-size to 0 and grow once.
  let _airportCount = 0;

  // We pre-allocate a buffer large enough for cities + a reasonable airport
  // ceiling (data/airports.json currently has 14 entries; 64 is generous).
  const MAX_AIRPORTS = 64;
  const MAX_TOTAL    = CITY_COUNT + MAX_AIRPORTS;

  // Geometry with city vertices initialised immediately; airports filled on
  // fetch resolve (relying on drawRange to hide the unfilled region).
  const positions = new Float32Array(MAX_TOTAL * 3);
  const sizes     = new Float32Array(MAX_TOTAL);

  // Fill cities now (elevationAt = 0 before terrain loads — reliftToTerrain
  // corrects this after terrain.bin resolves, same as cityBeacons).
  const _cityEntries = [];   // { lat, lon, bufIdx } — for relift
  for (let i = 0; i < CITY_COUNT; i++) {
    const city = THAI_CITIES[i];
    const w    = geoToWorld(city.lat, city.lon);
    const elev = elevationAt(city.lat, city.lon);
    const base = i * 3;
    positions[base]     = w.x;
    positions[base + 1] = elev + 30;
    positions[base + 2] = w.z;
    sizes[i] = CITY_SIZE[city.prominence] ?? CITY_SIZE[1];
    _cityEntries.push({ lat: city.lat, lon: city.lon, bufIdx: i });
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("aSize",    new THREE.BufferAttribute(sizes,     1));
  // Initially only cities are valid.
  geo.setDrawRange(0, CITY_COUNT);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTex:     { value: _glowTex },
      uOpacity: { value: 0 },
      uColor:   { value: CITY_COLOR },
      uScale:   { value: 640 },   // recomputed per-frame in update()
    },
    vertexShader:   _vertexShader,
    fragmentShader: _fragmentShader,
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.name      = "city-lights";
  points.visible   = false;
  points.renderOrder = 10;
  // Country-spanning static cloud: culling can only ever skip the single
  // draw call when no light is on screen, but the partially-filled buffer
  // (airports stream in later) makes the auto boundingSphere unreliable —
  // B9 trail-buffer precedent: opt out of frustum culling entirely.
  points.frustumCulled = false;

  // Wrap in a Group so callers get the same group/points shape as other layers.
  const group = new THREE.Group();
  group.name = "city-lights-group";
  group.add(points);
  scene.add(group);

  // User toggle state (persisted by groundSettings + main.js; we just hold
  // the runtime boolean here so update() can compose with nightFactor).
  let _enabled = true;

  // Airport entries for relift.
  const _airportEntries = [];   // { lat, lon, bufIdx }

  // ---------------------------------------------------------------------------
  // Async airport fill — fetch once, grow drawRange; never rebuild per flip.
  // ---------------------------------------------------------------------------
  fetch("./data/airports.json")
    .then(r => r.json())
    .then(data => {
      const airports = data.airports || (Array.isArray(data) ? data : []);
      _airportCount = 0;
      for (const ap of airports) {
        if (_airportCount >= MAX_AIRPORTS) break;
        if (typeof ap.lat !== "number" || typeof ap.lon !== "number") continue;
        const bufIdx = CITY_COUNT + _airportCount;
        const w      = geoToWorld(ap.lat, ap.lon);
        const elev   = elevationAt(ap.lat, ap.lon);
        const base   = bufIdx * 3;
        positions[base]     = w.x;
        positions[base + 1] = elev + 30;
        positions[base + 2] = w.z;
        sizes[bufIdx] = AIRPORT_SIZE;
        _airportEntries.push({ lat: ap.lat, lon: ap.lon, bufIdx });
        _airportCount++;
      }
      // Mark the updated region and extend drawRange.
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aSize.needsUpdate    = true;
      geo.setDrawRange(0, CITY_COUNT + _airportCount);
    })
    .catch(err => console.warn("[cityLights] airports fetch failed:", err));

  // ---------------------------------------------------------------------------
  // reliftToTerrain — called from main.js loadTerrain().then() alongside
  // cityBeacons.reliftToTerrain() and airportBeacons?.reliftToTerrain().
  // ---------------------------------------------------------------------------
  function reliftToTerrain() {
    for (const e of _cityEntries) {
      const base = e.bufIdx * 3;
      positions[base + 1] = elevationAt(e.lat, e.lon) + 30;
    }
    for (const e of _airportEntries) {
      const base = e.bufIdx * 3;
      positions[base + 1] = elevationAt(e.lat, e.lon) + 30;
    }
    geo.attributes.position.needsUpdate = true;
  }

  // ---------------------------------------------------------------------------
  // setEnabled — user toggle (composes with nightFactor in update()).
  // ---------------------------------------------------------------------------
  function setEnabled(on) {
    _enabled = on;
    // Immediate visibility: respect current factor.
    const factor = daynight.getNightFactor();
    points.visible = _enabled && factor > 0.05;
    mat.uniforms.uOpacity.value = _enabled ? factor * 0.9 : 0;
  }

  // ---------------------------------------------------------------------------
  // update — called every frame from main.js _safe("citylights", ...).
  // No allocation: only writes two scalar properties.
  // ---------------------------------------------------------------------------
  function update() {
    const factor = daynight.getNightFactor();
    points.visible = _enabled && factor > 0.05;
    mat.uniforms.uOpacity.value = _enabled ? factor * 0.9 : 0;
    // World-metres → pixels conversion for the vertex shader. Tracks fov
    // changes (aim-mode zoom) and resize; two scalar reads, no allocation.
    // Skip when the canvas reports 0 (backgrounded/unsized tab) — keep the
    // last good scale rather than collapsing every point to 0 px.
    if (camera && renderer) {
      const hPx = renderer.domElement.height;
      if (hPx > 0) {
        mat.uniforms.uScale.value =
          hPx / (2 * Math.tan((camera.fov * Math.PI) / 360));
      }
    }
  }

  return { group, points, update, setEnabled, reliftToTerrain };
}
