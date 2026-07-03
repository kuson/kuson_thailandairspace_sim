// cityLights.js — B10.T5 night city + airport lights; B11.T12 rewrite to
// data-generated per-city point constellations (scripts/gen_city_lights.py).
//
// ONE THREE.Points with additive ShaderMaterial (per-vertex aSize + aColor
// attributes). Loads data/cityLightPoints.json — thousands of gaussian-
// scattered warm points per city (dense "town glow" instead of one dot per
// city) plus one brighter, cooler point per airport.
// Visibility: opacity = daynight.getNightFactor() × 0.9, hidden by day.
// Toggle: setEnabled(bool) — composes with nightFactor (toggle OFF wins).
// This is the SAME "City lights" checkbox as before (groundDetail.cityLights)
// — no new WORLD toggle was added for this rewrite. Stars + moon (nightSky.js)
// are a separate layer gated by nightFactor alone, not this checkbox.
//
// API: installCityLights({ scene, daynight, camera, renderer })
//   → { update(), setEnabled(on), reliftToTerrain() }

import * as THREE from "three";
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
// ShaderMaterial — per-vertex size (px) + per-vertex colour, additive blend.
// aSize here is already a SCREEN-PIXEL diameter (baked by the generator,
// 2–7 px cities / 8 px airports) — no world-to-pixel projection needed, just
// a device-pixel-ratio scale + a hard cap so a near-camera point can never
// balloon into a dome (B10 post-mortem: the old per-city single-dot recipe
// did exactly that before the depthTest fix; capping at the shader level is
// a second, cheaper line of defence for the new dense point cloud).
// ---------------------------------------------------------------------------
// The renderer runs logarithmicDepthBuffer (main.js) — every built-in
// material writes log depth, so a custom ShaderMaterial MUST include the
// logdepthbuf chunks or its conventional depth always fails the depth test
// and the points silently vanish (orchestrator-debugged in the C2 harness).
const _vertexShader = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aSize;
attribute vec3 aColor;
uniform float uPixelRatio;
varying vec3 vColor;
varying float vFade;
void main() {
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  // aSize is a baked screen-pixel diameter (generator output) — scale only
  // by devicePixelRatio, then hard-cap at 24 px (B11.T12 design cap) so
  // near-camera points cannot recur as the city-dome bug.
  gl_PointSize = min(aSize * uPixelRatio, 24.0);
  vColor = aColor;
  // Spread compensation (C4 fix): a distant city's 30–220 additive points
  // converge onto a handful of pixels and stack to a blown-white blob (the
  // T12 constellation redesign multiplied per-city point count ~75×). Fade
  // PER-POINT alpha with view distance so the cluster's summed energy stays
  // roughly constant: near (points spread over many pixels) full alpha, far
  // (points converged) ~6% — ≈30 overlapping points then sum to ≲1.8.
  float distKm = -mvPos.z / 1000.0;
  vFade = mix(1.0, 0.06, smoothstep(6.0, 70.0, distKm));
  gl_Position = projectionMatrix * mvPos;
  #include <logdepthbuf_vertex>
}
`;

const _fragmentShader = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D uTex;
uniform float uOpacity;
varying vec3 vColor;
varying float vFade;
void main() {
  #include <logdepthbuf_fragment>
  // The glow texture is a white radial gradient used ONLY as a soft-edge
  // ALPHA mask. Its RGB samples as ~0 in the composed scene (canvas-texture
  // colour-management quirk; real-hardware verified — commit 2e04555), so
  // multiplying the tint by tex.rgb drove it to black and the lights were
  // invisible. Take the colour from the per-point aColor attribute (varying
  // vColor) and the falloff from the texture alpha only.
  float mask = texture2D(uTex, gl_PointCoord).a;
  gl_FragColor = vec4(vColor, mask * uOpacity * vFade);
}
`;

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
  // Geometry is empty until data/cityLightPoints.json resolves (async fetch,
  // same pattern the old airports fill used) — drawRange 0 until then.
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
  geo.setAttribute("aSize",    new THREE.BufferAttribute(new Float32Array(0), 1));
  geo.setAttribute("aColor",   new THREE.BufferAttribute(new Float32Array(0), 3));
  geo.setDrawRange(0, 0);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTex:        { value: _glowTex },
      uOpacity:    { value: 0 },
      uPixelRatio: { value: (renderer && renderer.getPixelRatio) ? renderer.getPixelRatio() : 1 },
    },
    vertexShader:   _vertexShader,
    fragmentShader: _fragmentShader,
    transparent:    true,
    depthWrite:     false,
    // Additive glow markers must NOT depth-test: the points sit ~30 m above
    // terrain whose detail tiles carry a polygonOffset -2 depth bias that
    // wins the comparison, so depth-testing makes the lights vanish entirely
    // in the composed scene (real-hardware verified — the prior logdepthbuf
    // fix treated the wrong cause). Standard treatment for additive light
    // sources (sun disc, UFO glow) is depthTest off.
    depthTest:      false,
    blending:       THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.name      = "city-lights";
  points.visible   = false;
  points.renderOrder = 10;
  // Country-spanning static cloud: culling can only ever skip the single
  // draw call when no light is on screen, but thousands of scattered points
  // spanning the whole country make the auto boundingSphere unreliable —
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

  // Entries for relift: { lat, lon, bufIdx } for every point (city + airport)
  // — same shape/loop the old code used for its much shorter list.
  const _entries = [];
  let _pointCount = 0;

  // ---------------------------------------------------------------------------
  // Async fill — fetch the generated JSON once, build the full buffer, then
  // grow drawRange; never rebuilt per frame or per toggle.
  // ---------------------------------------------------------------------------
  fetch("./data/cityLightPoints.json")
    .then(r => r.json())
    .then(data => {
      const cities   = Array.isArray(data.cities)   ? data.cities   : [];
      const airports = Array.isArray(data.airports) ? data.airports : [];

      let total = 0;
      for (const c of cities) total += (c.points || []).length;
      total += airports.length;

      const positions = new Float32Array(total * 3);
      const sizes     = new Float32Array(total);
      const colors    = new Float32Array(total * 3);

      let idx = 0;
      for (const city of cities) {
        for (const p of city.points || []) {
          const w    = geoToWorld(p.lat, p.lon);
          const elev = elevationAt(p.lat, p.lon);   // 0 before terrain loads
          const base = idx * 3;
          positions[base]     = w.x;
          positions[base + 1] = elev + 30;
          positions[base + 2] = w.z;
          sizes[idx] = p.size;
          colors[base]     = p.r;
          colors[base + 1] = p.g;
          colors[base + 2] = p.b;
          _entries.push({ lat: p.lat, lon: p.lon, bufIdx: idx });
          idx++;
        }
      }
      for (const ap of airports) {
        const w    = geoToWorld(ap.lat, ap.lon);
        const elev = elevationAt(ap.lat, ap.lon);
        const base = idx * 3;
        positions[base]     = w.x;
        positions[base + 1] = elev + 30;
        positions[base + 2] = w.z;
        sizes[idx] = ap.size;
        colors[base]     = ap.r;
        colors[base + 1] = ap.g;
        colors[base + 2] = ap.b;
        _entries.push({ lat: ap.lat, lon: ap.lon, bufIdx: idx });
        idx++;
      }

      _pointCount = idx;
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geo.setAttribute("aSize",    new THREE.BufferAttribute(sizes,     1));
      geo.setAttribute("aColor",   new THREE.BufferAttribute(colors,    3));
      geo.setDrawRange(0, _pointCount);
    })
    .catch(err => console.warn("[cityLights] cityLightPoints fetch failed:", err));

  // ---------------------------------------------------------------------------
  // reliftToTerrain — called from main.js loadTerrain().then() alongside
  // cityBeacons.reliftToTerrain() and airportBeacons?.reliftToTerrain().
  // ---------------------------------------------------------------------------
  function reliftToTerrain() {
    if (_pointCount === 0) return;   // JSON not resolved yet — nothing to lift
    const posAttr = geo.attributes.position;
    for (const e of _entries) {
      posAttr.array[e.bufIdx * 3 + 1] = elevationAt(e.lat, e.lon) + 30;
    }
    posAttr.needsUpdate = true;
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
  // No allocation: only writes scalar uniform/visibility properties.
  // ---------------------------------------------------------------------------
  function update() {
    const factor = daynight.getNightFactor();
    points.visible = _enabled && factor > 0.05;
    mat.uniforms.uOpacity.value = _enabled ? factor * 0.9 : 0;
    if (renderer && renderer.getPixelRatio) {
      mat.uniforms.uPixelRatio.value = renderer.getPixelRatio();
    }
  }

  return { group, points, update, setEnabled, reliftToTerrain };
}
