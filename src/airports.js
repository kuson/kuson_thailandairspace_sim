// airports.js — major-airport beacons (Betterment-6 §14.1).
//
// Ported from cities.js installCityBeacons: a marker + glowing halo + a
// camera-distance-scaled text label per airfield, loaded from
// data/airports.json. Deliberately distinct from city beacons — a diamond
// marker, an aviation-blue halo, and a two-line "✈ ICAO·IATA / name" label —
// so airports read as airports at a glance. This is the single biggest
// "where am I" cue in the 3D view: there were no airport markers before.
import * as THREE from "three";
import { geoToWorld } from "./coords.js";

// Two-line label: bold "✈ ICAO·IATA" headline + lighter airport name.
function _airportLabelSprite(icao, iata, name) {
  const fs1 = 21, fs2 = 16;
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  const head = `✈ ${icao}·${iata}`;
  ctx.font = `700 ${fs1}px ui-monospace, monospace`;
  const w1 = ctx.measureText(head).width;
  ctx.font = `500 ${fs2}px ui-monospace, monospace`;
  const w2 = ctx.measureText(name).width;
  const padX = 18, padY = 8, lineGap = 3;
  const w = Math.max(180, Math.ceil(Math.max(w1, w2)) + padX * 2);
  const h = padY * 2 + fs1 + lineGap + fs2;
  c.width = w; c.height = h;

  // Soft dark pill with a faint aviation-blue border (distinguishes from cities).
  const r = 12;
  ctx.fillStyle = "rgba(8, 16, 26, 0.80)";
  ctx.beginPath();
  ctx.moveTo(r, 0); ctx.lineTo(w - r, 0); ctx.quadraticCurveTo(w, 0, w, r);
  ctx.lineTo(w, h - r); ctx.quadraticCurveTo(w, h, w - r, h);
  ctx.lineTo(r, h); ctx.quadraticCurveTo(0, h, 0, h - r);
  ctx.lineTo(0, r); ctx.quadraticCurveTo(0, 0, r, 0); ctx.fill();
  ctx.strokeStyle = "rgba(79, 195, 255, 0.5)"; ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#dff1ff";
  ctx.font = `700 ${fs1}px ui-monospace, monospace`;
  ctx.fillText(head, w / 2, padY + fs1 / 2);
  ctx.fillStyle = "#a9c7dd";
  ctx.font = `500 ${fs2}px ui-monospace, monospace`;
  ctx.fillText(name, w / 2, padY + fs1 + lineGap + fs2 / 2);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false,
  }));
  const baseScale = 8;
  sp.userData.canvasW = w;
  sp.userData.canvasH = h;
  sp.userData.baseScale = baseScale;
  sp.scale.set(w * baseScale, h * baseScale, 1);
  return sp;
}

// Diamond marker (octahedron) — distinct from the city sphere dot.
function _airportMarker(color = 0xbfe6ff) {
  return new THREE.Mesh(
    new THREE.OctahedronGeometry(120, 0),
    new THREE.MeshBasicMaterial({ color, fog: false }),
  );
}

let _haloTex = null;
function _haloTexture() {
  if (_haloTex) return _haloTex;
  const size = 128;
  const cvs = document.createElement("canvas");
  cvs.width = size; cvs.height = size;
  const ctx = cvs.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, "rgba(255,255,255,0.9)");
  g.addColorStop(0.3, "rgba(255,255,255,0.35)");
  g.addColorStop(1.0, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  _haloTex = new THREE.CanvasTexture(cvs);
  _haloTex.colorSpace = THREE.SRGBColorSpace;
  return _haloTex;
}

// Aviation-blue halo for every airport (vs the prominence-tinted city halos).
function _airportHalo() {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: _haloTexture(), color: 0x4fc3ff,
    transparent: true, depthTest: false, depthWrite: false, fog: false, opacity: 0.8,
  }));
  sp.renderOrder = -1;
  return sp;
}

/**
 * Install major-airport beacons into the scene (async — fetches the dataset).
 *
 * @param {THREE.Scene} scene
 * @param {object} [opts]
 * @param {string} [opts.url="./data/airports.json"]
 * @param {number} [opts.y=200] — world-Y for the marker
 * @param {number} [opts.topN] — limit visible labels by prominence × distance
 * @returns {Promise<{ group: THREE.Group, updateScales: (camera, renderer) => void }>}
 */
export async function installAirportBeacons(scene, { url = "./data/airports.json", y = 200, topN = null } = {}) {
  const group = new THREE.Group();
  group.name = "airport-beacons";
  const entries = [];
  let airports = [];
  try {
    const res = await fetch(url);
    const data = await res.json();
    airports = data.airports || [];
  } catch (err) {
    console.warn("[airports] dataset load failed:", err);
  }
  for (const ap of airports) {
    const w = geoToWorld(ap.lat, ap.lon);
    const marker = _airportMarker();
    marker.position.set(w.x, y - 80, w.z);
    const halo = _airportHalo();
    halo.position.set(w.x, y - 80, w.z);
    const label = _airportLabelSprite(ap.icao, ap.iata, ap.name);
    // Sit higher than city labels (y+320) so the two label layers don't collide.
    label.position.set(w.x, y + 520, w.z);
    group.add(halo); group.add(marker); group.add(label);
    entries.push({ ap, marker, halo, label });
  }
  scene.add(group);

  // Same camera-distance scaling + prominence fade as the city beacons.
  function updateScales(camera, renderer) {
    if (!group.visible || entries.length === 0) return;
    const camPos = camera.position;
    const hPx = renderer.domElement.clientHeight || 720;
    const vFov = (camera.fov * Math.PI) / 180;
    let ranked = entries;
    if (topN != null) {
      ranked = entries
        .map((e) => ({ e, weight: e.ap.prominence * 1_000_000 - e.label.position.distanceTo(camPos) }))
        .sort((a, b) => b.weight - a.weight)
        .slice(0, topN)
        .map((x) => x.e);
      const keep = new Set(ranked);
      for (const e of entries) {
        const vis = keep.has(e);
        e.marker.visible = vis; e.label.visible = vis; e.halo.visible = vis;
      }
    }
    for (const e of ranked) {
      const cw = e.label.userData.canvasW;
      const ch = e.label.userData.canvasH;
      const base = e.label.userData.baseScale;
      const dist = Math.max(e.label.position.distanceTo(camPos), 800);
      const worldPerPx = (2 * Math.tan(vFov / 2) * dist) / hPx;
      const targetPx = 16 + 4 * e.ap.prominence;   // slightly larger than cities
      const s = (targetPx * worldPerPx) / ch;
      const clamped = THREE.MathUtils.clamp(s, base * 0.35, base * 1.6);
      e.label.scale.set(cw * clamped, ch * clamped, 1);
      const r = Math.max(80, targetPx * worldPerPx * 4) * 1.2;
      e.marker.scale.setScalar(r / 120);            // octahedron radius 120
      e.halo.scale.setScalar(r * 3.5);
      const fadeStart = [0, 250_000, 400_000, Infinity][e.ap.prominence] ?? Infinity;
      const fadeEnd = fadeStart + 80_000;
      const alpha = dist <= fadeStart ? 1
                   : dist >= fadeEnd ? 0
                   : 1 - (dist - fadeStart) / (fadeEnd - fadeStart);
      e.label.material.opacity = alpha;
      e.marker.material.opacity = alpha;
      e.marker.material.transparent = alpha < 1;
      e.halo.material.opacity = 0.8 * alpha;
    }
  }

  return { group, updateScales };
}
