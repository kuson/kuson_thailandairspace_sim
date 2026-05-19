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

const HIGHLIGHT_OPACITY = 0.52;

const MILITARY_CTR_IDS = new Set([
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

export function makeTextSprite(text, { fontSize = 28, maxWidth = 512 } = {}) {
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
    depthTest: false,
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

  const outlineMat = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: Math.min(opacity * 3.5, 0.92),
    depthTest: true,
    depthWrite: false,
  });

  const closed = [...ring, ring[0]];
  const topPts = closed.map((p) => new THREE.Vector3(p.x, lower + depth, p.z));
  const botPts = closed.map((p) => new THREE.Vector3(p.x, lower, p.z));
  const topLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(topPts),
    outlineMat
  );
  const botLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(botPts),
    outlineMat
  );

  const ribStep = Math.max(1, Math.floor(ring.length / 16));
  const ribs = new THREE.Group();
  for (let i = 0; i < ring.length; i += ribStep) {
    const p = ring[i];
    const ribGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(p.x, lower, p.z),
      new THREE.Vector3(p.x, lower + depth, p.z),
    ]);
    ribs.add(new THREE.Line(ribGeo, outlineMat));
  }

  const shape = new THREE.Shape(ring.map((p) => new THREE.Vector2(p.x, -p.z)));
  const fillGeo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 24,
  });
  fillGeo.rotateX(-Math.PI / 2);
  fillGeo.translate(0, lower, 0);
  const fillMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: HIGHLIGHT_OPACITY,
    side: THREE.FrontSide,
    depthWrite: false,
    depthTest: true,
  });
  const fillMesh = new THREE.Mesh(fillGeo, fillMat);
  fillMesh.visible = false;

  const group = new THREE.Group();
  group.add(topLine, botLine, ribs, fillMesh);
  group.userData.fillMesh = fillMesh;
  group.userData.outlineMat = outlineMat;
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
      const label = makeTextSprite(a.shortName, { fontSize: 26 });
      label.position.set(cen.x, midY, cen.z);
      label.userData.airspaceId = a.id;
      label.userData.baseLabel = a.shortName;
      label.userData.lowerFt = a.lowerFt;
      label.userData.upperFt = a.upperFt;
      this.labelsGroup.add(label);
      this._labelSprites.push(label);

      this.compiled.push({
        airspace: a, ring, lower, upper, color, opacity, mesh, label,
        centroid: cen, midY, military: isMilitaryAirspace(a),
      });
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
      const a = this.compiled.find((c) => c.airspace.id === sp.userData.airspaceId)?.airspace;
      if (!a) continue;
      const text = this.showHeights ? this.labelTextFor(a) : a.shortName;
      const parent = sp.parent;
      const pos = sp.position.clone();
      const ud = { ...sp.userData };
      parent.remove(sp);
      sp.material.map?.dispose();
      sp.material.dispose();
      const next = makeTextSprite(text, { fontSize: this.showHeights ? 24 : 26 });
      next.position.copy(pos);
      next.userData = ud;
      parent.add(next);
      const idx = this._labelSprites.indexOf(sp);
      if (idx >= 0) this._labelSprites[idx] = next;
      const c = this.compiled.find((x) => x.airspace.id === ud.airspaceId);
      if (c) c.label = next;
    }
  }

  setHighlighted(ids) {
    const next = new Set(ids);
    for (const c of this.compiled) {
      const on = this._isActive(c) && next.has(c.airspace.id);
      const fill = c.mesh.userData.fillMesh;
      if (fill) fill.visible = on;
      if (on) {
        c.mesh.userData.outlineMat.opacity = 0.95;
      } else {
        c.mesh.userData.outlineMat.opacity = Math.min(c.opacity * 3.5, 0.92);
      }
    }
    for (const id of this._highlighted) {
      if (!next.has(id)) this._removeIdentifyLabel(id);
    }
    this._highlighted = next;
  }

  /** Metadata for bottom identify panel cards. */
  identifyInfoForIds(ids) {
    const out = [];
    for (const id of ids) {
      const c = this.compiled.find((x) => x.airspace.id === id);
      if (!c || !this._isActive(c)) continue;
      const a = c.airspace;
      const rmaxM = ringMaxRadius(c.ring, c.centroid.x, c.centroid.z);
      const radiusLabel = a.shape === "circle" && a.radiusNM != null
        ? `${a.radiusNM} NM`
        : `~${(rmaxM / NM_TO_M).toFixed(1)} NM`;
      out.push({
        id: a.id,
        name: a.shortName,
        category: a.category,
        categoryKey: categoryKeyFor(a),
        radiusLabel,
        lowerFt: a.lowerFt,
        upperFt: a.upperFt,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
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

  /** Fly-to overview at 40 000 ft AMSL, framed to fit the volume. */
  overviewVantage(id, cameraFovDeg = 70) {
    const c = this.compiled.find((x) => x.airspace.id === id);
    if (!c) return null;
    const cx = c.centroid.x;
    const cz = c.centroid.z;
    const rmax = ringMaxRadius(c.ring, cx, cz);
    const alt = 40_000 * FT_TO_M;
    const halfFov = (cameraFovDeg * Math.PI) / 180 / 2;
    const dist = Math.max((rmax * 1.2) / Math.tan(halfFov), rmax + 5000, 8000);
    const x = cx;
    const z = cz + dist;
    const midY = (c.lower + c.upper) / 2;
    const yaw = Math.atan2(-(cx - x), -(cz - z));
    const pitch = -Math.atan2(alt - midY, dist);
    return { x, y: alt, z, yaw, pitch, lookX: cx, lookZ: cz };
  }

  vantagePoint(id) {
    return this.overviewVantage(id);
  }

  /** Scale labels by camera distance with a minimum on-screen size. */
  updateLabelScales(camera, renderer) {
    const camPos = camera.position;
    const hPx = renderer.domElement.clientHeight || 720;
    const vFov = (camera.fov * Math.PI) / 180;
    const scaleSprite = (sp) => {
      const cw = sp.userData.canvasW || 512;
      const ch = sp.userData.canvasH || 64;
      const base = sp.userData.baseScale || 10;
      const dist = Math.max(sp.position.distanceTo(camPos), 800);
      const worldPerPx = (2 * Math.tan(vFov / 2) * dist) / hPx;
      const minPx = 14;
      const maxPx = 28;
      let s = base * THREE.MathUtils.clamp(dist / 18_000, 0.4, 1.4);
      const minS = (minPx * worldPerPx) / ch;
      const maxS = (maxPx * worldPerPx) / ch;
      s = THREE.MathUtils.clamp(s, minS, maxS);
      sp.scale.set(cw * s, ch * s, 1);
    };
    if (this.labelsGroup.visible) {
      for (const sp of this._labelSprites) scaleSprite(sp);
    }
    for (const sp of this._identifySprites.values()) scaleSprite(sp);
  }
}
