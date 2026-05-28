#!/usr/bin/env python3
"""Bake AWS Terrain Tiles into a compact elevation grid for Thailand.

Source: https://registry.opendata.aws/terrain-tiles/ (Mapzen "Terrarium").
Pixel encoding: elevation_m = (R*256 + G + B/256) - 32768

Output:
  data/terrain.bin  — little-endian Uint16 row-major grid, rows×cols,
                       elevation in metres clamped to [0, 65535].
                       Row 0 = southernmost (lat0 = 5.6°N).
                       Col 0 = westernmost (lon0 = 97.3°E).
  data/terrain.json — { rows, cols, lat0, lon0, dLat, dLon, sourceZoom, ... }

Re-runs incrementally; tiles cached in scripts/.terrain_cache/.

Run: python3 scripts/bake_terrain.py
Deps: pip install --user --break-system-packages Pillow requests
"""
import json
import math
import time
from pathlib import Path

from PIL import Image
import requests

ROOT = Path(__file__).resolve().parents[1]
CACHE_DIR = ROOT / "scripts" / ".terrain_cache"
OUT_BIN = ROOT / "data" / "terrain.bin"
OUT_JSON = ROOT / "data" / "terrain.json"

# Coverage box per playbook P4.T4.
LAT_MIN, LAT_MAX = 5.6, 20.5
LON_MIN, LON_MAX = 97.3, 105.7

# Output spacing: 30 arc-sec = 1/120 degree.
ARCSEC = 1 / 120

# Source zoom. z=10 gives ~150m/pixel — fine enough to preserve sharp
# peaks like Doi Inthanon (2 565 m) to within ~1 % under bilinear
# resampling to the 30 arc-sec (~925m) output grid. z=8 was tried first
# and smoothed the Doi Inthanon summit to ~2 500 m, missing the P4.T4
# pass criterion by ~60 m AGL.
ZOOM = 10
TILE_SIZE = 256
SOURCE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
USER_AGENT = "kuson-thailandairspace-sim/p4t4 (educational simulator)"


def lonlat_to_pixel(lon, lat, z):
    """Web Mercator. Returns fractional global pixel (x, y) at zoom z."""
    n = (2 ** z) * TILE_SIZE
    x = (lon + 180.0) / 360.0 * n
    sin_lat = math.sin(math.radians(lat))
    y = (0.5 - math.log((1 + sin_lat) / (1 - sin_lat)) / (4 * math.pi)) * n
    return x, y


def fetch_tile(z, x, y, session, retries=3):
    path = CACHE_DIR / f"{z}_{x}_{y}.png"
    if path.exists() and path.stat().st_size > 0:
        return path
    url = SOURCE_URL.format(z=z, x=x, y=y)
    last_err = None
    for attempt in range(retries):
        try:
            r = session.get(url, timeout=30)
            if r.status_code == 200:
                path.write_bytes(r.content)
                return path
            last_err = f"HTTP {r.status_code}"
        except Exception as e:
            last_err = str(e)
        time.sleep(0.5 * (attempt + 1))
    raise RuntimeError(f"failed to fetch {url}: {last_err}")


def decode_terrarium(px):
    r, g, b = px[0], px[1], px[2]
    return (r * 256 + g + b / 256.0) - 32768.0


def main():
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    OUT_BIN.parent.mkdir(parents=True, exist_ok=True)

    rows = round((LAT_MAX - LAT_MIN) / ARCSEC)
    cols = round((LON_MAX - LON_MIN) / ARCSEC)
    print(f"Output grid: {rows} rows × {cols} cols "
          f"= {rows*cols} cells ({rows*cols*2/1e6:.2f} MB)")
    print(f"Source zoom: {ZOOM}")

    # Pre-compute the tile range we need (with 1-tile padding so the
    # bilinear stencil never reads across an unfetched edge).
    px_min, py_max = lonlat_to_pixel(LON_MIN, LAT_MIN, ZOOM)
    px_max, py_min = lonlat_to_pixel(LON_MAX, LAT_MAX, ZOOM)
    tx_min = int(math.floor(px_min / TILE_SIZE)) - 1
    tx_max = int(math.floor(px_max / TILE_SIZE)) + 1
    ty_min = int(math.floor(py_min / TILE_SIZE)) - 1
    ty_max = int(math.floor(py_max / TILE_SIZE)) + 1
    tiles = [(tx, ty) for tx in range(tx_min, tx_max + 1)
                       for ty in range(ty_min, ty_max + 1)]
    print(f"Tiles to fetch: {len(tiles)} "
          f"(x={tx_min}..{tx_max}, y={ty_min}..{ty_max})")

    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT
    tile_pixels = {}
    for i, (tx, ty) in enumerate(tiles):
        path = fetch_tile(ZOOM, tx, ty, session)
        img = Image.open(path).convert("RGB")
        # Convert to a flat tuple-per-pixel array; PIL's .load() is fast.
        tile_pixels[(tx, ty)] = img.load()
        if (i + 1) % 10 == 0 or i + 1 == len(tiles):
            print(f"  fetched {i+1}/{len(tiles)}")

    print("Sampling grid...")
    buf = bytearray(rows * cols * 2)

    def sample(lon, lat):
        px, py = lonlat_to_pixel(lon, lat, ZOOM)
        x0 = int(math.floor(px))
        y0 = int(math.floor(py))
        fx = px - x0
        fy = py - y0
        def get(gx, gy):
            tx = gx // TILE_SIZE
            ty = gy // TILE_SIZE
            tile = tile_pixels.get((tx, ty))
            if tile is None:
                return 0.0
            return decode_terrarium(tile[gx - tx * TILE_SIZE,
                                         gy - ty * TILE_SIZE])
        e00 = get(x0,     y0)
        e10 = get(x0 + 1, y0)
        e01 = get(x0,     y0 + 1)
        e11 = get(x0 + 1, y0 + 1)
        return ((e00 * (1 - fx) + e10 * fx) * (1 - fy) +
                (e01 * (1 - fx) + e11 * fx) * fy)

    for r in range(rows):
        lat = LAT_MIN + r * ARCSEC
        for c in range(cols):
            lon = LON_MIN + c * ARCSEC
            e = sample(lon, lat)
            v = max(0, min(65535, int(round(e))))
            i = (r * cols + c) * 2
            buf[i] = v & 0xFF
            buf[i + 1] = (v >> 8) & 0xFF
        if (r + 1) % 200 == 0 or r + 1 == rows:
            print(f"  row {r+1}/{rows}")

    OUT_BIN.write_bytes(buf)
    meta = {
        "rows": rows, "cols": cols,
        "lat0": LAT_MIN, "lon0": LON_MIN,
        "dLat": ARCSEC, "dLon": ARCSEC,
        "sourceZoom": ZOOM,
        "encoding": "uint16-le-metres",
        "rowOrder": "south-to-north",
        "colOrder": "west-to-east",
        "coverage": {"latMin": LAT_MIN, "latMax": LAT_MAX,
                     "lonMin": LON_MIN, "lonMax": LON_MAX},
        "attribution": "AWS Terrain Tiles (Mapzen Terrarium)",
    }
    OUT_JSON.write_text(json.dumps(meta, indent=2))
    print(f"Wrote {OUT_BIN} ({OUT_BIN.stat().st_size} bytes)")
    print(f"Wrote {OUT_JSON}")


if __name__ == "__main__":
    main()
