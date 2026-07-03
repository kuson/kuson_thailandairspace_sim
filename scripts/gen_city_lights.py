#!/usr/bin/env python3
"""Generate per-city night-light point constellations (Betterment-11 §0.5.7-T12).

Reads:
  data/cities.json    — { cities: [{ name, lat, lon, prominence, weight }] }
                         weight is prominence normalised 0..1 (see that file's
                         meta.description for the exact mapping).
  data/airports.json  — { airports: [{ icao, iata, name, lat, lon, prominence }] }

Emits:
  data/cityLightPoints.json — per-city gaussian-scattered point clouds + a
  flat airport point list, consumed by src/cityLights.js at runtime.

Point count per city: N = clamp(round(30 + weight*190), 30, 220).
Scatter: 2D gaussian in local East/North metres around the city centroid,
sigma scaled by city size (bigger city = wider glow footprint):
  sigma_m = lerp(1200, 6000, weight)   # 1.2 km .. 6.0 km
Per-point warm hue jitter: base city hue ±8% (multiplicative on H in HSL).
Per-point size: uniform 2..7 px.
Airports: single brighter, bigger, slightly cooler-hued point per airport
(no scatter — one point per aerodrome reference point).

Determinism: every draw comes from random.Random(SEED), consumed in a fixed
order (cities in data/cities.json array order, points 0..N-1 per city, then
airports in data/airports.json array order). Output is json.dump(...,
sort_keys=True) with floats pre-rounded to a fixed precision, so re-running
this script produces a byte-identical file — no timestamps, no dict-order
reliance, no locale-dependent formatting.

Run: python3 scripts/gen_city_lights.py
Deps: stdlib only.
"""
import json
import math
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IN_CITIES = ROOT / "data" / "cities.json"
IN_AIRPORTS = ROOT / "data" / "airports.json"
OUT = ROOT / "data" / "cityLightPoints.json"

SEED = 20260702

# Same flat-earth approximation as src/coords.js (geoToWorld) — points are
# scattered in local East/North metres around EACH city's own centroid
# (not the scene ORIGIN), then converted back to lat/lon so the JSON stays
# in the same coordinate system as every other data file (cities.json,
# airports.json) and src/cityLights.js can keep calling the existing
# geoToWorld()/elevationAt() pair unchanged (preserves the terrain-relift
# path as-is).
R_EARTH = 6378137.0  # metres (WGS-84 equatorial radius), matches coords.js

# Point-count law: N = clamp(round(30 + weight*190), 30, 220).
N_MIN, N_MAX = 30, 220
N_BASE, N_SPAN = 30, 190

# Gaussian scatter radius (metres), by city weight: 1.2 km (weight=0) to
# 6.0 km (weight=1).
SIGMA_MIN_M, SIGMA_MAX_M = 1200.0, 6000.0

# Per-point size range (px, consumed as gl_PointSize-ish by cityLights.js).
SIZE_MIN_PX, SIZE_MAX_PX = 2.0, 7.0

# Warm city-light base colour (matches the amber CITY_COLOR previously
# hard-coded in src/cityLights.js: 0xffc878), expressed as HSL so per-point
# hue jitter is a simple multiplicative offset in H (computed below, after
# the hex->HSL helper is defined).
CITY_HUE_JITTER = 0.08  # ±8% of hue, multiplicative per playbook wording

# Airports: single brighter point per aerodrome, bigger + slightly cooler.
AIRPORT_SIZE_PX = 8.0
AIRPORT_HUE_SHIFT = 0.06  # shift toward blue-white, fixed (no jitter)

FLOAT_DP = 6  # fixed rounding so re-runs are byte-identical


def _hex_to_hsl(hex_rgb):
    r = ((hex_rgb >> 16) & 0xFF) / 255.0
    g = ((hex_rgb >> 8) & 0xFF) / 255.0
    b = (hex_rgb & 0xFF) / 255.0
    mx, mn = max(r, g, b), min(r, g, b)
    light = (mx + mn) / 2.0
    if mx == mn:
        hue = sat = 0.0
    else:
        d = mx - mn
        sat = d / (2.0 - mx - mn) if light > 0.5 else d / (mx + mn)
        if mx == r:
            hue = (g - b) / d + (6.0 if g < b else 0.0)
        elif mx == g:
            hue = (b - r) / d + 2.0
        else:
            hue = (r - g) / d + 4.0
        hue /= 6.0
    return hue, sat, light


def _hsl_to_rgb(h, s, l):
    if s == 0:
        r = g = b = l
    else:
        def hue2rgb(p, q, t):
            if t < 0:
                t += 1
            if t > 1:
                t -= 1
            if t < 1 / 6:
                return p + (q - p) * 6 * t
            if t < 1 / 2:
                return q
            if t < 2 / 3:
                return p + (q - p) * (2 / 3 - t) * 6
            return p
        q = l * (1 + s) if l < 0.5 else l + s - l * s
        p = 2 * l - q
        r = hue2rgb(p, q, h + 1 / 3)
        g = hue2rgb(p, q, h)
        b = hue2rgb(p, q, h - 1 / 3)
    return r, g, b


# Base city colour, precomputed once (module import time — no RNG involved,
# deterministic regardless of call order).
CITY_HUE, CITY_SAT, CITY_LIGHT = _hex_to_hsl(0xFFC878)
# Airport base colour: existing cooler amber used previously in cityLights.js
# (0xffe0b0-ish neighbourhood) shifted further cool per the playbook's "airports
# stay ... slightly cooler hue" — implemented as a fixed hue shift off the same
# base so airports read as a related but distinct family.
AIRPORT_HUE = (CITY_HUE + AIRPORT_HUE_SHIFT) % 1.0
AIRPORT_SAT = CITY_SAT
AIRPORT_LIGHT = min(1.0, CITY_LIGHT + 0.08)  # brighter, per "brighter points"


def _round(x):
    return round(x, FLOAT_DP)


def _local_offset_to_geo(dx_east_m, dz_south_m, lat, lon):
    """Inverse of coords.js geoToWorld, applied around an arbitrary (lat, lon)
    origin (not the scene ORIGIN) — small-offset scatter around each city
    centroid using the same flat-earth approximation as the runtime code."""
    cos_lat = math.cos(math.radians(lat))
    d_lon_rad = dx_east_m / (R_EARTH * cos_lat)
    d_lat_rad = -dz_south_m / R_EARTH
    return lat + math.degrees(d_lat_rad), lon + math.degrees(d_lon_rad)


def _point_count(weight):
    n = round(N_BASE + weight * N_SPAN)
    return max(N_MIN, min(N_MAX, n))


def main():
    cities_doc = json.loads(IN_CITIES.read_text())
    airports_doc = json.loads(IN_AIRPORTS.read_text())
    cities = cities_doc["cities"]
    airports = airports_doc["airports"]

    rng = random.Random(SEED)  # single stream, consumed in a fixed order

    city_points = []
    total_points = 0
    per_city_stats = []
    for city in cities:
        weight = float(city["weight"])
        n = _point_count(weight)
        sigma_m = SIGMA_MIN_M + (SIGMA_MAX_M - SIGMA_MIN_M) * weight
        pts = []
        for _ in range(n):
            # Box-Muller via random.gauss (stdlib, deterministic given seed).
            dx = rng.gauss(0.0, sigma_m)
            dz = rng.gauss(0.0, sigma_m)
            lat, lon = _local_offset_to_geo(dx, dz, city["lat"], city["lon"])
            hue_jitter = 1.0 + rng.uniform(-CITY_HUE_JITTER, CITY_HUE_JITTER)
            h = (CITY_HUE * hue_jitter) % 1.0
            r, g, b = _hsl_to_rgb(h, CITY_SAT, CITY_LIGHT)
            size_px = rng.uniform(SIZE_MIN_PX, SIZE_MAX_PX)
            pts.append({
                "lat": _round(lat),
                "lon": _round(lon),
                "r": _round(r),
                "g": _round(g),
                "b": _round(b),
                "size": _round(size_px),
            })
        city_points.append({
            "name": city["name"],
            "lat": city["lat"],
            "lon": city["lon"],
            "weight": weight,
            "count": n,
            "points": pts,
        })
        total_points += n
        per_city_stats.append((city["name"], n))

    airport_points = []
    for ap in airports:
        r, g, b = _hsl_to_rgb(AIRPORT_HUE, AIRPORT_SAT, AIRPORT_LIGHT)
        airport_points.append({
            "name": ap["name"],
            "icao": ap.get("icao", ""),
            "lat": ap["lat"],
            "lon": ap["lon"],
            "r": _round(r),
            "g": _round(g),
            "b": _round(b),
            "size": _round(AIRPORT_SIZE_PX),
        })

    doc = {
        "meta": {
            "description": (
                "Per-city gaussian-scattered night-light point constellations "
                "+ single-point airport lights, generated by "
                "scripts/gen_city_lights.py from data/cities.json + "
                "data/airports.json. Deterministic: fixed seed, fixed "
                "iteration order, fixed float rounding — re-running the "
                "generator produces a byte-identical file."
            ),
            "seed": SEED,
            "cityCount": len(city_points),
            "totalCityPoints": total_points,
            "airportCount": len(airport_points),
            "pointCountLaw": "clamp(round(30 + weight*190), 30, 220)",
            "sigmaLawM": "lerp(1200, 6000, weight)",
            "sizeRangePx": [SIZE_MIN_PX, SIZE_MAX_PX],
            "hueJitter": CITY_HUE_JITTER,
        },
        "cities": city_points,
        "airports": airport_points,
    }

    OUT.write_text(
        json.dumps(doc, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
        + "\n"
    )

    print(f"cities: {len(city_points)}")
    counts = [n for _, n in per_city_stats]
    print(f"total city points: {total_points}")
    print(f"per-city min: {min(counts)}  max: {max(counts)}")
    print(f"airports: {len(airport_points)}")
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
