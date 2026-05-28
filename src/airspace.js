// airspace.js — load airspaces.json, build 3D meshes, labels, highlight, queries.
import * as THREE from "three";
import { geoToWorld, FT_TO_M, NM_TO_M } from "./coords.js";

const CIRCLE_SEGMENTS = 64;

const COLOR_FOR = {
  CTR: 0xff3344,
  TMA: 0xff9933,
  "Class D": 0xffe14a,
  Prohibited: 0xff0000,
  Restricted: 0xa050ff,
  Danger: 0xff6a1f,
};

const OPACITY_FOR = {
  Prohibited: 0.38,
  Restricted: 0.28,
  default: 0.22,
};

// Identify-mode fill opacity. Kept low so multiple stacked identify hits
// are individually readable (the previous 0.52 made nested CTR/TMA hits
// merge into a single opaque mass).
const HIGHLIGHT_OPACITY = 0.18;

// P2.T7 — Shared wall materials. The wall geometry carries per-vertex
// colours (darker at floor → brighter at ceiling), so the material itself
// is white + vertexColors:true and gets shared across every airspace.
const WALL_OPACITY_NORMAL = 0.18;
const WALL_OPACITY_HIGHLIGHT = 0.42;
const WALL_MAT_NORMAL = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  vertexColors: true,
  transparent: true,
  opacity: WALL_OPACITY_NORMAL,
  side: THREE.DoubleSide,
  depthWrite: false,
  depthTest: true,
});
const WALL_MAT_HIGHLIGHT = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  vertexColors: true,
  transparent: true,
  opacity: WALL_OPACITY_HIGHLIGHT,
  side: THREE.DoubleSide,
  depthWrite: false,
  depthTest: true,
});

// P2.T7b — Outline material pool. Keyed by (color, baseOpacity, highlight),
// so e.g. every Class-D ring shares one normal + one highlight material.
const OUTLINE_MAT_POOL = new Map();
function outlineMatFor(color, baseOpacity, highlight) {
  const key = `${color}|${baseOpacity.toFixed(3)}|${highlight ? 1 : 0}`;
  const existing = OUTLINE_MAT_POOL.get(key);
  if (existing) return existing;
  const m = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: highlight ? 0.95 : Math.min(baseOpacity * 3.5, 0.92),
    depthTest: true,
    depthWrite: false,
  });
  OUTLINE_MAT_POOL.set(key, m);
  return m;
}

export const MILITARY_CTR_IDS = new Set([
  "KPS-CTR", "VTPI-CTR", "VTBC-CTR", "VTUR-KKZ", "VTBU-CTR",
]);

const MILITARY_KEYWORDS = [
  "RTAF", "RTN ", "ROYAL THAI NAVY", "ROYAL THAI NAVAL", "MILITARY",
  "JETTISON", "BOMBING", "AIR FIRING", "WEAPON TRAINING", "WING ",
  "NAVAL BASE", "SURFACE SHIP", "RTN AREA",
];

export function isMilitaryAirspace(a) {
  if (MILITARY_CTR_IDS.has(a.id)) return true;
  const text = `${a.name} ${a.description}`.toUpperCase();
  return MILITARY_KEYWORDS.some((k) => text.includes(k));
}

function categoryKeyFor(a) {
  if (a.category === "CTR" && a.class === "D") return "Class D";
  return a.category;
}

function colorFor(a) {
  return COLOR_FOR[categoryKeyFor(a)] ?? COLOR_FOR[a.category] ?? 0xffffff;
}

function opacityFor(a) {
  return OPACITY_FOR[a.category] ?? OPACITY_FOR.default;
}

function ringForAirspace(a) {
  if (a.shape === "circle") {
    const c = geoToWorld(a.center[0], a.center[1]);
    const r = a.radiusNM * NM_TO_M;
    const pts = [];
    for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
      const t = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
      pts.push({ x: c.x + Math.cos(t) * r, z: c.z + Math.sin(t) * r });
    }
    return pts;
  }
  if (a.shape === "polygon") {
    return a.points.map(([lat, lon]) => geoToWorld(lat, lon));
  }
  return [];
}

function ftToY(ft) {
  return ft * FT_TO_M;
}

function ringCentroid(ring) {
  let cx = 0, cz = 0;
  for (const p of ring) { cx += p.x; cz += p.z; }
  return { x: cx / ring.length, z: cz / ring.length };
}

function ringMaxRadius(ring, cx, cz) {
  let rmax = 0;
  for (const p of ring) {
    const d = Math.hypot(p.x - cx, p.z - cz);
    if (d > rmax) rmax = d;
  }
  return rmax;
}

export function makeTextSprite(text, { fontSize = 28, maxWidth = 512, depthTest = false } = {}) {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  const lines = text.split("\n");
  const lineH = fontSize * 1.25;
  const w = maxWidth;
  const h = lineH * lines.length + 8;
  c.width = w;
  c.height = h;
  ctx.font = `bold ${fontSize}px ui-monospace, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(8, 12, 20, 0.85)";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(102, 255, 204, 0.55)";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);
  ctx.fillStyle = "#ffffff";
  lines.forEach((line, i) => {
    ctx.fillText(line, w / 2, lineH * 0.5 + i * lineH);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  const baseScale = 10;
  sprite.userData.canvasW = w;
  sprite.userData.canvasH = h;
  sprite.userData.baseScale = baseScale;
  sprite.scale.set(w * baseScale, h * baseScale, 1);
  sprite.renderOrder = 9999;
  return sprite;
}

function buildVolumeMesh(ring, lower, upper, color, opacity) {
  const depth = Math.max(upper - lower, 1);

  // P2.T7b — outline materials come from the shared pool (one per
  // category × highlight-state). Mutating opacity is no longer safe;
  // setHighlighted swaps material references instead.
  const outlineMatNormal = outlineMatFor(color, opacity, false);
  const outlineMatHi = outlineMatFor(color, opacity, true);

  const closed = [...ring, ring[0]];
  const topPts = closed.map((p) => new THREE.Vector3(p.x, lower + depth, p.z));
  const botPts = closed.map((p) => new THREE.Vector3(p.x, lower, p.z));
  const topLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(topPts),
    outlineMatNormal
  );
  const botLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(botPts),
    outlineMatNormal
  );

  // P2.T7a — Continuous translucent wall replaces the 16-rib wireframe.
  // ExtrudeGeometry already projects each ring edge into a side quad; we
  // bake a vertical colour gradient into the position attribute so the
  // volume reads as a 3-D body, not a flat tint.
  const shape = new THREE.Shape(ring.map((p) => new THREE.Vector2(p.x, -p.z)));
  const wallGeo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 24,
  });
  wallGeo.rotateX(-Math.PI / 2);
  wallGeo.translate(0, lower, 0);

  const pos = wallGeo.attributes.position;
  const base = new THREE.Color(color);
  const FLOOR_SCALE = 0.35;
  const CEIL_SCALE = 1.0;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = THREE.MathUtils.clamp((y - lower) / depth, 0, 1);
    const k = FLOOR_SCALE + (CEIL_SCALE - FLOOR_SCALE) * t;
    colors[i * 3 + 0] = base.r * k;
    colors[i * 3 + 1] = base.g * k;
    colors[i * 3 + 2] = base.b * k;
  }
  wallGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const wallMesh = new THREE.Mesh(wallGeo, WALL_MAT_NORMAL);

  const group = new THREE.Group();
  group.add(wallMesh, topLine, botLine);
  group.userData.wallMesh = wallMesh;
  group.userData.topLine = topLine;
  group.userData.botLine = botLine;
  group.userData.outlineMatNormal = outlineMatNormal;
  group.userData.outlineMatHi = outlineMatHi;
  // Back-compat with anything that read .fillMesh / .outlineMat directly.
  group.userData.fillMesh = wallMesh;
  group.userData.outlineMat = outlineMatNormal;
  return group;
}

function pointInRing(px, pz, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x, zi = ring[i].z;
    const xj = ring[j].x, zj = ring[j].z;
    const intersect = ((zi > pz) !== (zj > pz)) &&
      (px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointToSegmentDistSq(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-6) {
    const ex = px - ax, ez = pz - az;
    return ex * ex + ez * ez;
  }
  let t = ((px - ax) * dx + (pz - az) * dz) / lenSq;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const cx = ax + t * dx, cz = az + t * dz;
  const ex = px - cx, ez = pz - cz;
  return ex * ex + ez * ez;
}

/**
 * 3-D distance from world point (px, py, pz) to the nearest point of the
 * given compiled airspace volume. Returns 0 if the point is inside the
 * volume. Combines horizontal (ring) distance with vertical (lower/upper)
 * clearance using a 3-D Pythagorean.
 */
export function nearestDistanceTo(px, py, pz, c) {
  const horizInside = pointInRing(px, pz, c.ring);
  let dH = 0;
  if (!horizInside) {
    let dSq = Infinity;
    const ring = c.ring;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j], b = ring[i];
      const s = pointToSegmentDistSq(px, pz, a.x, a.z, b.x, b.z);
      if (s < dSq) dSq = s;
    }
    dH = Math.sqrt(dSq);
  }
  let dV = 0;
  if (py < c.lower) dV = c.lower - py;
  else if (py > c.upper) dV = py - c.upper;
  return Math.hypot(dH, dV);
}

export class AirspaceLayer {
  constructor() {
    this.group = new THREE.Group();
    this.labelsGroup = new THREE.Group();
    this.identifyLabelsGroup = new THREE.Group();
    this.labelsGroup.visible = false;
    this.showHeights = true;
    this.showMilitary = true;
    this.airspaces = [];
    this.compiled = [];
    this._labelSprites = [];
    this._highlighted = new Set();
    this._identifySprites = new Map();
    // P2.T8 — id → compiled, for O(1) owner lookup during label declutter.
    this._compiledById = new Map();
  }

  async load(url) {
    const res = await fetch(url);
    const data = await res.json();
    this.meta = data.meta;
    for (const a of data.airspaces) {
      const ring = ringForAirspace(a);
      const lower = ftToY(a.lowerFt);
      const upper = ftToY(a.upperFt);
      const color = colorFor(a);
      const opacity = opacityFor(a);
      const mesh = buildVolumeMesh(ring, lower, upper, color, opacity);
      mesh.userData.airspace = a;
      this.group.add(mesh);

      const cen = ringCentroid(ring);
      const midY = (lower + upper) / 2;
      // P2.T8 — regular labels are depth-tested so foreground terrain /
      // closer volumes properly occlude them. Identify-mode sprites
      // intentionally stay depthTest:false (see _ensureIdentifyLabel).
      const label = makeTextSprite(a.shortName, { fontSize: 26, depthTest: true });
      label.position.set(cen.x, midY, cen.z);
      label.userData.airspaceId = a.id;
      label.userData.baseLabel = a.shortName;
      label.userData.lowerFt = a.lowerFt;
      label.userData.upperFt = a.upperFt;
      this.labelsGroup.add(label);
      this._labelSprites.push(label);

      const c = {
        airspace: a, ring, lower, upper, color, opacity, mesh, label,
        centroid: cen, midY, military: isMilitaryAirspace(a),
      };
      c.cssColor = "#" + c.color.toString(16).padStart(6, "0");
      this.compiled.push(c);
      this._compiledById.set(a.id, c);
      this.airspaces.push(a);
    }
    this._applyMilitaryVisibility();
    return data;
  }

  setMilitaryVisible(show) {
    this.showMilitary = show;
    this._applyMilitaryVisibility();
  }

  _applyMilitaryVisibility() {
    for (const c of this.compiled) {
      if (!c.military) continue;
      c.mesh.visible = this.showMilitary;
      c.label.visible = this.showMilitary && this.labelsGroup.visible;
    }
  }

  _isActive(c) {
    return !c.military || this.showMilitary;
  }

  get labelRoot() {
    return this.labelsGroup;
  }

  labelTextFor(a) {
    return `${a.shortName}\n${a.lowerFt.toLocaleString()}–${a.upperFt.toLocaleString()} ft`;
  }

  setLabelsVisible(visible) {
    this.labelsGroup.visible = visible;
    for (const c of this.compiled) {
      if (c.military) {
        c.label.visible = visible && this.showMilitary;
      }
    }
  }

  setShowHeights(show) {
    this.showHeights = show;
    this._refreshLabelText();
  }

  _refreshLabelText() {
    for (const sp of [...this._labelSprites]) {
      const a = this._compiledById.get(sp.userData.airspaceId)?.airspace;
      if (!a) continue;
      const text = this.showHeights ? this.labelTextFor(a) : a.shortName;
      const parent = sp.parent;
      const pos = sp.position.clone();
      const ud = { ...sp.userData };
      parent.remove(sp);
      sp.material.map?.dispose();
      sp.material.dispose();
      // Regular labels keep depthTest:true — see load() comment.
      const next = makeTextSprite(text, {
        fontSize: this.showHeights ? 24 : 26,
        depthTest: true,
      });
      next.position.copy(pos);
      next.userData = ud;
      parent.add(next);
      const idx = this._labelSprites.indexOf(sp);
      if (idx >= 0) this._labelSprites[idx] = next;
      const c = this._compiledById.get(ud.airspaceId);
      if (c) c.label = next;
    }
  }

  setHighlighted(ids) {
    const next = new Set(ids);
    for (const c of this.compiled) {
      const on = this._isActive(c) && next.has(c.airspace.id);
      const ud = c.mesh.userData;
      // P2.T7 — walls are always visible; highlight swaps to the brighter
      // shared material instead of toggling visibility. Outline material
      // swaps for the same reason (pool entries are mutation-shared).
      if (ud.wallMesh) {
        ud.wallMesh.material = on ? WALL_MAT_HIGHLIGHT : WALL_MAT_NORMAL;
      }
      const lineMat = on ? ud.outlineMatHi : ud.outlineMatNormal;
      if (ud.topLine) ud.topLine.material = lineMat;
      if (ud.botLine) ud.botLine.material = lineMat;
    }
    for (const id of this._highlighted) {
      if (!next.has(id)) this._removeIdentifyLabel(id);
    }
    this._highlighted = next;
  }

  /**
   * Metadata for the bottom identify panel cards.
   * @param {Iterable<string>} ids        — airspace ids that the ray hit
   * @param {?{x:number,y:number,z:number}} fromPos — drone position; when
   *   provided, each entry gets `distanceM` (3-D distance to nearest point of
   *   the volume; 0 if inside) and the result is sorted nearest-first.
   */
  identifyInfoForIds(ids, fromPos = null) {
    const out = [];
    for (const id of ids) {
      const c = this.compiled.find((x) => x.airspace.id === id);
      if (!c || !this._isActive(c)) continue;
      const a = c.airspace;
      const rmaxM = ringMaxRadius(c.ring, c.centroid.x, c.centroid.z);
      const radiusLabel = a.shape === "circle" && a.radiusNM != null
        ? `${a.radiusNM} NM`
        : `~${(rmaxM / NM_TO_M).toFixed(1)} NM`;
      const distanceM = fromPos
        ? nearestDistanceTo(fromPos.x, fromPos.y, fromPos.z, c)
        : null;
      out.push({
        id: a.id,
        name: a.shortName,
        category: a.category,
        categoryKey: categoryKeyFor(a),
        radiusLabel,
        lowerFt: a.lowerFt,
        upperFt: a.upperFt,
        distanceM,
      });
    }
    return out.sort((a, b) => {
      if (a.distanceM == null && b.distanceM == null) return a.name.localeCompare(b.name);
      if (a.distanceM == null) return 1;
      if (b.distanceM == null) return -1;
      return a.distanceM - b.distanceM;
    });
  }

  _ensureIdentifyLabel(id) {
    const c = this.compiled.find((x) => x.airspace.id === id);
    if (!c || this._identifySprites.has(id)) return;
    const sp = makeTextSprite(this.labelTextFor(c.airspace), { fontSize: 26 });
    const base = new THREE.Vector3(c.centroid.x, c.upper + 200, c.centroid.z);
    sp.position.copy(base);
    sp.userData._basePos = base.clone();
    sp.userData.airspaceId = id;
    this.identifyLabelsGroup.add(sp);
    this._identifySprites.set(id, sp);
  }

  _removeIdentifyLabel(id) {
    const sp = this._identifySprites.get(id);
    if (!sp) return;
    this.identifyLabelsGroup.remove(sp);
    sp.material.map?.dispose();
    sp.material.dispose();
    this._identifySprites.delete(id);
  }

  clearHighlights() {
    this.setHighlighted([]);
  }

  get highlightedIds() {
    return this._highlighted;
  }

  get identifySprites() {
    return [...this._identifySprites.values()];
  }

  airspacesAt(x, y, z) {
    const hits = [];
    for (const c of this.compiled) {
      if (!this._isActive(c)) continue;
      if (y < c.lower || y > c.upper) continue;
      if (pointInRing(x, z, c.ring)) hits.push(c.airspace);
    }
    return hits;
  }

  // P4.T5 bug fix (pass3.md #11): geofence membership must be evaluated even
  // when military airspaces are visually hidden. Same as airspacesAt but
  // skips the showMilitary filter so Geofence sees no-fly hits regardless of
  // the user's display toggle.
  airspacesAtUnfiltered(x, y, z) {
    const hits = [];
    for (const c of this.compiled) {
      if (y < c.lower || y > c.upper) continue;
      if (pointInRing(x, z, c.ring)) hits.push(c.airspace);
    }
    return hits;
  }

  /**
   * P4.T5: nearest 2-D ring distance for advisory-tier geofence. Considers
   * any compiled airspace whose category matches `categories` (e.g. CTR /
   * TMA). Inside the ring → distance 0 and the id is reported.
   * Vertical extent is ignored (advisory ring is a horizontal proximity).
   * Military filter is intentionally bypassed (same reason as
   * airspacesAtUnfiltered).
   */
  nearestLateralRingDistance(x, z, categories) {
    const catSet = categories instanceof Set ? categories : new Set(categories);
    let best = Infinity;
    const insideIds = [];
    for (const c of this.compiled) {
      if (!catSet.has(c.airspace.category)) continue;
      if (pointInRing(x, z, c.ring)) {
        best = 0;
        insideIds.push(c.airspace.id);
        continue;
      }
      let dSq = Infinity;
      const ring = c.ring;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[j], b = ring[i];
        const s = pointToSegmentDistSq(x, z, a.x, a.z, b.x, b.z);
        if (s < dSq) dSq = s;
      }
      const d = Math.sqrt(dSq);
      if (d < best) best = d;
    }
    return { distanceM: best, insideIds };
  }

  /**
   * P4.T5: pulse the outline of authorisation-tier airspaces at 1 Hz so the
   * user has an obvious 3-D cue that the ceiling clamp is active. We toggle
   * topLine/botLine.visible on a 0.5 s on / 0.5 s off cycle for the supplied
   * id set; everything else is left alone. Passing an empty set clears the
   * effect (outlines restored to visible).
   */
  setGeofenceFlash(idSet) {
    const next = idSet instanceof Set ? idSet : new Set(idSet);
    const prev = this._geofenceFlashIds;
    // Called every substep (120 Hz) by the geofence host — skip the work
    // when the set hasn't actually changed.
    if (prev && prev.size === next.size) {
      let same = true;
      for (const id of next) { if (!prev.has(id)) { same = false; break; } }
      if (same) return;
    }
    // Restore outlines for ids that are no longer flashing.
    if (prev) {
      for (const id of prev) {
        if (next.has(id)) continue;
        const c = this._compiledById.get(id);
        if (!c) continue;
        const ud = c.mesh.userData;
        if (ud.topLine) ud.topLine.visible = true;
        if (ud.botLine) ud.botLine.visible = true;
      }
    }
    this._geofenceFlashIds = next;
    if (next.size === 0) this._geofenceFlashClock = 0;
  }

  tickGeofenceFlash(dt) {
    const ids = this._geofenceFlashIds;
    if (!ids || ids.size === 0) return;
    this._geofenceFlashClock = (this._geofenceFlashClock ?? 0) + dt;
    // 1 Hz square wave: visible 0–0.5 s, hidden 0.5–1.0 s.
    const on = (this._geofenceFlashClock % 1) < 0.5;
    for (const id of ids) {
      const c = this._compiledById.get(id);
      if (!c) continue;
      const ud = c.mesh.userData;
      if (ud.topLine) ud.topLine.visible = on;
      if (ud.botLine) ud.botLine.visible = on;
    }
  }

  /** Fly-to overview at 40 000 ft AMSL, framed to fit the volume. */
  /**
   * Place the aircraft `direction` from the airspace centroid, looking back
   * toward the centroid. `direction` is one of N / NE / E / SE / S / SW / W /
   * NW. Default "S" preserves prior behaviour (vantage south of the volume,
   * looking north).
   *
   *  Coordinate system reminder: +X = east, +Z = south, so "view from north"
   *  → drone z < centroid.z.
   */
  overviewVantage(id, cameraFovDeg = 70, direction = "S") {
    const c = this.compiled.find((x) => x.airspace.id === id);
    if (!c) return null;
    const cx = c.centroid.x;
    const cz = c.centroid.z;
    const rmax = ringMaxRadius(c.ring, cx, cz);
    const alt = 40_000 * FT_TO_M;
    const halfFov = (cameraFovDeg * Math.PI) / 180 / 2;
    const dist = Math.max((rmax * 1.2) / Math.tan(halfFov), rmax + 5000, 8000);

    // Unit offset (east-x, south-z) from centroid → drone position.
    const DIR_OFFSETS = {
      N:  [  0, -1],   // drone north of volume → -Z
      NE: [  1, -1],
      E:  [  1,  0],
      SE: [  1,  1],
      S:  [  0,  1],   // drone south → +Z (default)
      SW: [ -1,  1],
      W:  [ -1,  0],
      NW: [ -1, -1],
    };
    const d = DIR_OFFSETS[direction] ?? DIR_OFFSETS.S;
    const len = Math.hypot(d[0], d[1]) || 1;
    const ox = (d[0] / len) * dist;
    const oz = (d[1] / len) * dist;

    const x = cx + ox;
    const z = cz + oz;
    const midY = (c.lower + c.upper) / 2;
    // Yaw so the camera looks back at the centroid.
    const yaw = Math.atan2(-(cx - x), -(cz - z));
    const pitch = -Math.atan2(alt - midY, dist);
    return { x, y: alt, z, yaw, pitch, lookX: cx, lookZ: cz, direction };
  }

  vantagePoint(id) {
    return this.overviewVantage(id);
  }

  /**
   * Scale labels by camera distance with a minimum on-screen size.
   *
   * P2.T8 — for regular (non-identify) labels: sort nearest-first, fade
   * with distance past FADE_START × MAX_RANGE, run a screen-space AABB
   * declutter and cap at MAX_VISIBLE so the country view stops being a
   * smear of overlapping sprites over Bangkok.
   */
  updateLabelScales(camera, renderer) {
    const camPos = camera.position;
    const hPx = renderer.domElement.clientHeight || 720;
    const wPx = renderer.domElement.clientWidth || 1280;
    const vFov = (camera.fov * Math.PI) / 180;
    const tanHalf = Math.tan(vFov / 2);
    const aspect = wPx / hPx;

    const scaleSprite = (sp, distRaw) => {
      const cw = sp.userData.canvasW || 512;
      const ch = sp.userData.canvasH || 64;
      const base = sp.userData.baseScale || 10;
      const dist = Math.max(distRaw, 800);
      const worldPerPx = (2 * tanHalf * dist) / hPx;
      const minPx = 14;
      const maxPx = 28;
      let s = base * THREE.MathUtils.clamp(dist / 18_000, 0.4, 1.4);
      const minS = (minPx * worldPerPx) / ch;
      const maxS = (maxPx * worldPerPx) / ch;
      s = THREE.MathUtils.clamp(s, minS, maxS);
      sp.scale.set(cw * s, ch * s, 1);
      return s;
    };

    // Identify sprites — unchanged: always visible, no declutter, no fade.
    for (const sp of this._identifySprites.values()) {
      const dist = sp.position.distanceTo(camPos);
      scaleSprite(sp, dist);
      sp.material.opacity = 1;
    }

    if (!this.labelsGroup.visible) return;

    const MAX_RANGE = 600_000;     // beyond this: hide
    const FADE_START = 0.55;        // fade kicks in past 55% of range
    const MAX_VISIBLE = 18;         // top-N closest survive declutter

    const ndc = new THREE.Vector3();
    const entries = [];
    for (const sp of this._labelSprites) {
      const owner = this._compiledById.get(sp.userData.airspaceId);
      // Hidden military airspace → label stays off.
      if (owner && !this._isActive(owner)) {
        sp.visible = false;
        continue;
      }
      const dist = sp.position.distanceTo(camPos);
      if (dist > MAX_RANGE) {
        sp.visible = false;
        continue;
      }
      ndc.copy(sp.position).project(camera);
      // Reject behind camera or far off-screen (allow small margin).
      if (ndc.z >= 1 || ndc.z <= -1 ||
          Math.abs(ndc.x) > 1.3 || Math.abs(ndc.y) > 1.3) {
        sp.visible = false;
        continue;
      }
      entries.push({ sp, dist, ndcX: ndc.x, ndcY: ndc.y });
    }
    entries.sort((a, b) => a.dist - b.dist);

    const placedBoxes = [];
    let placed = 0;
    for (const e of entries) {
      if (placed >= MAX_VISIBLE) {
        e.sp.visible = false;
        continue;
      }
      const s = scaleSprite(e.sp, e.dist);
      const ch = e.sp.userData.canvasH || 64;
      const cw = e.sp.userData.canvasW || 512;
      // Convert world-space sprite extents → NDC half-extents.
      const worldH = ch * s;
      const worldW = cw * s;
      const halfNdcY = worldH / (2 * tanHalf * Math.max(e.dist, 800));
      const halfNdcX = worldW / (2 * tanHalf * Math.max(e.dist, 800) * aspect);
      const box = {
        minX: e.ndcX - halfNdcX, maxX: e.ndcX + halfNdcX,
        minY: e.ndcY - halfNdcY, maxY: e.ndcY + halfNdcY,
      };
      let overlap = false;
      for (const b of placedBoxes) {
        if (box.minX > b.maxX || box.maxX < b.minX) continue;
        if (box.minY > b.maxY || box.maxY < b.minY) continue;
        overlap = true;
        break;
      }
      if (overlap) {
        e.sp.visible = false;
        continue;
      }
      // Distance fade: full opacity until FADE_START, linear to 0 at MAX_RANGE.
      const fadeT = THREE.MathUtils.clamp(
        (e.dist / MAX_RANGE - FADE_START) / (1 - FADE_START),
        0,
        1,
      );
      e.sp.material.opacity = 1 - fadeT;
      e.sp.visible = true;
      placedBoxes.push(box);
      placed++;
    }
  }
}
