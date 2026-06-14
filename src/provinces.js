// provinces.js — Thailand province boundary LineSegments overlay (P2.T6).
//
// Loads data/provinces.geojson (Thai provinces, GeoJSON FeatureCollection
// from apisit/thailand.json — MIT, OSM-derived), walks every Polygon ring,
// and renders the boundaries as a single LineSegments object in muted gold.
// Sits at y=1 just above the basemap so it never z-fights but reads as
// part of the ground.
import * as THREE from "three";
import { geoToWorld, worldToGeo } from "./coords.js";
import { elevationAt } from "./terrain.js";

const PROVINCES_URL = "data/provinces.geojson";
const LINE_COLOR = 0xf0c040;   // vivid amber-gold (Betterment-3: pops on Voyager, was muted 0xc8a050)
const LINE_OPACITY = 0.7;      // higher-contrast province boundaries (was 0.55)
// B10 fixup: lift boundary lines onto the terrain (elevationAt + this offset)
// so they don't bury under northern relief. The offset clears the displaced
// detail tiles (meshY 0.4 + polygonOffset) and small inter-vertex dips on
// slopes; was a flat LINE_Y = 1 over the pre-relief ground.
const LINE_Y = 12;
const LABEL_Y = 60;            // province names sit low, beneath city/airport labels
const PROV_TOPN = 16;          // nearest-N province names shown (declutter)

// Approx centroid (mean of the outer-ring vertices) for name placement.
function _featureCentroid(g) {
  let ring = null;
  if (g.type === "Polygon") ring = g.coordinates[0];
  else if (g.type === "MultiPolygon") {
    for (const poly of g.coordinates) {
      if (!ring || poly[0].length > ring.length) ring = poly[0];   // largest outer ring
    }
  }
  if (!ring || !ring.length) return null;
  let lon = 0, lat = 0;
  for (const p of ring) { lon += p[0]; lat += p[1]; }
  return { lon: lon / ring.length, lat: lat / ring.length };
}

// Subtle map-style name: muted gold text with a dark shadow, no pill/border —
// distinct from cyan airspace labels and white city labels, and quieter than both.
function _provinceLabelSprite(name) {
  const fs = 20;
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  ctx.font = `600 ${fs}px ui-monospace, monospace`;
  const w = Math.ceil(ctx.measureText(name).width) + 18;
  const h = fs + 14;
  c.width = w; c.height = h;
  ctx.font = `600 ${fs}px ui-monospace, monospace`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.85)"; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1;
  ctx.fillStyle = "#f0d28a";
  ctx.fillText(name, w / 2, h / 2 + 1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false, opacity: 0.7,
  }));
  sp.userData.canvasW = w; sp.userData.canvasH = h;
  sp.renderOrder = 10;                            // beneath city/airport labels (9999)
  sp.scale.set(w * 8, h * 8, 1);
  return sp;
}

function _ringToSegments(ring, segments) {
  // Each ring is an array of [lon, lat] pairs; the last point equals the first.
  // Push consecutive pairs as line segments. Decimate by 2 (keep every other
  // vertex) — the source data has ~5 m precision which is overkill for an
  // overlay that's visible from FL250+.
  const STRIDE = 2;
  for (let i = 0; i < ring.length - STRIDE; i += STRIDE) {
    const a = ring[i];
    const b = ring[Math.min(i + STRIDE, ring.length - 1)];
    const w1 = geoToWorld(a[1], a[0]);
    const w2 = geoToWorld(b[1], b[0]);
    // B10 fixup: per-vertex terrain lift (elevationAt returns 0 before the
    // grid loads → flat; reliftToTerrain re-applies once it resolves).
    const y1 = elevationAt(a[1], a[0]) + LINE_Y;
    const y2 = elevationAt(b[1], b[0]) + LINE_Y;
    segments.push(w1.x, y1, w1.z, w2.x, y2, w2.z);
  }
}

/**
 * Fetch the provinces geojson and add LineSegments to the scene.
 *
 * @param {THREE.Scene} scene
 * @returns {Promise<{ group: THREE.Group, featureCount: number, segmentCount: number }>}
 */
export async function installProvinceLines(scene) {
  const group = new THREE.Group();
  group.name = "province-lines";
  scene.add(group);

  let geo;
  try {
    const r = await fetch(PROVINCES_URL);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    geo = await r.json();
  } catch (err) {
    console.warn("[provinces] failed to load", PROVINCES_URL, err);
    return { group, featureCount: 0, segmentCount: 0 };
  }

  const segments = [];   // flat array of [x, y, z, x, y, z, ...] pairs
  const labelData = [];  // { name, lat, lon } per feature
  let featureCount = 0;
  for (const feature of geo.features ?? []) {
    const g = feature.geometry;
    if (!g) continue;
    if (g.type === "Polygon") {
      for (const ring of g.coordinates) _ringToSegments(ring, segments);
    } else if (g.type === "MultiPolygon") {
      for (const poly of g.coordinates) {
        for (const ring of poly) _ringToSegments(ring, segments);
      }
    }
    const name = feature.properties?.name;
    const cen = _featureCentroid(g);
    if (name && cen) labelData.push({ name, lat: cen.lat, lon: cen.lon });
    featureCount++;
  }

  const positions = new Float32Array(segments);
  const bufGeo = new THREE.BufferGeometry();
  bufGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({
    color: LINE_COLOR,
    transparent: true,
    opacity: LINE_OPACITY,
    fog: true,
  });
  const lines = new THREE.LineSegments(bufGeo, mat);
  lines.name = "province-line-segments";
  group.add(lines);

  // Province name labels at centroids (Betterment-6 §14.3). Same group as the
  // lines, so one visibility toggle governs both.
  const labelEntries = [];
  for (const ld of labelData) {
    const w = geoToWorld(ld.lat, ld.lon);
    const sp = _provinceLabelSprite(ld.name);
    sp.position.set(w.x, elevationAt(ld.lat, ld.lon) + LABEL_Y, w.z);
    sp.userData.lat = ld.lat; sp.userData.lon = ld.lon;   // for reliftToTerrain
    group.add(sp);
    labelEntries.push(sp);
  }

  // Keep names ~constant on-screen size; show only the nearest PROV_TOPN and
  // fade them past ~250 km so the country doesn't read as a wall of gold text.
  function updateScales(camera, renderer) {
    if (!group.visible || labelEntries.length === 0) return;
    const camPos = camera.position;
    const hPx = renderer.domElement.clientHeight || 720;
    const vFov = (camera.fov * Math.PI) / 180;
    const ranked = labelEntries
      .map((s) => ({ s, d: s.position.distanceTo(camPos) }))
      .sort((a, b) => a.d - b.d);
    for (let i = 0; i < ranked.length; i++) {
      const { s, d } = ranked[i];
      if (i >= PROV_TOPN) { s.visible = false; continue; }
      s.visible = true;
      const dist = Math.max(d, 800);
      const worldPerPx = (2 * Math.tan(vFov / 2) * dist) / hPx;
      const cw = s.userData.canvasW, ch = s.userData.canvasH;
      const sc = (15 * worldPerPx) / ch;
      s.scale.set(cw * sc, ch * sc, 1);
      const alpha = dist <= 250_000 ? 0.7 : dist >= 330_000 ? 0 : 0.7 * (1 - (dist - 250_000) / 80_000);
      s.material.opacity = alpha;
    }
  }

  // B10 fixup: re-apply the terrain lift after data/terrain.bin resolves
  // (provinces install before the grid, so the build-time elevationAt read 0).
  // Called once from main.js loadTerrain().then(), beside the beacon relifts.
  function reliftToTerrain() {
    const pos = bufGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const g = worldToGeo(pos.getX(i), pos.getZ(i));
      pos.setY(i, elevationAt(g.lat, g.lon) + LINE_Y);
    }
    pos.needsUpdate = true;
    bufGeo.computeBoundingSphere();   // y range changed → keep frustum cull honest
    for (const sp of labelEntries) {
      sp.position.y = elevationAt(sp.userData.lat, sp.userData.lon) + LABEL_Y;
    }
  }

  return { group, updateScales, reliftToTerrain, featureCount, segmentCount: segments.length / 6 };
}
