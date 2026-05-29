// provinces.js — Thailand province boundary LineSegments overlay (P2.T6).
//
// Loads data/provinces.geojson (Thai provinces, GeoJSON FeatureCollection
// from apisit/thailand.json — MIT, OSM-derived), walks every Polygon ring,
// and renders the boundaries as a single LineSegments object in muted gold.
// Sits at y=1 just above the basemap so it never z-fights but reads as
// part of the ground.
import * as THREE from "three";
import { geoToWorld } from "./coords.js";

const PROVINCES_URL = "data/provinces.geojson";
const LINE_COLOR = 0xc8a050;   // muted gold (playbook spec)
const LINE_OPACITY = 0.55;     // P4.T2: stronger province boundaries (was 0.35)
const LINE_Y = 1;

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
    segments.push(w1.x, LINE_Y, w1.z, w2.x, LINE_Y, w2.z);
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

  return { group, featureCount, segmentCount: segments.length / 6 };
}
