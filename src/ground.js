// ground.js — dynamic tile ground that follows the drone for higher detail.
// Tiles: CARTO Positron (low-saturation labeled basemap) — chosen so the
// airspace volume overlays stay the visual focus while Thai city/province
// labels remain readable. Underlying data is still OpenStreetMap.
import * as THREE from "three";
import {
  geoToWorld, worldToGeo,
  lonToTileX, latToTileY, tileXToLon, tileYToLat,
} from "./coords.js";

const TILE_URL = (x, y, z) => {
  const sub = ["a", "b", "c", "d"][(x + y) % 4];
  return `https://${sub}.basemaps.cartocdn.com/light_all/${z}/${x}/${y}.png`;
};

const MINIMAP_TILE_CACHE_MAX = 64;

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
  }

  /** Available presets — exposed for the Settings UI. */
  static qualityPresets() {
    return {
      low:   { baseZoom: 8,  detailZoom: 10, baseRange: 2, detailRange: 2 },
      med:   { baseZoom: 9,  detailZoom: 11, baseRange: 3, detailRange: 2 },
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

    const geo = new THREE.PlaneGeometry(width, height);
    geo.rotateX(-Math.PI / 2);

    const isDetail = z === this.detailZoom;
    const mat = new THREE.MeshBasicMaterial({
      color: 0x2a4a3a,
      depthWrite: true,
      depthTest: true,
      polygonOffset: isDetail,
      polygonOffsetFactor: isDetail ? -2 : 0,
      polygonOffsetUnits: isDetail ? -2 : 0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    const meshY = isDetail ? 0.4 : 0;
    mesh.position.set((nw.x + se.x) / 2, meshY, (nw.z + se.z) / 2);
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
