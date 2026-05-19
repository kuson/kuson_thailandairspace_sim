// geolocation.js — browser GPS for startup position (with Thailand bounds check).
import { ORIGIN } from "./coords.js";

const TH_BOUNDS = { latMin: 5.0, latMax: 21.0, lonMin: 97.0, lonMax: 106.5 };

function inThailand(lat, lon) {
  return lat >= TH_BOUNDS.latMin && lat <= TH_BOUNDS.latMax &&
    lon >= TH_BOUNDS.lonMin && lon <= TH_BOUNDS.lonMax;
}

/**
 * Resolve startup lat/lon from browser geolocation when permitted.
 * Falls back to Bangkok ORIGIN if denied, unavailable, or outside Thailand.
 */
export function getStartLocation() {
  return new Promise((resolve) => {
    const fallback = () => resolve({
      lat: ORIGIN.lat,
      lon: ORIGIN.lon,
      altM: 200,
      source: "default",
    });

    if (!navigator.geolocation) {
      fallback();
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        if (!inThailand(lat, lon)) {
          fallback();
          return;
        }
        const altM = Number.isFinite(pos.coords.altitude)
          ? Math.max(pos.coords.altitude, 50)
          : 200;
        resolve({ lat, lon, altM, source: "gps" });
      },
      () => fallback(),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 120_000 },
    );
  });
}
