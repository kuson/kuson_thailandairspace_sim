// flightEnrich.js — lazy, cached flight metadata (Betterment-4.1 §12.5).
//
// ADS-B carries no airline name, route, or schedule. We enrich on demand:
//   - route + airline   ← adsbdb (free, CORS-OK): origin/dest AIRPORTS + airline.
//                          NO scheduled times exist; we compute a live ETA instead.
//   - airline (fallback) ← a bundled ICAO-prefix table, so a name shows even when
//                          adsbdb has no route for the callsign.
//   - airline logo       ← avs.io CDN by IATA, cached <img>; null → caller draws a chip.
//   - aircraft photo     ← planespotters by hex, BEST-EFFORT (public photo APIs are
//                          flaky); caller shows a placeholder when absent.
//
// Everything is cached (incl. negative results) and de-duped, and is only ever
// called for flights the user lists / labels / selects — never the whole fleet.

const NM_PER_M = 1 / 1852;
const EARTH_NM = 3440.065;

// ICAO airline-code → {name, iata}. Fallback when adsbdb has no route. Covers the
// carriers common over Thailand + major long-haul. Extend freely.
const AIRLINE_BY_ICAO = {
  THA: { name: "Thai Airways", iata: "TG" }, AIQ: { name: "Thai AirAsia", iata: "FD" },
  TVJ: { name: "Thai Vietjet", iata: "VZ" }, BKP: { name: "Bangkok Airways", iata: "PG" },
  NOK: { name: "Nok Air", iata: "DD" }, TLM: { name: "Thai Lion Air", iata: "SL" },
  THD: { name: "Thai AirAsia X", iata: "XJ" }, SIA: { name: "Singapore Airlines", iata: "SQ" },
  TGW: { name: "Scoot", iata: "TR" }, UAE: { name: "Emirates", iata: "EK" },
  QTR: { name: "Qatar Airways", iata: "QR" }, ETD: { name: "Etihad", iata: "EY" },
  CPA: { name: "Cathay Pacific", iata: "CX" }, CAL: { name: "China Airlines", iata: "CI" },
  EVA: { name: "EVA Air", iata: "BR" }, SJX: { name: "Starlux", iata: "JX" },
  ANA: { name: "All Nippon Airways", iata: "NH" }, JAL: { name: "Japan Airlines", iata: "JL" },
  KAL: { name: "Korean Air", iata: "KE" }, AAR: { name: "Asiana", iata: "OZ" },
  CCA: { name: "Air China", iata: "CA" }, CES: { name: "China Eastern", iata: "MU" },
  CSN: { name: "China Southern", iata: "CZ" }, HVN: { name: "Vietnam Airlines", iata: "VN" },
  MAS: { name: "Malaysia Airlines", iata: "MH" }, AXM: { name: "AirAsia", iata: "AK" },
  GIA: { name: "Garuda Indonesia", iata: "GA" }, LNI: { name: "Lion Air", iata: "JT" },
  CEB: { name: "Cebu Pacific", iata: "5J" }, PAL: { name: "Philippine Airlines", iata: "PR" },
  THY: { name: "Turkish Airlines", iata: "TK" }, DLH: { name: "Lufthansa", iata: "LH" },
  BAW: { name: "British Airways", iata: "BA" }, AFR: { name: "Air France", iata: "AF" },
  KLM: { name: "KLM", iata: "KL" }, SWR: { name: "Swiss", iata: "LX" },
  QFA: { name: "Qantas", iata: "QF" }, UAL: { name: "United", iata: "UA" },
  FDX: { name: "FedEx", iata: "FX" }, UPS: { name: "UPS", iata: "5X" },
};

// ---------------- route + airline (adsbdb) ----------------

const _routeCache = new Map();   // callsign → {airline,origin,dest} | null | Promise

function _normCs(callsign) { return (callsign || "").trim().toUpperCase(); }

/** Airline {name, iata, icao} from a resolved route or the prefix table. */
export function airlineFor(callsign, route) {
  if (route?.airline?.name) {
    return { name: route.airline.name, iata: route.airline.iata || null, icao: route.airline.icao || null };
  }
  const cs = _normCs(callsign);
  const icao = cs.slice(0, 3);
  const a = AIRLINE_BY_ICAO[icao];
  return a ? { name: a.name, iata: a.iata, icao } : { name: icao || "—", iata: null, icao: icao || null };
}

/**
 * Resolve a callsign → { airline:{name,iata,icao}, origin:{iata,icao,name,lat,lon},
 * dest:{...} } | null. Cached (incl. null) + in-flight de-duped. Never throws.
 */
export function enrichRoute(callsign) {
  const cs = _normCs(callsign);
  if (!cs) return Promise.resolve(null);
  const cached = _routeCache.get(cs);
  if (cached !== undefined) return Promise.resolve(cached);
  const p = (async () => {
    try {
      const r = await fetch(`https://api.adsbdb.com/v0/callsign/${cs}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const fr = (await r.json())?.response?.flightroute;
      if (!fr) { _routeCache.set(cs, null); return null; }
      const ap = (a) => a ? { iata: a.iata_code, icao: a.icao_code, name: a.name, municipality: a.municipality, country: a.country_name, lat: a.latitude, lon: a.longitude } : null;
      const out = { airline: fr.airline || null, origin: ap(fr.origin), dest: ap(fr.destination) };
      _routeCache.set(cs, out);
      return out;
    } catch (err) {
      console.warn("[liveflights] route", cs, err);
      _routeCache.set(cs, null);   // negative-cache so we don't hammer the API
      return null;
    }
  })();
  _routeCache.set(cs, p);
  // replace the stored promise with its resolved value
  p.then((v) => { if (_routeCache.get(cs) === p) _routeCache.set(cs, v); });
  return p;
}

/** Synchronous peek — returns resolved route, or undefined if not yet fetched. */
export function routePeek(callsign) {
  const v = _routeCache.get(_normCs(callsign));
  return (v && typeof v.then === "function") ? undefined : v;
}

// ---------------- live ETA ----------------

function _haversineNm(lat1, lon1, lat2, lon2) {
  const toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_NM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Live ETA from current position → destination airport, using groundspeed.
 * Returns { distNm, minsRemaining, etaEpoch } or null if no dest / too slow.
 */
export function etaFor(fix, dest) {
  if (!dest || dest.lat == null || dest.lon == null) return null;
  const gsKt = (fix.velMs || 0) * 1.94384;
  if (gsKt < 40) return null;   // taxiing / stationary — no meaningful ETA
  const distNm = _haversineNm(fix.lat, fix.lon, dest.lat, dest.lon);
  const hours = distNm / gsKt;
  const mins = Math.round(hours * 60);
  return { distNm, minsRemaining: mins, etaEpoch: Date.now() + mins * 60000 };
}

export function fmtEta(eta) {
  if (!eta) return "";
  const hh = Math.floor(eta.minsRemaining / 60), mm = eta.minsRemaining % 60;
  const clock = new Date(eta.etaEpoch).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `ETA ${clock} (${hh ? hh + "h" : ""}${mm}m · ${Math.round(eta.distNm)} NM)`;
}

// ---------------- airline logo (avs.io, cached <img>) ----------------

const _logoCache = new Map();   // iata → HTMLImageElement | null

/** Cached airline logo <img> by IATA (avs.io). Returns null when unavailable. */
export function airlineLogo(iata) {
  if (!iata) return null;
  const key = iata.toUpperCase();
  if (_logoCache.has(key)) return _logoCache.get(key);
  const img = new Image();
  img.crossOrigin = "anonymous";   // allow drawing into a canvas
  img.onerror = () => _logoCache.set(key, null);
  img.src = `https://pics.avs.io/120/120/${key}.png`;
  _logoCache.set(key, img);
  return img;
}

// Deterministic brand-ish chip colour from a string (logo fallback).
export function chipColor(text) {
  let h = 0;
  for (let i = 0; i < (text || "").length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 55%, 42%)`;
}

// Shared altitude→colour ramp (metres in). One source of truth so radar blips
// and aircraft labels always agree at a glance. low→high: cyan→green→amber→pink.
export function altColor(altM) {
  const ft = (altM || 0) * 3.28084;
  if (ft < 10000) return "#33d6ff";
  if (ft < 24000) return "#5dff8a";
  if (ft < 35000) return "#ffe14a";
  return "#ff7ad9";
}

// ---------------- aircraft photo (best-effort) ----------------

const _photoCache = new Map();   // hex → {thumb,link} | null | Promise

/** Best-effort aircraft photo by ICAO24 hex (planespotters). Cached; never throws. */
export function aircraftPhoto(hex) {
  if (!hex) return Promise.resolve(null);
  const cached = _photoCache.get(hex);
  if (cached !== undefined) return Promise.resolve(cached);
  const p = (async () => {
    try {
      const r = await fetch(`https://api.planespotters.net/pubapi/v1/photos/hex/${hex}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const ph = (await r.json())?.photos?.[0];
      const out = ph ? { thumb: ph.thumbnail_large?.src || ph.thumbnail?.src, link: ph.link, by: ph.photographer } : null;
      _photoCache.set(hex, out);
      return out;
    } catch { _photoCache.set(hex, null); return null; }
  })();
  _photoCache.set(hex, p);
  p.then((v) => { if (_photoCache.get(hex) === p) _photoCache.set(hex, v); });
  return p;
}
