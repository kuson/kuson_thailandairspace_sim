// rangeRings.js — distance rings on the basemap (Betterment-6 §14.2).
//
// Concentric rings centred on the aircraft give the flat 3D view the sense of
// scale/distance the radar minimap has but the main view lacked. 50/100/200 km
// (metric) or 25/50/100 NM (aero units, matching the radar). Faint LineLoops
// just above the ground, re-centred on the drone each frame, with cyan
// distance labels reusing makeTextSprite.
import * as THREE from "three";
import { NM_TO_M, worldToGeo } from "./coords.js";
import { makeTextSprite } from "./airspace.js";
import { elevationAt } from "./terrain.js";

const RING_SEGMENTS = 96;
const RING_Y = 20;                               // just above tiles / province lines
const METRIC = [50_000, 100_000, 200_000];
const METRIC_LBL = ["50 km", "100 km", "200 km"];
const AERO = [25 * NM_TO_M, 50 * NM_TO_M, 100 * NM_TO_M];
const AERO_LBL = ["25 NM", "50 NM", "100 NM"];

function _unitRing() {
  const pts = [];
  for (let i = 0; i < RING_SEGMENTS; i++) {
    const t = (i / RING_SEGMENTS) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(t), 0, Math.sin(t)));   // unit circle in XZ
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({
    color: 0x66ffcc, transparent: true, opacity: 0.26, depthWrite: false,
  });
  return new THREE.LineLoop(geo, mat);
}

/**
 * Install range rings into the scene.
 * @param {THREE.Scene} scene
 * @returns {{ group: THREE.Group, update: (dronePos, camera, renderer, aero?) => void }}
 */
export function installRangeRings(scene) {
  const group = new THREE.Group();
  group.name = "range-rings";
  group.visible = false;                          // default off (opt-in)

  const rings = [_unitRing(), _unitRing(), _unitRing()];
  for (const r of rings) { r.position.y = RING_Y; group.add(r); }

  const mkLabels = (texts) => texts.map((t) => {
    const s = makeTextSprite(t, { fontSize: 22, maxWidth: 150, depthTest: false });
    group.add(s);
    return s;
  });
  const metricLabels = mkLabels(METRIC_LBL);
  const aeroLabels = mkLabels(AERO_LBL);
  scene.add(group);

  // B10.T3: terrain-lift state. Sampled ≤2 Hz (0.5 s accumulator).
  const ELEV_INTERVAL = 0.5;
  let _groundElev = 0;
  let _elevTimer   = ELEV_INTERVAL;   // fire immediately on first update

  function update(dronePos, camera, renderer, aero = false, dt = 0) {
    if (!group.visible) return;

    // Resample terrain under drone at ≤2 Hz; lift group so rings sit above hills.
    _elevTimer += dt;
    if (_elevTimer >= ELEV_INTERVAL) {
      _elevTimer = 0;
      const { lat, lon } = worldToGeo(dronePos.x, dronePos.z);
      _groundElev = elevationAt(lat, lon);
    }
    group.position.set(dronePos.x, _groundElev + 0.5, dronePos.z);     // follow the aircraft
    const radii = aero ? AERO : METRIC;
    for (let i = 0; i < 3; i++) rings[i].scale.set(radii[i], 1, radii[i]);

    const active = aero ? aeroLabels : metricLabels;
    for (const s of (aero ? metricLabels : aeroLabels)) s.visible = false;

    const hPx = renderer.domElement.clientHeight || 720;
    const vFov = (camera.fov * Math.PI) / 180;
    for (let i = 0; i < 3; i++) {
      const s = active[i];
      s.visible = true;
      s.position.set(0, RING_Y + 5, -radii[i]);        // north edge (local to group)
      // Keep labels ~16 px tall regardless of altitude.
      const worldPos = new THREE.Vector3(dronePos.x, _groundElev + 0.5 + RING_Y + 5, dronePos.z - radii[i]);
      const dist = Math.max(worldPos.distanceTo(camera.position), 800);
      const worldPerPx = (2 * Math.tan(vFov / 2) * dist) / hPx;
      const cw = s.userData.canvasW, ch = s.userData.canvasH;
      const sc = (16 * worldPerPx) / ch;
      s.scale.set(cw * sc, ch * sc, 1);
    }
  }

  return { group, update };
}
