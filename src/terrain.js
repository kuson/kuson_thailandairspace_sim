// terrain.js — AGL terrain lookup backed by data/terrain.bin (P4.T4).
//
// The binary is a row-major little-endian Uint16 grid of metres above
// MSL, sampled on a 30 arc-sec lat/lon mesh over Thailand. Layout is
// documented in data/terrain.json and the bake script
// scripts/bake_terrain.py.
//
// Module exports:
//   loadTerrain(binUrl, jsonUrl) — fetches grid + metadata; awaits before
//     elevationAt / AGL produce non-zero results. Idempotent.
//   elevationAt(lat, lon)        — metres MSL, bilinearly sampled.
//                                  Out-of-coverage returns 0 (gulf / sea).
//   AGL(position)                — metres above ground for a world-space
//                                  point. Until loadTerrain resolves,
//                                  AGL falls back to position.y so the
//                                  rest of the sim doesn't choke.
//   isLoaded()                   — true once the bin is parsed.

import { worldToGeo } from "./coords.js";

let _grid = null;            // Uint16Array (rows × cols, row-major)
let _meta = null;            // metadata copy
let _loadPromise = null;

export function isLoaded() {
  return _grid != null;
}

export async function loadTerrain(binUrl = "./data/terrain.bin",
                                  jsonUrl = "./data/terrain.json") {
  if (_loadPromise) return _loadPromise;
  _loadPromise = (async () => {
    const [binRes, jsonRes] = await Promise.all([
      fetch(binUrl),
      fetch(jsonUrl),
    ]);
    if (!binRes.ok) throw new Error(`terrain.bin: HTTP ${binRes.status}`);
    if (!jsonRes.ok) throw new Error(`terrain.json: HTTP ${jsonRes.status}`);
    const meta = await jsonRes.json();
    const arr  = await binRes.arrayBuffer();
    const expected = meta.rows * meta.cols * 2;
    if (arr.byteLength !== expected) {
      throw new Error(
        `terrain.bin size mismatch: got ${arr.byteLength}, expected ${expected}`
      );
    }
    _grid = new Uint16Array(arr);
    _meta = meta;
    return meta;
  })();
  return _loadPromise;
}

/**
 * Bilinearly sample the elevation grid at (lat, lon). Returns 0 for any
 * point outside the baked coverage box — keeps the AGL chip honest over
 * sea (where ground == 0 = sea level).
 */
export function elevationAt(lat, lon) {
  if (!_grid) return 0;
  const { rows, cols, lat0, lon0, dLat, dLon } = _meta;
  const fy = (lat - lat0) / dLat;
  const fx = (lon - lon0) / dLon;
  if (fy < 0 || fx < 0 || fy > rows - 1 || fx > cols - 1) return 0;
  const y0 = Math.floor(fy);
  const x0 = Math.floor(fx);
  const y1 = Math.min(y0 + 1, rows - 1);
  const x1 = Math.min(x0 + 1, cols - 1);
  const ty = fy - y0;
  const tx = fx - x0;
  const e00 = _grid[y0 * cols + x0];
  const e10 = _grid[y0 * cols + x1];
  const e01 = _grid[y1 * cols + x0];
  const e11 = _grid[y1 * cols + x1];
  return (e00 * (1 - tx) + e10 * tx) * (1 - ty) +
         (e01 * (1 - tx) + e11 * tx) * ty;
}

/**
 * Metres above ground for a world-space {x, y, z}. Until loadTerrain
 * resolves, returns position.y so the geofence ceiling falls back to
 * AMSL — the same behaviour the sim had before P4.T4.
 */
export function AGL(position) {
  if (!_grid) return position.y;
  const { lat, lon } = worldToGeo(position.x, position.z);
  return position.y - elevationAt(lat, lon);
}

/** Test seam: reset module state. Production code never calls this. */
export function _reset() {
  _grid = null;
  _meta = null;
  _loadPromise = null;
}
