// liveFlights.js — real ADS-B traffic overlay (Betterment-4 §12.1/§12.3).
//
// LiveFlightsLayer owns three scene groups (aircraft / labels / trails) and a
// Map<icao24, Flight>. It polls a FlightDataSource on a configurable cadence,
// spawns a model per aircraft, grows a fading trail, and renders smooth motion
// via dead-reckoning between polls. Performance contract:
//   - LOD: full model for the nearest K, lightweight billboard sprite beyond,
//     hard cap MAX_RENDERED (farthest hidden); promote/demote with hysteresis.
//   - Motion: each frame the per-flight `target` dead-reckons forward by its
//     velocity and the rendered `world` eases toward it (exponential smoothing)
//     so aircraft glide at any cadence and self-correct on every poll.
//   - Trails: per-aircraft Line, capped by time + count, rebuilt only on poll.
//   - Polling pauses on document.hidden / when disabled; nothing is allocated
//     while the layer is off.
import * as THREE from "three";
import { geoToWorld } from "./coords.js";
import { makeTextSprite } from "./airspace.js";
import { buildLiveAircraftModel } from "./drone.js";
import { makeSource, bucketForFlight } from "./flightSources.js";

const DEG2RAD = Math.PI / 180;
const MAX_RENDERED = 150;        // hard cap on visible aircraft
const PROMOTE_RANK = 20;         // nearest this many get full models …
const DEMOTE_RANK = 28;          // … demoted back to a billboard past this (hysteresis)
const TRAIL_MAX_MS = 8 * 60 * 1000;
const TRAIL_MAX_PTS = 120;
const DESPAWN_POLLS = 3;         // missed polls before a flight fades out
const SMOOTH_TAU = 0.4;          // seconds — position easing time constant
const FADE_PER_S = 2.5;          // spawn-in / despawn fade rate
const TRAIL_COLOR = new THREE.Color(0x00e5ff);

// Authored-model length → real-world target length (metres) per bucket. The
// model is uniformly scaled at spawn so live aircraft are sized realistically.
const TARGET_LEN_M = { light: 11, bizjet: 17, narrowbody: 38, heavy: 64, unknown: 20 };

let _iconTex = null;
function _planeIcon() {
  if (_iconTex) return _iconTex;
  const s = 64;
  const c = document.createElement("canvas");
  c.width = s; c.height = s;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "rgba(10,20,30,0.9)";
  ctx.lineWidth = 2;
  // simple top-view plane silhouette, nose up
  ctx.beginPath();
  ctx.moveTo(32, 6);                 // nose
  ctx.lineTo(37, 30);
  ctx.lineTo(58, 40); ctx.lineTo(58, 46); ctx.lineTo(37, 40);   // right wing
  ctx.lineTo(36, 52);
  ctx.lineTo(46, 58); ctx.lineTo(46, 61); ctx.lineTo(32, 57);   // right tailplane
  ctx.lineTo(18, 61); ctx.lineTo(18, 58); ctx.lineTo(28, 52);   // left tailplane
  ctx.lineTo(27, 40);
  ctx.lineTo(6, 46); ctx.lineTo(6, 40); ctx.lineTo(27, 30);     // left wing
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  _iconTex = new THREE.CanvasTexture(c);
  _iconTex.colorSpace = THREE.SRGBColorSpace;
  return _iconTex;
}

const _v = new THREE.Vector3();

export class LiveFlightsLayer {
  constructor(scene, { camera, renderer } = {}) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.aircraftGroup = new THREE.Group();
    this.labelsGroup = new THREE.Group();
    this.trailsGroup = new THREE.Group();
    this.aircraftGroup.visible = false;
    this.labelsGroup.visible = false;
    this.trailsGroup.visible = false;
    scene.add(this.aircraftGroup, this.labelsGroup, this.trailsGroup);

    this.flights = new Map();
    this._enabled = false;
    this._intervalMs = 60000;
    this._proxyBase = "";
    this._sourceId = "adsblol";
    this._source = makeSource(this._sourceId, { proxyBase: "" });
    this._timer = null;
    this._inFlight = null;
    this._status = { count: 0, lastUpdated: 0, state: "idle", sourceId: this._sourceId };
    this.onStatusChange = null;
  }

  // ---------------- public controls ----------------

  setEnabled(on) {
    on = !!on;
    if (on === this._enabled) return;
    this._enabled = on;
    this.aircraftGroup.visible = on;
    this.labelsGroup.visible = on;
    this.trailsGroup.visible = on;
    if (on) {
      this._setStatus({ state: "loading" });
      this._poll();
    } else {
      clearTimeout(this._timer);
      this._timer = null;
      this._clearAll();
      this._setStatus({ state: "idle", count: 0 });
    }
  }

  setSource(id) {
    this._sourceId = id;
    this._source = makeSource(id, { proxyBase: this._proxyBase });
    this._setStatus({ sourceId: id });
    if (this._enabled) { this._clearAll(); this._restart(); }
  }

  setIntervalMs(ms) {
    this._intervalMs = Math.max(5000, Math.min(60000, ms | 0));
    if (this._enabled) this._restart();
  }

  setProxyBase(url) {
    this._proxyBase = url || "";
    this._source = makeSource(this._sourceId, { proxyBase: this._proxyBase });
  }

  getStatus() { return { ...this._status }; }

  dispose() {
    this.setEnabled(false);
    this.scene.remove(this.aircraftGroup, this.labelsGroup, this.trailsGroup);
  }

  // ---------------- polling ----------------

  _restart() {
    clearTimeout(this._timer);
    this._timer = null;
    this._poll();
  }

  _arm(delay) {
    clearTimeout(this._timer);
    if (this._enabled) this._timer = setTimeout(() => this._poll(), delay);
  }

  _poll() {
    if (!this._enabled) return;
    if (typeof document !== "undefined" && document.hidden) { this._arm(this._intervalMs); return; }
    if (this._inFlight) return;   // a fetch is still pending; skip this tick
    this._setStatus({ state: "loading" });
    const src = this._source;
    this._inFlight = src.fetchStates()
      .then((list) => {
        if (src !== this._source) return;     // source changed mid-flight
        this._ingest(list || []);
        this._setStatus({ state: list && list.length ? "ok" : "empty", count: this.flights.size, lastUpdated: Date.now() });
      })
      .catch((err) => {
        console.warn("[liveflights] poll failed", err);
        this._setStatus({ state: "error" });   // keep last-good meshes on screen
      })
      .finally(() => { this._inFlight = null; this._arm(this._intervalMs); });
  }

  _setStatus(patch) {
    this._status = { ...this._status, ...patch };
    this.onStatusChange?.(this.getStatus());
  }

  // ---------------- ingest / lifecycle ----------------

  _ingest(list) {
    const now = Date.now();
    const seen = new Set();
    for (const nf of list) {
      if (!nf || !nf.id) continue;
      seen.add(nf.id);
      let f = this.flights.get(nf.id);
      const w = geoToWorld(nf.lat, nf.lon);
      if (!f) {
        f = this._spawn(nf, w);
        this.flights.set(nf.id, f);
      } else {
        f.fix = nf;
        f.callsign = nf.callsign || f.callsign;
        f.target.set(w.x, nf.altM, w.z);
        f.vel.copy(this._worldVel(nf));
        f.holder.rotation.y = Math.PI - nf.headingDeg * DEG2RAD;
        f.missedPolls = 0;
        f.dead = false;
        f.lastSeen = now;
      }
      f.trail.push({ x: w.x, y: nf.altM, z: w.z, t: now });
      this._trimTrail(f, now);
      this._rebuildTrail(f);
    }
    // flights absent from this poll: count a miss, despawn after DESPAWN_POLLS.
    for (const f of this.flights.values()) {
      if (seen.has(f.id)) continue;
      if (++f.missedPolls >= DESPAWN_POLLS) f.dead = true;
    }
  }

  _worldVel(nf) {
    // bearing CW from north; world north = -Z, east = +X.
    const b = nf.headingDeg * DEG2RAD;
    return _v.set(nf.velMs * Math.sin(b), nf.vertRateMs, -nf.velMs * Math.cos(b));
  }

  _spawn(nf, w) {
    const bucket = bucketForFlight(nf);
    const holder = new THREE.Group();
    holder.position.set(w.x, nf.altM, w.z);
    holder.rotation.y = Math.PI - nf.headingDeg * DEG2RAD;

    const billboard = new THREE.Sprite(new THREE.SpriteMaterial({
      map: _planeIcon(), color: 0xcfefff, transparent: true, opacity: 0, depthTest: true,
    }));
    holder.add(billboard);
    this.aircraftGroup.add(holder);

    const label = makeTextSprite(nf.callsign || nf.id, { fontSize: 22, depthTest: false });
    label.material.opacity = 0;
    this.labelsGroup.add(label);

    const line = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, depthTest: true }),
    );
    this.trailsGroup.add(line);

    return {
      id: nf.id, callsign: nf.callsign, bucket, fix: nf,
      world: new THREE.Vector3(w.x, nf.altM, w.z),
      target: new THREE.Vector3(w.x, nf.altM, w.z),
      vel: this._worldVel(nf).clone(),
      trail: [{ x: w.x, y: nf.altM, z: w.z, t: Date.now() }],
      holder, billboard, model: null, label, line,
      lastSeen: Date.now(), missedPolls: 0, fade: 0, dead: false, lod: "far",
    };
  }

  _ensureModel(f) {
    if (f.model) return f.model;
    const m = buildLiveAircraftModel(f.bucket);
    // Normalise to a realistic length for the bucket.
    const box = new THREE.Box3().setFromObject(m);
    const size = box.getSize(new THREE.Vector3());
    const len = Math.max(size.x, size.z) || 1;
    m.scale.setScalar((TARGET_LEN_M[f.bucket] || 20) / len);
    f.holder.add(m);
    f.model = m;
    return m;
  }

  _remove(f) {
    this.aircraftGroup.remove(f.holder);
    f.holder.traverse((o) => { o.geometry?.dispose?.(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((mm) => mm.dispose()); });
    this.labelsGroup.remove(f.label);
    f.label.material.map?.dispose(); f.label.material.dispose();
    this.trailsGroup.remove(f.line);
    f.line.geometry.dispose(); f.line.material.dispose();
    this.flights.delete(f.id);
  }

  _clearAll() {
    for (const f of [...this.flights.values()]) this._remove(f);
    this.flights.clear();
  }

  // ---------------- trails ----------------

  _trimTrail(f, now) {
    const t = f.trail;
    while (t.length > TRAIL_MAX_PTS || (t.length > 1 && now - t[0].t > TRAIL_MAX_MS)) t.shift();
  }

  _rebuildTrail(f) {
    const pts = f.trail;
    const n = pts.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = pts[i].x; pos[i * 3 + 1] = pts[i].y; pos[i * 3 + 2] = pts[i].z;
      const age = i / Math.max(n - 1, 1);          // 0 = oldest … 1 = newest
      const k = 0.2 + 0.8 * age;                    // dim tail → bright head
      col[i * 3] = TRAIL_COLOR.r * k; col[i * 3 + 1] = TRAIL_COLOR.g * k; col[i * 3 + 2] = TRAIL_COLOR.b * k;
    }
    const g = f.line.geometry;
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setDrawRange(0, n);
  }

  // ---------------- per-frame ----------------

  update(dt, camPos) {
    if (!this._enabled || this.flights.size === 0) return;
    const ease = 1 - Math.exp(-dt / SMOOTH_TAU);
    const list = [];
    for (const f of this.flights.values()) {
      // dead-reckon the target forward, ease the rendered position toward it.
      f.target.addScaledVector(f.vel, dt);
      f.world.lerp(f.target, ease);
      f.holder.position.copy(f.world);
      // spawn-in / despawn fade
      const goal = f.dead ? 0 : 1;
      f.fade += Math.sign(goal - f.fade) * Math.min(Math.abs(goal - f.fade), FADE_PER_S * dt);
      if (f.dead && f.fade <= 0.01) { this._remove(f); continue; }
      f.dist = camPos ? f.world.distanceTo(camPos) : 0;
      list.push(f);
    }
    // LOD: rank by distance; nearest get full models, rest billboards, cap total.
    list.sort((a, b) => a.dist - b.dist);
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      const visible = i < MAX_RENDERED;
      f.holder.visible = visible;
      f.line.visible = visible && f.trail.length > 1;
      if (!visible) { f.label.visible = false; continue; }
      // hysteresis promote/demote
      if (f.lod === "far" && i < PROMOTE_RANK) f.lod = "near";
      else if (f.lod === "near" && i > DEMOTE_RANK) f.lod = "far";
      if (f.lod === "near") {
        this._ensureModel(f);
        f.model.visible = true;
        f.billboard.visible = false;
      } else {
        if (f.model) f.model.visible = false;
        f.billboard.visible = true;
      }
      f.billboard.material.opacity = 0.95 * f.fade;
      f.line.material.opacity = 0.8 * f.fade;
    }
  }

  updateLabelScales(camera, renderer) {
    if (!this._enabled || !this.labelsGroup.visible) return;
    const hPx = renderer.domElement.clientHeight || 720;
    const tanHalf = Math.tan((camera.fov * DEG2RAD) / 2);
    // Size every visible billboard to ~constant screen px.
    const visible = [];
    for (const f of this.flights.values()) {
      if (!f.holder.visible) { f.label.visible = false; continue; }
      const dist = Math.max(f.dist ?? 1000, 800);
      const worldPerPx = (2 * tanHalf * dist) / hPx;
      f.billboard.scale.setScalar(Math.max(28 * worldPerPx, 300));
      visible.push(f);
    }
    // Callsign labels only for the nearest ~60 visible flights (declutter).
    visible.sort((a, b) => (a.dist ?? 1e12) - (b.dist ?? 1e12));
    for (let i = 0; i < visible.length; i++) {
      const f = visible[i];
      const show = i < 60 && f.fade > 0.05;
      f.label.visible = show;
      if (!show) continue;
      f.label.position.set(f.world.x, f.world.y + 220, f.world.z);
      const dist = Math.max(f.dist ?? 1000, 800);
      const worldPerPx = (2 * tanHalf * dist) / hPx;
      const ch = f.label.userData.canvasH || 64;
      const cw = f.label.userData.canvasW || 512;
      const s = (20 * worldPerPx) / ch;
      f.label.scale.set(cw * s, ch * s, 1);
      f.label.material.opacity = Math.max(0, 1 - dist / 550_000) * f.fade;
    }
  }
}
