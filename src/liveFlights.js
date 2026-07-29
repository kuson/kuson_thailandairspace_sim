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
import { airlineFor, enrichRoute, airlineLogo, chipColor, altColor } from "./flightEnrich.js";

const DEG2RAD = Math.PI / 180;
const MAX_RENDERED = 150;        // hard cap on visible aircraft
const PROMOTE_RANK = 20;         // nearest this many get full models …
const DEMOTE_RANK = 28;          // … demoted back to a billboard past this (hysteresis)
const TRAIL_MAX_MS = 8 * 60 * 1000;
const TRAIL_MAX_PTS = 120;
const DESPAWN_POLLS = 3;         // missed polls before a flight fades out
const DATA_LINE_K = 25;          // nearest this many labels carry the HDG/ALT/GS row
const SMOOTH_TAU = 0.4;          // seconds — position easing time constant
const FADE_PER_S = 2.5;          // spawn-in / despawn fade rate
const TRAIL_COLOR = new THREE.Color(0x00e5ff);

// Authored-model length → real-world target length (metres) per bucket. The
// model is uniformly scaled at spawn so live aircraft are sized realistically.
const TARGET_LEN_M = { light: 11, bizjet: 17, narrowbody: 38, heavy: 64, unknown: 20 };

// Module-level flight-label texture cache.
// key   = string describing exactly what is rendered (callsign + variant).
// value = { tex: THREE.CanvasTexture, w: number, h: number, refs: number }
const _labelTexCache = new Map();

function _labelTexRetain(key, buildFn) {
  let entry = _labelTexCache.get(key);
  if (!entry) {
    entry = buildFn();
    entry.refs = 0;
    _labelTexCache.set(key, entry);
  }
  entry.refs++;
  return entry;
}

function _labelTexRelease(key) {
  const entry = _labelTexCache.get(key);
  if (!entry) return;
  entry.refs--;
  if (entry.refs <= 0) {
    entry.tex.dispose();
    _labelTexCache.delete(key);
  }
}

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

// Live-flight data-line formatters. ADS-B carries groundspeed (not airspeed) and
// altitude in feet; we render aviation-style FL/feet, a 3-digit heading and GS(kt).
const M_TO_FT = 3.28084, MS_TO_KT = 1.94384, MS_TO_FPM = 196.85;
function _fmtHeading(deg) {
  const d = ((Math.round(deg || 0) % 360) + 360) % 360;
  return "HDG " + String(d).padStart(3, "0");
}
function _fmtAltFt(altM, onGround) {
  if (onGround) return "GND";
  const ft = (altM || 0) * M_TO_FT;
  if (ft >= 18000) return "FL" + String(Math.round(ft / 100)).padStart(3, "0");
  return (Math.round(ft / 25) * 25).toLocaleString("en-US") + " ft";
}
function _fmtGs(velMs) { return "GS " + Math.round(((velMs || 0) * MS_TO_KT) / 5) * 5 + " kt"; }
function _vsGlyph(vertRateMs) {
  const fpm = (vertRateMs || 0) * MS_TO_FPM;
  return fpm > 100 ? "▲" : fpm < -100 ? "▼" : "";
}

// Callsign label with the airline logo (or a coloured IATA chip when the logo
// isn't CORS-loadable into a canvas). The cached logo <img> is shared per airline.
// When `data` ({hdgDeg,altM,velMs,vertRateMs,onGround}) is supplied, a second row
// — HDG · altitude(FL/ft, alt-coloured) · V/S arrow · GS — is drawn under the
// callsign on a transparent background. Pass null/undefined for callsign-only.
//
// Textures are cached by their cache key (see _flightLabelKey).  Identical keys
// share one CanvasTexture via _labelTexRetain / _labelTexRelease.

function _flightLabelKey(callsign, airline, data) {
  // The key must encode every value that influences pixels, so it is built
  // from the exact formatted strings/colours the draw code produces — raw
  // value buckets would let two flights share a texture while their drawn
  // numbers differ. Logo readiness is included so a pre-logo texture is
  // replaced once the image loads.
  const logo = airline.iata ? airlineLogo(airline.iata) : null;
  const logoReady = !!(logo && logo.complete && logo.naturalWidth > 0);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let k = `cs:${callsign}|ia:${airline.iata || ""}|ic:${airline.icao || ""}|lr:${logoReady ? 1 : 0}|dpr:${dpr}`;
  if (!data) return k + "|no-data";
  const vs = data.onGround ? "" : _vsGlyph(data.vertRateMs);
  return k +
    `|h:${_fmtHeading(data.hdgDeg)}|a:${_fmtAltFt(data.altM, data.onGround)}` +
    `|ac:${data.onGround ? "g" : altColor(data.altM)}|vs:${vs}|gs:${_fmtGs(data.velMs)}`;
}

function _buildLabelTex(callsign, airline, data) {
  const logo = airline.iata ? airlineLogo(airline.iata) : null;
  const logoReady = !!(logo && logo.complete && logo.naturalWidth > 0);
  const fs = 22, padX = 12, padY = 7, boxH = 30;
  const topH = padY * 2 + boxH;                 // 44 — single (callsign) row height
  const fs2 = 18, row2H = 22, rowGap = 4;       // data row metrics
  const meas = document.createElement("canvas").getContext("2d");
  meas.font = `bold ${fs}px ui-monospace, monospace`;
  const tw = Math.ceil(meas.measureText(callsign).width);
  const badgeW = logoReady ? Math.round(boxH * (logo.naturalWidth / logo.naturalHeight)) : (airline.iata ? 36 : 0);
  const gap = badgeW ? 8 : 0;
  const topW = padX * 2 + badgeW + gap + tw;

  // Build the data row segments (each its own colour) and measure its width.
  let segs = null, dataW = 0;
  if (data) {
    segs = [
      { t: _fmtHeading(data.hdgDeg), c: "#cfe8ff" },
      { t: _fmtAltFt(data.altM, data.onGround), c: data.onGround ? "#9aa7b4" : altColor(data.altM) },
    ];
    const vs = data.onGround ? "" : _vsGlyph(data.vertRateMs);
    if (vs) segs.push({ t: vs, c: vs === "▲" ? "#9effa0" : "#ff9e9e", glyph: true });
    segs.push({ t: _fmtGs(data.velMs), c: "#cfe8ff" });
    meas.font = `bold ${fs2}px ui-monospace, monospace`;
    dataW = padX * 2;
    for (let i = 0; i < segs.length; i++) {
      if (i > 0) dataW += segs[i].glyph ? 5 : 12;
      dataW += Math.ceil(meas.measureText(segs[i].t).width);
    }
  }

  const w = Math.max(topW, dataW), h = data ? topH + rowGap + row2H : topH;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);   // crisp text on retina
  const c = document.createElement("canvas");
  c.width = Math.round(w * DPR); c.height = Math.round(h * DPR);
  const ctx = c.getContext("2d");
  ctx.scale(DPR, DPR);

  // Top row — dark rounded box behind the callsign only, logo/chip + callsign.
  ctx.fillStyle = "rgba(8,12,20,0.85)"; ctx.beginPath(); ctx.roundRect(0, 0, w, topH, 7); ctx.fill();
  ctx.strokeStyle = "rgba(102,255,204,0.5)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(1, 1, w - 2, topH - 2, 6); ctx.stroke();
  let x = padX;
  if (badgeW) {
    if (logoReady) { try { ctx.drawImage(logo, x, (topH - boxH) / 2, badgeW, boxH); } catch { /* tainted — ignore */ } }
    else {
      ctx.fillStyle = chipColor(airline.icao || airline.iata); ctx.beginPath(); ctx.roundRect(x, (topH - boxH) / 2, badgeW, boxH, 4); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "bold 13px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(airline.iata, x + badgeW / 2, topH / 2);
    }
    x += badgeW + gap;
  }
  ctx.fillStyle = "#fff"; ctx.font = `bold ${fs}px ui-monospace, monospace`; ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillText(callsign, x, topH / 2 + 1);

  // Data row — transparent background, dark shadow for legibility against sky.
  if (segs) {
    const cy = topH + rowGap + row2H / 2;
    ctx.font = `bold ${fs2}px ui-monospace, monospace`; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,0.92)"; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1;
    let dx = padX;
    for (let i = 0; i < segs.length; i++) {
      if (i > 0) dx += segs[i].glyph ? 5 : 12;
      ctx.fillStyle = segs[i].c; ctx.fillText(segs[i].t, dx, cy);
      dx += Math.ceil(meas.measureText(segs[i].t).width);
    }
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  }

  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, w, h, topH };
}

function _flightLabel(callsign, airline, data) {
  const key = _flightLabelKey(callsign, airline, data);
  const entry = _labelTexRetain(key, () => _buildLabelTex(callsign, airline, data));
  const { tex, w, h, topH } = entry;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
  sp.userData.canvasW = w; sp.userData.canvasH = h; sp.userData.baseScale = 10; sp.renderOrder = 9999;
  sp.userData.screenH = h * (20 / topH);   // keep the callsign row ~20px on screen
  sp.userData.labelKey = key;              // remembered so callers can release it
  return sp;
}

// Great-circle interpolation between two lat/lon points (slerp on the sphere).
function _gcInterp(lat1, lon1, lat2, lon2, t) {
  const R = Math.PI / 180, D = 180 / Math.PI;
  const p1 = lat1 * R, l1 = lon1 * R, p2 = lat2 * R, l2 = lon2 * R;
  const d = 2 * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2));
  if (d < 1e-6) return { lat: lat1, lon: lon1 };
  const A = Math.sin((1 - t) * d) / Math.sin(d), B = Math.sin(t * d) / Math.sin(d);
  const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
  const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
  const z = A * Math.sin(p1) + B * Math.sin(p2);
  return { lat: Math.atan2(z, Math.hypot(x, y)) * D, lon: Math.atan2(y, x) * D };
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
    this.selectedId = null;   // drives card / route-line / follow / radar highlight
    this._routeLine = null; this._routeLineFor = null;
    this._enabled = false;
    this._intervalMs = 60000;
    this._proxyBase = "";
    this._sourceId = "adsblol";
    this._source = makeSource(this._sourceId, { proxyBase: "" });
    this._timer = null;
    this._inFlight = null;
    this._status = { count: 0, lastUpdated: 0, state: "idle", sourceId: this._sourceId };
    this.onStatusChange = null;
    this.onPositions = null;
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
        this._applyOrientation(f.holder, nf);
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
    this.onPositions?.(list);
  }

  _worldVel(nf) {
    // bearing CW from north; world north = -Z, east = +X.
    const b = nf.headingDeg * DEG2RAD;
    return _v.set(nf.velMs * Math.sin(b), nf.vertRateMs, -nf.velMs * Math.cos(b));
  }

  // Heading + pitch + bank onto the holder (+Z forward, YXZ order). Pitch is
  // derived from vertical rate vs ground speed; bank only if roll is broadcast.
  _applyOrientation(holder, nf) {
    holder.rotation.order = "YXZ";
    holder.rotation.y = Math.PI - nf.headingDeg * DEG2RAD;
    const gs = Math.max(nf.velMs || 0, 1);
    holder.rotation.x = -THREE.MathUtils.clamp(Math.atan2(nf.vertRateMs || 0, gs), -0.26, 0.26);
    holder.rotation.z = nf.rollDeg != null ? -nf.rollDeg * (Math.PI / 180) : 0;
  }

  _spawn(nf, w) {
    const bucket = bucketForFlight(nf);
    const holder = new THREE.Group();
    holder.position.set(w.x, nf.altM, w.z);
    this._applyOrientation(holder, nf);

    const billboard = new THREE.Sprite(new THREE.SpriteMaterial({
      map: _planeIcon(), color: 0xcfefff, transparent: true, opacity: 0, depthTest: true,
    }));
    holder.add(billboard);
    this.aircraftGroup.add(holder);

    const airline = airlineFor(nf.callsign, null);   // prefix-table guess (sync)
    if (airline.iata) airlineLogo(airline.iata);      // warm the shared logo cache
    const label = _flightLabel(nf.callsign || nf.id, airline);
    label.material.opacity = 0;
    this.labelsGroup.add(label);

    const trailPos = new Float32Array(TRAIL_MAX_PTS * 3);
    const trailCol = new Float32Array(TRAIL_MAX_PTS * 3);
    const trailGeom = new THREE.BufferGeometry();
    const trailPosAttr = new THREE.BufferAttribute(trailPos, 3);
    const trailColAttr = new THREE.BufferAttribute(trailCol, 3);
    trailGeom.setAttribute("position", trailPosAttr);
    trailGeom.setAttribute("color", trailColAttr);
    trailGeom.setDrawRange(0, 0);
    const line = new THREE.Line(
      trailGeom,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, depthTest: true }),
    );
    line.frustumCulled = false;
    this.trailsGroup.add(line);

    return {
      id: nf.id, callsign: nf.callsign, bucket, fix: nf,
      world: new THREE.Vector3(w.x, nf.altM, w.z),
      target: new THREE.Vector3(w.x, nf.altM, w.z),
      vel: this._worldVel(nf).clone(),
      trail: [{ x: w.x, y: nf.altM, z: w.z, t: Date.now() }],
      holder, billboard, model: null, label, line,
      airline, route: null, _enriched: false, _labelSig: "",
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

  _rebuildLabel(f, showData) {
    const old = f.label;
    const data = showData ? {
      hdgDeg: f.fix.headingDeg, altM: f.world.y, velMs: f.fix.velMs,
      vertRateMs: f.fix.vertRateMs, onGround: f.fix.onGround,
    } : null;
    const next = _flightLabel(f.callsign || f.id, f.airline, data);
    next.position.copy(old.position);
    next.visible = old.visible;
    next.material.opacity = old.material.opacity;
    this.labelsGroup.remove(old);
    // Release the old texture via the cache (disposes only when refs hit 0).
    _labelTexRelease(old.userData.labelKey);
    old.material.dispose();
    this.labelsGroup.add(next);
    f.label = next;
  }

  _remove(f) {
    this.aircraftGroup.remove(f.holder);
    f.holder.traverse((o) => { o.geometry?.dispose?.(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((mm) => mm.dispose()); });
    this.labelsGroup.remove(f.label);
    // Release via cache; the texture is disposed when its ref count reaches 0.
    _labelTexRelease(f.label.userData.labelKey);
    f.label.material.dispose();
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
    const g = f.line.geometry;
    const posAttr = g.attributes.position;
    const colAttr = g.attributes.color;
    const pos = posAttr.array;
    const col = colAttr.array;
    for (let i = 0; i < n; i++) {
      pos[i * 3] = pts[i].x; pos[i * 3 + 1] = pts[i].y; pos[i * 3 + 2] = pts[i].z;
      const age = i / Math.max(n - 1, 1);          // 0 = oldest … 1 = newest
      const k = 0.2 + 0.8 * age;                    // dim tail → bright head
      col[i * 3] = TRAIL_COLOR.r * k; col[i * 3 + 1] = TRAIL_COLOR.g * k; col[i * 3 + 2] = TRAIL_COLOR.b * k;
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    g.setDrawRange(0, n);
  }

  // Great-circle origin→dest line for the selected flight (when its route is known).
  _updateRouteLine() {
    const f = this.selectedId ? this.flights.get(this.selectedId) : null;
    const r = f?.route;
    const ready = r?.origin?.lat != null && r?.dest?.lat != null;
    const key = ready ? this.selectedId : null;
    if (key === this._routeLineFor) return;
    if (this._routeLine) {
      this.scene.remove(this._routeLine);
      this._routeLine.geometry.dispose(); this._routeLine.material.dispose();
      this._routeLine = null;
    }
    this._routeLineFor = key;
    if (!key) return;
    const o = r.origin, d = r.dest, N = 96, pos = new Float32Array((N + 1) * 3);
    for (let i = 0; i <= N; i++) {
      const ll = _gcInterp(o.lat, o.lon, d.lat, d.lon, i / N);
      const w = geoToWorld(ll.lat, ll.lon);
      pos[i * 3] = w.x; pos[i * 3 + 1] = 9000; pos[i * 3 + 2] = w.z;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this._routeLine = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.7 }));
    this.scene.add(this._routeLine);
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
    this._updateRouteLine();
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
      // Lazy enrich (route/airline) + rebuild the label when airline or logo resolves.
      if (!f._enriched) {
        f._enriched = true;
        enrichRoute(f.callsign).then((r) => {
          f.route = r; f.airline = airlineFor(f.callsign, r);
          if (f.airline.iata) airlineLogo(f.airline.iata);
        });
      }
      // Full HDG/ALT/GS data row for the nearest K and always for the selection;
      // callsign-only beyond that (declutter). Quantise the live values so the
      // canvas only regenerates when a *displayed* value changes — never per-frame.
      const showData = i < DATA_LINE_K || f.id === this.selectedId;
      const lg = f.airline.iata ? airlineLogo(f.airline.iata) : null;
      const logoReady = lg && lg.complete && lg.naturalWidth > 0 ? 1 : 0;
      const fx = f.fix;
      const dsig = !showData ? "none"
        : (fx.onGround ? "GND"
           : `${Math.round((fx.headingDeg || 0) / 5)}|${Math.round((f.world.y * M_TO_FT) / 100)}`
             + `|${Math.round((fx.velMs || 0) * MS_TO_KT / 5)}`
             + `|${Math.abs(fx.vertRateMs || 0) > 0.5 ? Math.sign(fx.vertRateMs) : 0}`);
      const sig = `${f.airline.name}|${logoReady}|${dsig}`;
      if (sig !== f._labelSig) { this._rebuildLabel(f, showData); f._labelSig = sig; }
      f.label.position.set(f.world.x, f.world.y + 220, f.world.z);
      const dist = Math.max(f.dist ?? 1000, 800);
      const worldPerPx = (2 * tanHalf * dist) / hPx;
      const ch = f.label.userData.canvasH || 64;
      const cw = f.label.userData.canvasW || 512;
      const s = ((f.label.userData.screenH || 20) * worldPerPx) / ch;
      f.label.scale.set(cw * s, ch * s, 1);
      f.label.material.opacity = Math.max(0, 1 - dist / 550_000) * f.fade;
    }
  }
}
