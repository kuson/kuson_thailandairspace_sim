import { geoToWorld as defaultGeoToWorld } from "../coords.js";

/** NW/SE corners of a lat/lon bbox → world-metre axis-aligned bounds. */
export function worldBoundsFromBbox(bbox, geoToWorld = defaultGeoToWorld) {
  const nw = geoToWorld(bbox.lamax, bbox.lomin);
  const se = geoToWorld(bbox.lamin, bbox.lomax);
  return { minX: nw.x, minZ: nw.z, maxX: se.x, maxZ: se.z };
}

export class HeatLayer2D {
  constructor() {
    this._canvas = null;
    this._bounds = null;
    this._opacity = 1;
  }

  setOpacity(n) {
    this._opacity = Math.max(0, Math.min(1, n));
  }

  // Bake row0=south (lamin); store south-first via putImageData (ignores transforms).
  // North-up display applies translate+scale(1,-1) at blit time in draw().
  setImageData(imageData, meta) {
    if (!imageData || !meta) {
      this.clear();
      return;
    }
    const { cols, rows, lamin, lomin, lamax, lomax } = meta;
    if (!this._canvas) {
      this._canvas = document.createElement("canvas");
    }
    this._canvas.width = cols;
    this._canvas.height = rows;
    const ctx = this._canvas.getContext("2d");
    ctx.clearRect(0, 0, cols, rows);
    ctx.putImageData(imageData, 0, 0);
    this._bounds = worldBoundsFromBbox({ lamin, lomin, lamax, lomax });
  }

  clear() {
    this._canvas = null;
    this._bounds = null;
  }

  draw(ctx, { cx, cy, wx, wz, scale }) {
    if (!this._canvas || !this._bounds) return;
    const { minX, minZ, maxX, maxZ } = this._bounds;
    const px = cx + (minX - wx) / scale;
    const py = cy + (minZ - wz) / scale;
    const pw = (maxX - minX) / scale;
    const ph = (maxZ - minZ) / scale;
    ctx.save();
    ctx.globalAlpha = this._opacity;
    ctx.translate(px, py + ph);
    ctx.scale(1, -1);
    ctx.drawImage(this._canvas, 0, 0, pw, ph);
    ctx.restore();
  }
}

/** Bake row index (south-first) → north-up blit row (0 = top). */
export function bakeRowToNorthUpRow(bakeRow, rows) {
  return rows - 1 - bakeRow;
}
