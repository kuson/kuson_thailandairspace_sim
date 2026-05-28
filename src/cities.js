// cities.js — Thai city beacon sprites (Phase 2 P2.T5).
//
// Drops ~30 major Thai cities into the scene as small text sprites with a
// dim dot underneath. Helps orient the user at altitude where the basemap
// labels alone aren't enough to pick out specific cities. Sprites scale to
// stay roughly readable across the full altitude range used by the sim.
import * as THREE from "three";
import { geoToWorld } from "./coords.js";

/**
 * Major Thai cities. `prominence` is a 1–3 weight used by the top-N
 * filter so a saturated map doesn't drown the user — Bangkok at 3 always
 * shows, smaller provincial centres at 1 fade out first.
 */
export const THAI_CITIES = [
  { name: "Bangkok",            lat: 13.7563, lon: 100.5018, prominence: 3 },
  { name: "Chiang Mai",         lat: 18.7883, lon:  98.9853, prominence: 3 },
  { name: "Phuket",             lat:  7.8804, lon:  98.3923, prominence: 3 },
  { name: "Hat Yai",            lat:  7.0086, lon: 100.4747, prominence: 2 },
  { name: "Pattaya",            lat: 12.9236, lon: 100.8825, prominence: 2 },
  { name: "Khon Kaen",          lat: 16.4322, lon: 102.8236, prominence: 2 },
  { name: "Nakhon Ratchasima",  lat: 14.9799, lon: 102.0978, prominence: 2 },
  { name: "Udon Thani",         lat: 17.4138, lon: 102.7873, prominence: 2 },
  { name: "Chiang Rai",         lat: 19.9105, lon:  99.8406, prominence: 2 },
  { name: "Hua Hin",            lat: 12.5684, lon:  99.9577, prominence: 2 },
  { name: "Surat Thani",        lat:  9.1382, lon:  99.3217, prominence: 2 },
  { name: "Krabi",              lat:  8.0863, lon:  98.9063, prominence: 2 },
  { name: "Ubon Ratchathani",   lat: 15.2448, lon: 104.8473, prominence: 2 },
  { name: "Songkhla",           lat:  7.1986, lon: 100.5959, prominence: 2 },
  { name: "Ayutthaya",          lat: 14.3692, lon: 100.5877, prominence: 2 },
  { name: "U-Tapao",            lat: 12.6800, lon: 101.0050, prominence: 1 },
  { name: "Sukhothai",          lat: 17.0072, lon:  99.8231, prominence: 1 },
  { name: "Trat",               lat: 12.2436, lon: 102.5151, prominence: 1 },
  { name: "Nong Khai",          lat: 17.8783, lon: 102.7417, prominence: 1 },
  { name: "Lampang",            lat: 18.2783, lon:  99.4869, prominence: 1 },
  { name: "Mae Hong Son",       lat: 19.3019, lon:  97.9694, prominence: 1 },
  { name: "Phitsanulok",        lat: 16.8211, lon: 100.2659, prominence: 1 },
  { name: "Ranong",             lat:  9.9619, lon:  98.6386, prominence: 1 },
  { name: "Nakhon Si Thammarat",lat:  8.4304, lon:  99.9633, prominence: 1 },
  { name: "Loei",               lat: 17.4860, lon: 101.7224, prominence: 1 },
  { name: "Sakon Nakhon",       lat: 17.1545, lon: 104.1348, prominence: 1 },
  { name: "Buriram",            lat: 14.9930, lon: 103.1029, prominence: 1 },
  { name: "Roi Et",             lat: 16.0540, lon: 103.6520, prominence: 1 },
  { name: "Phetchaburi",        lat: 13.1119, lon:  99.9407, prominence: 1 },
  { name: "Tak",                lat: 16.8839, lon:  99.1258, prominence: 1 },
];

// Smaller, plainer text sprite than airspace labels — no cyan border, no
// heavy backplate. Renders city name in white on a soft dark pill.
function _cityLabelSprite(name, fontSize = 22) {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  ctx.font = `600 ${fontSize}px ui-monospace, monospace`;
  const metrics = ctx.measureText(name);
  const padX = 18, padY = 8;
  const w = Math.max(160, Math.ceil(metrics.width) + padX * 2);
  const h = Math.ceil(fontSize * 1.6) + padY * 2;
  c.width = w; c.height = h;
  // Re-set font after canvas resize (resize clears context state).
  ctx.font = `600 ${fontSize}px ui-monospace, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Soft dark pill.
  const r = h / 2;
  ctx.fillStyle = "rgba(10, 14, 22, 0.78)";
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(w - r, 0);
  ctx.quadraticCurveTo(w, 0, w, r);
  ctx.lineTo(w, h - r);
  ctx.quadraticCurveTo(w, h, w - r, h);
  ctx.lineTo(r, h);
  ctx.quadraticCurveTo(0, h, 0, h - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.fill();
  ctx.fillStyle = "#f0f6ff";
  ctx.fillText(name, w / 2, h / 2 + 1);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  const sp = new THREE.Sprite(mat);
  const baseScale = 8;
  sp.userData.canvasW = w;
  sp.userData.canvasH = h;
  sp.userData.baseScale = baseScale;
  sp.scale.set(w * baseScale, h * baseScale, 1);
  return sp;
}

function _cityDot(color = 0xfff2c8) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(120, 12, 10),
    new THREE.MeshBasicMaterial({ color, fog: false }),
  );
  return m;
}

/**
 * Install Thai city beacons into the scene.
 *
 * @param {THREE.Scene} scene
 * @param {object} [opts]
 * @param {number} [opts.y=200] — world-Y for the dot + label
 * @param {number} [opts.topN] — limit visible labels by prominence × camera distance
 * @returns {{ group: THREE.Group, updateScales: (camera, renderer) => void }}
 */
export function installCityBeacons(scene, { y = 200, topN = null } = {}) {
  const group = new THREE.Group();
  group.name = "city-beacons";
  const entries = [];
  for (const city of THAI_CITIES) {
    const w = geoToWorld(city.lat, city.lon);
    const dot = _cityDot();
    dot.position.set(w.x, y - 80, w.z);
    const label = _cityLabelSprite(city.name);
    label.position.set(w.x, y + 320, w.z);
    group.add(dot); group.add(label);
    entries.push({ city, dot, label });
  }
  scene.add(group);

  // Camera-distance scaling. Each frame, rescale labels so they stay
  // ~24 px tall regardless of altitude/zoom. Also fade by prominence at long
  // range so the map doesn't read as a wall of labels at FL350.
  function updateScales(camera, renderer) {
    const camPos = camera.position;
    const hPx = renderer.domElement.clientHeight || 720;
    const vFov = (camera.fov * Math.PI) / 180;
    let ranked = entries;
    if (topN != null) {
      ranked = entries
        .map(e => ({ e, weight: e.city.prominence * 1_000_000 - e.label.position.distanceTo(camPos) }))
        .sort((a, b) => b.weight - a.weight)
        .slice(0, topN)
        .map(x => x.e);
      const keep = new Set(ranked);
      for (const e of entries) {
        const visible = keep.has(e);
        e.dot.visible = visible;
        e.label.visible = visible;
      }
    }
    for (const e of ranked) {
      const cw = e.label.userData.canvasW;
      const ch = e.label.userData.canvasH;
      const base = e.label.userData.baseScale;
      const dist = Math.max(e.label.position.distanceTo(camPos), 800);
      const worldPerPx = (2 * Math.tan(vFov / 2) * dist) / hPx;
      // Target on-screen text height: 18 px for prominence 1, 24 for 3.
      const targetPx = 14 + 4 * e.city.prominence;
      const s = (targetPx * worldPerPx) / ch;
      const minS = base * 0.35;
      const maxS = base * 1.6;
      const clamped = THREE.MathUtils.clamp(s, minS, maxS);
      e.label.scale.set(cw * clamped, ch * clamped, 1);
      // Dot size — roughly the line height of the label, but in world units.
      const dotR = Math.max(80, targetPx * worldPerPx * 4);
      e.dot.scale.setScalar(dotR / 120);  // sphere geom radius 120
      // Long-distance fade: prominence-1 cities fade out beyond 250 km, 2 at
      // 400 km, 3 (Bangkok/Chiang Mai/Phuket) never fade.
      const fadeStart = [0, 250_000, 400_000, Infinity][e.city.prominence] ?? Infinity;
      const fadeEnd = fadeStart + 80_000;
      const alpha = dist <= fadeStart ? 1
                   : dist >= fadeEnd  ? 0
                   : 1 - (dist - fadeStart) / (fadeEnd - fadeStart);
      e.label.material.opacity = alpha;
      e.dot.material.opacity = alpha;
      e.dot.material.transparent = alpha < 1;
    }
  }

  return { group, updateScales };
}
