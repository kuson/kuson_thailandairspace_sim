// coords.js — local-tangent-plane (East-North-Up) conversion centred on Bangkok.
// At a ~300 km radius we treat the plane as flat. Three.js axes: X = East,
// Y = Up (altitude in metres AMSL), Z = North (so we negate Z so south is +Z
// in screen-space — i.e. drone +Z moves you south on the map). We use a
// simple equirectangular projection scaled by the cosine of the reference
// latitude, which is accurate to a fraction of a percent across the area we
// care about.

const R_EARTH = 6378137; // metres (WGS-84 equatorial radius)

export const ORIGIN = { lat: 13.7563, lon: 100.5018 };

const latRefRad = (ORIGIN.lat * Math.PI) / 180;
const COS_LAT_REF = Math.cos(latRefRad);

export const FT_TO_M = 0.3048;
export const M_TO_FT = 1 / FT_TO_M;
export const NM_TO_M = 1852;

/**
 * Convert geographic (lat, lon) in degrees to local world XZ in metres.
 * Returns { x, z } where x is east-positive and z is south-positive.
 * (north is -z in this scene because Three.js' default forward is -z.)
 */
export function geoToWorld(lat, lon) {
  const dLat = (lat - ORIGIN.lat) * (Math.PI / 180);
  const dLon = (lon - ORIGIN.lon) * (Math.PI / 180);
  const x = R_EARTH * dLon * COS_LAT_REF;
  const z = -R_EARTH * dLat;
  return { x, z };
}

/** Reverse: world XZ in metres back to lat/lon in degrees. */
export function worldToGeo(x, z) {
  const dLat = -z / R_EARTH;
  const dLon = x / (R_EARTH * COS_LAT_REF);
  return {
    lat: ORIGIN.lat + (dLat * 180) / Math.PI,
    lon: ORIGIN.lon + (dLon * 180) / Math.PI,
  };
}

/** Slippy map tile X for lon, zoom. */
export function lonToTileX(lon, z) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, z));
}

/** Slippy map tile Y for lat, zoom. */
export function latToTileY(lat, z) {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) *
      Math.pow(2, z)
  );
}

/** West-edge longitude of a slippy tile. */
export function tileXToLon(x, z) {
  return (x / Math.pow(2, z)) * 360 - 180;
}

/** North-edge latitude of a slippy tile. */
export function tileYToLat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/** Format a signed decimal degree value as DMS string. */
export function formatLatLon(lat, lon) {
  const fmt = (v, posChar, negChar) => {
    const sign = v >= 0 ? posChar : negChar;
    const abs = Math.abs(v);
    const deg = Math.floor(abs);
    const minFloat = (abs - deg) * 60;
    const min = Math.floor(minFloat);
    const sec = (minFloat - min) * 60;
    return `${deg}°${String(min).padStart(2, "0")}'${sec.toFixed(1)}"${sign}`;
  };
  return `${fmt(lat, "N", "S")} ${fmt(lon, "E", "W")}`;
}

/** Convert decimal degrees to compass cardinal direction string. */
export function bearingToCompass(bearingDeg) {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const idx = Math.round(((bearingDeg % 360) + 360) % 360 / 45) % 8;
  return dirs[idx];
}
