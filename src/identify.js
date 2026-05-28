// identify.js — center-screen ray pick for airspace volumes.
import * as THREE from "three";

const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();

const _EPS = 1e-6;

/** Ray-casting point-in-polygon over a ring of {x, z} world points. */
function _pointInPolygon(px, pz, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x, zi = ring[i].z;
    const xj = ring[j].x, zj = ring[j].z;
    const crosses = zi > pz !== zj > pz;
    if (crosses && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** 2-D segment-segment intersection test (AB vs CD) via orientation signs. */
function _segmentsIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
  const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  const d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx);
  const d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) return true;
  // Collinear / touching cases.
  if (Math.abs(d1) <= _EPS && _onSegment(cx, cz, dx, dz, ax, az)) return true;
  if (Math.abs(d2) <= _EPS && _onSegment(cx, cz, dx, dz, bx, bz)) return true;
  if (Math.abs(d3) <= _EPS && _onSegment(ax, az, bx, bz, cx, cz)) return true;
  if (Math.abs(d4) <= _EPS && _onSegment(ax, az, bx, bz, dx, dz)) return true;
  return false;
}

/** Is point (px,pz) within the bounding box of segment (sx,sz)-(ex,ez)? */
function _onSegment(sx, sz, ex, ez, px, pz) {
  return (
    px >= Math.min(sx, ex) - _EPS &&
    px <= Math.max(sx, ex) + _EPS &&
    pz >= Math.min(sz, ez) - _EPS &&
    pz <= Math.max(sz, ez) + _EPS
  );
}

/**
 * Collect airspace ids whose prism volume the view center ray intersects.
 * Exact analytical ray-vs-prism test — no fixed-step marching, so thin
 * altitude slices / narrow volumes can't be stepped over.
 * `step` retained for caller back-compat; now ignored.
 */
export function pickAirspacesAlongRay(camera, layer, maxDist = 400_000, step = 800) {
  camera.getWorldPosition(_origin);
  camera.getWorldDirection(_dir);
  const ox = _origin.x, oy = _origin.y, oz = _origin.z;
  const dx = _dir.x, dy = _dir.y, dz = _dir.z;
  const hitIds = new Set();

  for (const c of layer.compiled) {
    if (layer._isActive) {
      if (!layer._isActive(c)) continue;
    } else if (c.military && !layer.showMilitary) {
      continue;
    }

    // 1. Altitude band → parametric t-interval.
    let tLoY, tHiY;
    if (Math.abs(dy) < _EPS) {
      if (oy < c.lower || oy > c.upper) continue; // never in band
      tLoY = 0;
      tHiY = Infinity;
    } else {
      const t1 = (c.lower - oy) / dy;
      const t2 = (c.upper - oy) / dy;
      tLoY = Math.min(t1, t2);
      tHiY = Math.max(t1, t2);
    }

    // 2. Clip to valid ray range.
    const tLo = Math.max(tLoY, 0);
    const tHi = Math.min(tHiY, maxDist);
    if (tLo > tHi) continue;

    // 3. Horizontal projection segment within the in-band interval.
    const ax = ox + dx * tLo, az = oz + dz * tLo;
    const bx = ox + dx * tHi, bz = oz + dz * tHi;
    const ring = c.ring;

    const segLenSq = (bx - ax) * (bx - ax) + (bz - az) * (bz - az);
    if (segLenSq < _EPS) {
      // 4. Degenerate near-vertical ray: test point only.
      if (_pointInPolygon(ax, az, ring)) hitIds.add(c.airspace.id);
      continue;
    }

    let hit = _pointInPolygon(ax, az, ring) || _pointInPolygon(bx, bz, ring);
    if (!hit) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        if (_segmentsIntersect(ax, az, bx, bz, ring[j].x, ring[j].z, ring[i].x, ring[i].z)) {
          hit = true;
          break;
        }
      }
    }
    if (hit) hitIds.add(c.airspace.id);
  }
  return hitIds;
}

/**
 * Offset label sprites in screen space so they don't overlap.
 * Mutates sprite positions from base positions stored in userData.
 */
export function layoutIdentifyLabels(camera, sprites, renderer) {
  if (sprites.length === 0) return;
  const w = renderer.domElement.clientWidth;
  const h = renderer.domElement.clientHeight;
  const placed = [];

  const sorted = [...sprites].sort((a, b) => {
    const da = a.position.distanceToSquared(camera.position);
    const db = b.position.distanceToSquared(camera.position);
    return da - db;
  });

  for (const sp of sorted) {
    const base = sp.userData._basePos;
    if (!base) continue;
    sp.position.copy(base);
    const ndc = sp.position.clone().project(camera);
    let sx = (ndc.x * 0.5 + 0.5) * w;
    let sy = (-ndc.y * 0.5 + 0.5) * h;
    const labelH = 48;
    const labelW = 140;
    for (const p of placed) {
      if (Math.abs(sx - p.x) < labelW && Math.abs(sy - p.y) < labelH) {
        sy = p.y - labelH;
      }
    }
    placed.push({ x: sx, y: sy });
    const ndcY = -((sy / h) * 2 - 1);
    const ndcX = (sx / w) * 2 - 1;
    const target = new THREE.Vector3(ndcX, ndcY, ndc.z);
    target.unproject(camera);
    const dir = target.sub(camera.position).normalize();
    const dist = base.distanceTo(camera.position);
    sp.position.copy(camera.position).add(dir.multiplyScalar(dist));
    sp.position.y = Math.max(sp.position.y, base.y);
  }
}
