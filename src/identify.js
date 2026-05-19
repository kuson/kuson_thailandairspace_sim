// identify.js — center-screen ray pick for airspace volumes.
import * as THREE from "three";

const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();

/** Collect airspace ids whose volume contains points along the view center ray. */
export function pickAirspacesAlongRay(camera, layer, maxDist = 400_000, step = 800) {
  camera.getWorldPosition(_origin);
  camera.getWorldDirection(_dir);
  const hitIds = new Set();
  for (let d = step; d < maxDist; d += step) {
    const x = _origin.x + _dir.x * d;
    const y = _origin.y + _dir.y * d;
    const z = _origin.z + _dir.z * d;
    for (const a of layer.airspacesAt(x, y, z)) {
      hitIds.add(a.id);
    }
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
