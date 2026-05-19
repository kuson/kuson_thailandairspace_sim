// geocode.js — reverse geocode lat/lon → Amphoe + Province via Nominatim (cached, throttled).

const CACHE = new Map();
const MIN_INTERVAL_MS = 1100;
let lastRequestAt = 0;
let pending = null;

function cacheKey(lat, lon) {
  // ~100 m grid — good enough for admin labels while moving fast.
  return `${lat.toFixed(3)},${lon.toFixed(3)}`;
}

function pickAmphoe(data) {
  const a = data?.address;
  if (!a) return null;
  return (
    a.city_district ||
    a.district ||
    a.county ||
    a.suburb ||
    a.town ||
    a.village ||
    a.municipality ||
    null
  );
}

function pickProvince(data) {
  const a = data?.address;
  if (!a) return null;
  return a.state || a.province || a.region || null;
}

/**
 * Reverse-geocode. Returns cached result immediately when available;
 * otherwise fetches (max ~1 req/s) and calls onUpdate when done.
 */
export function lookupAdmin(lat, lon, onUpdate) {
  const key = cacheKey(lat, lon);
  if (CACHE.has(key)) {
    return CACHE.get(key);
  }

  const now = Date.now();
  const run = () => {
    lastRequestAt = Date.now();
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}` +
      `&zoom=10&accept-language=en`;
    fetch(url, { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const amphoe = pickAmphoe(data);
        const province = pickProvince(data);
        const result = {
          amphoe: amphoe || "—",
          province: province || "—",
          label: amphoe && province ? `${amphoe}, ${province}` : (amphoe || province || "—"),
        };
        CACHE.set(key, result);
        onUpdate?.(result);
      })
      .catch(() => {
        const fallback = { amphoe: "—", province: "—", label: "—" };
        CACHE.set(key, fallback);
        onUpdate?.(fallback);
      });
  };

  if (now - lastRequestAt >= MIN_INTERVAL_MS) {
    run();
  } else if (!pending) {
    pending = setTimeout(() => {
      pending = null;
      run();
    }, MIN_INTERVAL_MS - (now - lastRequestAt));
  }

  return null;
}
