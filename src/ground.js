// ground.js — dynamic tile ground that follows the drone for higher detail.
// Tiles: CARTO Voyager (colourful, blue-water, higher-detail basemap;
// Betterment-3, operator: "higher contrast, MUCH more detailed, make it pop").
// Replaced the old low-saturation Positron style; the app draws its own
// city/province/airspace labels on top, so a richer basemap adds contrast
// without losing legibility. Underlying data is still OpenStreetMap.
import * as THREE from "three";
import {
  geoToWorld, worldToGeo,
  lonToTileX, latToTileY, tileXToLon, tileYToLat,
} from "./coords.js";
import { elevationAt } from "./terrain.js";

// Single source of truth for the basemap style — one-word switchable (e.g. to
// "rastertiles/voyager" → satellite imagery) without touching the URL builder.
const BASEMAP_STYLE = "rastertiles/voyager";
const TILE_URL = (x, y, z) => {
  const sub = ["a", "b", "c", "d"][(x + y) % 4];
  return `https://${sub}.basemaps.cartocdn.com/${BASEMAP_STYLE}/${z}/${x}/${y}.png`;
};

// The minimap underlay draws an 11×11 (=121) tile grid each frame
// (tileRadius 5 in _drawMapUnderlay). The cache MUST hold more than that
// working set, or every tile load evicts a still-visible tile (FIFO),
// the visible subset rotates frame-to-frame, and the radar flickers.
// 256 covers the 121-tile window plus panning headroom (~3–8 MB of small
// CARTO PNGs).
const MINIMAP_TILE_CACHE_MAX = 256;

// B10.T2 terrain relief — tile grid segmentation for CPU displacement at
// build time. The visual mesh samples the same elevationAt() bilinear grid
// that crawlers / shadow blobs / AGL use, so entities and ground agree
// exactly. z11 detail tile ≈ 19.6 km → ~815 m/quad at 24 segs (matches the
// 30″ ≈ 925 m bake); z9 base tile ≈ 78 km → ~3.2 km/quad background relief.
// Shared tile edges sample identical world coordinates → bilinear
// continuity → no cracks between same-zoom neighbours.
const SEGS_DETAIL = 24;
const SEGS_BASE = 24;

// B10.T6 water shimmer — ONE uniforms object shared by every tile material
// (uTime ticked once per frame from the main loop via tickWater; uWaterOn is
// the runtime gate — toggling never recompiles, the uGlowOn precedent).
const WATER_UNIFORMS = {
  uTime:    { value: 0 },
  uWaterOn: { value: 1 },
};

// Fragment chunk: on sea fragments (aSea=1 from the T2 displacement loop) mix
// the texel toward deep Gulf blue and add two crossing sine-band brightness
// modulations (combined amplitude ≤ 0.05, periods ~80 m and ~210 m, scrolled
// by uTime). Land fragments (vSea=0) and uWaterOn=0 take the early-out —
// output mathematically identical to pre-B10.
const WATER_FRAG_CODE = `
{
  float sea = vSea * uWaterOn;
  if (sea > 0.001) {
    vec3 deep = vec3(0.012, 0.10, 0.26);
    diffuseColor.rgb = mix(diffuseColor.rgb, deep, 0.45 * sea);
    float b1 = sin(dot(vWaterWorld.xz, vec2(0.55, 0.83)) * 0.0785 + uTime * 0.9);
    float b2 = sin(dot(vWaterWorld.xz, vec2(0.91, -0.41)) * 0.0299 - uTime * 0.45);
    diffuseColor.rgb *= 1.0 + (b1 * 0.03 + b2 * 0.02) * sea;
  }
}`;

// onBeforeCompile injector for tile materials. customProgramCacheKey is a
// CONSTANT string for all tiles (B8.T9 lesson) → exactly one extra shader
// program per map-state instead of one per material.
function applyWaterShader(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = WATER_UNIFORMS.uTime;
    shader.uniforms.uWaterOn = WATER_UNIFORMS.uWaterOn;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>",
        "#include <common>\nattribute float aSea;\nvarying float vSea;\nvarying vec3 vWaterWorld;")
      .replace("#include <begin_vertex>",
        "#include <begin_vertex>\n\tvSea = aSea;\n\tvWaterWorld = (modelMatrix * vec4(position, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>",
        "#include <common>\nvarying float vSea;\nvarying vec3 vWaterWorld;\nuniform float uTime;\nuniform float uWaterOn;")
      .replace("#include <map_fragment>",
        "#include <map_fragment>\n" + WATER_FRAG_CODE);
  };
  mat.customProgramCacheKey = () => "groundtile-water1";
  return mat;
}

export class DynamicGround {
  /**
   * @param {object} opts
   * @param {number} opts.baseZoom — wide underlay (lower detail)
   * @param {number} opts.detailZoom — tiles centred on drone (higher detail)
   * @param {number} opts.baseRange — ±N base tiles around drone
   * @param {number} opts.detailRange — ±N detail tiles around drone
   */
  constructor({ baseZoom = 9, detailZoom = 11, baseRange = 3, detailRange = 2 } = {}) {
    this.baseZoom = baseZoom;
    this.detailZoom = detailZoom;
    this.baseRange = baseRange;
    this.detailRange = detailRange;
    this.group = new THREE.Group();
    this._tiles = new Map(); // key "z/x/y" → mesh
    this._loader = new THREE.TextureLoader();
    this._loader.setCrossOrigin("anonymous");
    this._lastDetail = { tx: NaN, ty: NaN };
    this._lastBase = { tx: NaN, ty: NaN };
    this._fallbackPlane = null;
    this.qualityMode = "med";   // matches the default args
    this._autoApplied = null;
    // B10.T2: kuson.grounddetail.v1.terrain — main.js sets this from
    // persistence before any tiles build. OFF ⇒ 1×1 flat tiles,
    // byte-identical to pre-B10 geometry.
    this.terrainEnabled = true;
    this._lastWorld = null;     // last updateAround() position, for rebuilds
  }

  /** Available presets — exposed for the Settings UI. */
  static qualityPresets() {
    return {
      // Betterment-2 P4.T2 (E3 "ground doesn't look detailed"): bump the
      // default Medium detail tiles z11→z12 for crisper streets/coastline.
      low:   { baseZoom: 8,  detailZoom: 10, baseRange: 2, detailRange: 2 },
      med:   { baseZoom: 9,  detailZoom: 12, baseRange: 3, detailRange: 2 },
      high:  { baseZoom: 10, detailZoom: 12, baseRange: 3, detailRange: 3 },
      ultra: { baseZoom: 10, detailZoom: 13, baseRange: 4, detailRange: 4 },
    };
  }

  _clearTiles() {
    for (const [k, entry] of this._tiles) {
      this.group.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      if (entry.mesh.material.map) entry.mesh.material.map.dispose();
      entry.mesh.material.dispose();
      this._tiles.delete(k);
    }
    this._lastBase = { tx: NaN, ty: NaN };
    this._lastDetail = { tx: NaN, ty: NaN };
  }

  /** Apply a quality preset by name (low/med/high/ultra/auto). */
  setQuality(modeName) {
    this.qualityMode = modeName;
    if (modeName === "auto") return;     // auto picks per-altitude inside setAltitude
    const presets = DynamicGround.qualityPresets();
    const next = presets[modeName] ?? presets.med;
    Object.assign(this, next);
    this._clearTiles();
  }

  /** AUTO mode hook: switch detail by altitude. */
  setAltitude(meters) {
    if (this.qualityMode !== "auto") return;
    const target = meters < 500 ? "high"
                 : meters < 3000 ? "med"
                 : "low";
    if (this._autoApplied === target) return;
    this._autoApplied = target;
    const presets = DynamicGround.qualityPresets();
    Object.assign(this, presets[target]);
    this._clearTiles();
  }

  _key(z, x, y) {
    return `${z}/${x}/${y}`;
  }

  _buildMesh(x, y, z) {
    const lonW = tileXToLon(x, z);
    const lonE = tileXToLon(x + 1, z);
    const latN = tileYToLat(y, z);
    const latS = tileYToLat(y + 1, z);
    const nw = geoToWorld(latN, lonW);
    const se = geoToWorld(latS, lonE);
    const width = se.x - nw.x;
    const height = se.z - nw.z;
    const cx = (nw.x + se.x) / 2;
    const cz = (nw.z + se.z) / 2;

    const isDetail = z === this.detailZoom;
    const segs = this.terrainEnabled ? (isDetail ? SEGS_DETAIL : SEGS_BASE) : 1;
    const geo = segs > 1
      ? new THREE.PlaneGeometry(width, height, segs, segs)
      : new THREE.PlaneGeometry(width, height);
    geo.rotateX(-Math.PI / 2);

    if (segs > 1) {
      // CPU displacement: vertex local + mesh centre → geo → elevation.
      // Before loadTerrain resolves elevationAt returns 0 (flat tiles);
      // onTerrainReady() rebuilds the live set once when the grid arrives.
      const pos = geo.attributes.position;
      const n = pos.count;
      const sea = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const g = worldToGeo(pos.getX(i) + cx, pos.getZ(i) + cz);
        const elev = elevationAt(g.lat, g.lon);
        pos.setY(i, elev);
        sea[i] = elev <= 0.5 ? 1.0 : 0.0;   // consumed by the water shader (B10.T6)
      }
      geo.setAttribute("aSea", new THREE.BufferAttribute(sea, 1));
      geo.computeVertexNormals();
    }
    const mat = new THREE.MeshBasicMaterial({
      // Deep-ocean placeholder while the tile texture streams in (was a dark
      // green that flashed over water); replaced by the texture on load.
      color: 0x10416e,
      depthWrite: true,
      depthTest: true,
      polygonOffset: isDetail,
      polygonOffsetFactor: isDetail ? -2 : 0,
      polygonOffsetUnits: isDetail ? -2 : 0,
    });
    // B10.T6: sea-shimmer inject (gated by uWaterOn + the aSea attribute;
    // tiles without aSea — terrain OFF — read attribute default 0 = land).
    applyWaterShader(mat);
    const mesh = new THREE.Mesh(geo, mat);
    const meshY = isDetail ? 0.4 : 0;
    mesh.position.set(cx, meshY, cz);
    mesh.renderOrder = isDetail ? 2 : 0;

    this._loader.load(
      TILE_URL(x, y, z),
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        mat.map = t;
        mat.color.setHex(0xffffff);
        mat.needsUpdate = true;
      },
      undefined,
      () => { /* keep procedural fallback */ }
    );

    return mesh;
  }

  _ensureTile(z, x, y) {
    const k = this._key(z, x, y);
    if (this._tiles.has(k)) return;
    const mesh = this._buildMesh(x, y, z);
    this._tiles.set(k, { mesh, z, x, y });
    this.group.add(mesh);
  }

  /** Wide colour fallback under tiles — follows the drone. */
  setFallbackPlane(mesh) {
    this._fallbackPlane = mesh;
  }

  /**
   * B10.T2: called by main.js once loadTerrain resolves. Tiles built before
   * the grid arrived displaced to elevation 0 (flat) — drop and rebuild the
   * live set once; tiles built after readiness displace at build time.
   */
  onTerrainReady() {
    this._rebuildTiles();
  }

  /** B10.T2: terrain relief toggle (kuson.grounddetail.v1.terrain). */
  setTerrainEnabled(on) {
    on = !!on;
    if (on === this.terrainEnabled) return;
    this.terrainEnabled = on;
    this._rebuildTiles();
  }

  /**
   * B10.T6: advance the shared water clock — called once per frame from the
   * main loop, so the shimmer scrolls only while the tab actually renders.
   */
  tickWater(dt) {
    WATER_UNIFORMS.uTime.value += dt;
  }

  /** B10.T6: water shimmer toggle (kuson.grounddetail.v1.water). Uniform
   *  gate only — no rebuild, no recompile (uGlowOn precedent). */
  setWaterEnabled(on) {
    WATER_UNIFORMS.uWaterOn.value = on ? 1 : 0;
  }

  _rebuildTiles() {
    this._clearTiles();
    if (this._lastWorld) this.updateAround(this._lastWorld.x, this._lastWorld.z);
  }

  _pruneZoom(zoom, centerTx, centerTy, range) {
    const keep = new Set();
    for (let dy = -range; dy <= range; dy++) {
      for (let dx = -range; dx <= range; dx++) {
        keep.add(this._key(zoom, centerTx + dx, centerTy + dy));
      }
    }
    for (const [k, entry] of this._tiles) {
      if (entry.z !== zoom) continue;
      if (keep.has(k)) continue;
      this.group.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      if (entry.mesh.material.map) entry.mesh.material.map.dispose();
      entry.mesh.material.dispose();
      this._tiles.delete(k);
    }
  }

  /** Call each frame (or when drone moves > half a tile). */
  updateAround(worldX, worldZ) {
    if (this._lastWorld) { this._lastWorld.x = worldX; this._lastWorld.z = worldZ; }
    else this._lastWorld = { x: worldX, z: worldZ };
    const geo = worldToGeo(worldX, worldZ);

    if (this._fallbackPlane) {
      this._fallbackPlane.position.set(worldX, -8, worldZ);
    }

    const btx = lonToTileX(geo.lon, this.baseZoom);
    const bty = latToTileY(geo.lat, this.baseZoom);
    if (btx !== this._lastBase.tx || bty !== this._lastBase.ty) {
      this._lastBase = { tx: btx, ty: bty };
      for (let dy = -this.baseRange; dy <= this.baseRange; dy++) {
        for (let dx = -this.baseRange; dx <= this.baseRange; dx++) {
          this._ensureTile(this.baseZoom, btx + dx, bty + dy);
        }
      }
      this._pruneZoom(this.baseZoom, btx, bty, this.baseRange);
    }

    const tx = lonToTileX(geo.lon, this.detailZoom);
    const ty = latToTileY(geo.lat, this.detailZoom);
    if (tx === this._lastDetail.tx && ty === this._lastDetail.ty) return;
    this._lastDetail = { tx, ty };

    for (let dy = -this.detailRange; dy <= this.detailRange; dy++) {
      for (let dx = -this.detailRange; dx <= this.detailRange; dx++) {
        this._ensureTile(this.detailZoom, tx + dx, ty + dy);
      }
    }
    this._pruneZoom(this.detailZoom, tx, ty, this.detailRange);
  }
}

/** Fetch basemap tiles (Carto Positron) for 2D canvas use (minimap underlay). */
export class MinimapTileCache {
  constructor(zoom = 7) {
    this.zoom = zoom;
    this._cache = new Map();
    this._pending = new Set();
  }

  _key(x, y) {
    return `${x},${y}`;
  }

  getTile(x, y) {
    const k = this._key(x, y);
    if (this._cache.has(k)) return this._cache.get(k);
    if (this._pending.has(k)) return null;

    const img = new Image();
    img.crossOrigin = "anonymous";
    this._pending.add(k);
    img.onload = () => {
      this._pending.delete(k);
      this._cache.set(k, img);
      while (this._cache.size > MINIMAP_TILE_CACHE_MAX) {
        const oldest = this._cache.keys().next().value;
        this._cache.delete(oldest);
      }
    };
    img.onerror = () => this._pending.delete(k);
    img.src = TILE_URL(x, y, this.zoom);
    return null;
  }
}
