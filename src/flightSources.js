// flightSources.js — pluggable live ADS-B data sources (Betterment-4 §12.2).
//
// One interface, several adapters, one normaliser. Every adapter resolves to a
// common `NormalizedFlight` shape so the renderer (liveFlights.js) never sees
// provider-specific schemas.
//
//   NormalizedFlight = {
//     id,            // ICAO24 hex — stable key
//     callsign,      // trimmed flight id, or null
//     icaoType,      // ICAO type code (e.g. "A320"), or null
//     category,      // ADS-B emitter category ("A1".."A7"), or null
//     lat, lon,      // degrees
//     altM,          // metres AMSL (0 when on ground)
//     headingDeg,    // true track, degrees clockwise from north
//     velMs,         // ground speed, m/s
//     vertRateMs,    // vertical rate, m/s (+up)
//     onGround,      // boolean
//     tEpoch,        // ms epoch of the fix
//   }
//
// Sources (operator-selectable):
//   airplaneslive / adsbfi / adsblol — ADSBexchange-format community APIs, no
//     key. DEFAULT is airplanes.live (verified CORS-enabled for browser fetch).
//     adsb.lol does NOT send CORS headers, so it is usable only via a proxy.
//   mock        — synthetic fleet, no network; deterministic; the error fallback.
//   opensky-proxy — OpenSky /states/all via a user-supplied proxy base. OpenSky
//     now requires OAuth2 client-credentials + lacks browser CORS, so it is
//     inert until `proxyBase` is set (cannot be called from a static page).
import { FT_TO_M } from "./coords.js";

const KT_TO_MS = 0.514444;
const FPM_TO_MS = 0.00508;

// Two 250 NM query circles (the ADSBexchange point endpoint caps at 250 NM); a
// single circle clips the Chiang Rai↔Hat Yai extent. North + south centres,
// merged and de-duped by hex, cover ~4.8–20.2 N.
const QUERY_CENTERS = [
  { lat: 16.0, lon: 100.5 },   // north
  { lat: 9.0, lon: 100.0 },    // south
];
const QUERY_RADIUS_NM = 250;

const ADSBX_BASE = {
  adsblol: "https://api.adsb.lol",
  airplaneslive: "https://api.airplanes.live",
  adsbfi: "https://api.adsb.fi",
};

// Thailand bbox for the OpenSky source.
export const THAILAND_BBOX = { lamin: 5.5, lomin: 97, lamax: 20.5, lomax: 106 };

// ---------------- normalisation ----------------

/** Map one ADSBexchange `ac[]` row → NormalizedFlight (or null to drop). */
function normalizeAdsbx(a) {
  if (a == null || typeof a.lat !== "number" || typeof a.lon !== "number") return null;
  const onGround = a.alt_baro === "ground";
  const altFt = onGround ? 0 : (typeof a.alt_baro === "number" ? a.alt_baro : (a.alt_geom ?? 0));
  const heading = a.track ?? a.true_heading ?? a.mag_heading ?? 0;
  const seen = a.seen_pos ?? a.seen ?? 0;
  return {
    id: a.hex,
    callsign: (a.flight || "").trim() || null,
    icaoType: a.t || null,
    category: a.category || null,
    lat: a.lat,
    lon: a.lon,
    altM: altFt * FT_TO_M,
    headingDeg: heading,
    velMs: (a.gs ?? 0) * KT_TO_MS,
    vertRateMs: (a.baro_rate ?? a.geom_rate ?? 0) * FPM_TO_MS,
    onGround,
    tEpoch: Date.now() - seen * 1000,
  };
}

/** Map one OpenSky positional `states[]` row → NormalizedFlight (already SI). */
function normalizeOpenSky(s) {
  if (!s || s[5] == null || s[6] == null) return null;
  const onGround = !!s[8];
  return {
    id: s[0],
    callsign: (s[1] || "").trim() || null,
    icaoType: null,
    category: s[17] != null ? "A" + s[17] : null,   // extended=1 emitter category
    lat: s[6],
    lon: s[5],
    altM: onGround ? 0 : (s[13] ?? s[7] ?? 0),
    headingDeg: s[10] ?? 0,
    velMs: s[9] ?? 0,
    vertRateMs: s[11] ?? 0,
    onGround,
    tEpoch: (s[3] ?? s[4] ?? Math.floor(Date.now() / 1000)) * 1000,
  };
}

// ---------------- source adapters ----------------

/** Shared fetch+normalise for the ADSBexchange-format community APIs. */
function makeAdsbxSource(id, base, proxyBase) {
  return {
    id,
    async fetchStates() {
      const byHex = new Map();
      for (const c of QUERY_CENTERS) {
        const url = `${proxyBase}${base}/v2/point/${c.lat}/${c.lon}/${QUERY_RADIUS_NM}`;
        try {
          const r = await fetch(url);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const data = await r.json();
          for (const row of data.ac ?? []) {
            const nf = normalizeAdsbx(row);
            if (nf && nf.id && !byHex.has(nf.id)) byHex.set(nf.id, nf);
          }
        } catch (err) {
          console.warn("[liveflights]", url, err);
          // Partial failure: keep whatever the other circle returned. If both
          // circles fail the map is empty and the layer reports "error".
          throw err;
        }
      }
      return [...byHex.values()];
    },
  };
}

function makeOpenSkySource(proxyBase) {
  return {
    id: "opensky-proxy",
    async fetchStates() {
      if (!proxyBase) {
        // Inert until the operator points proxyBase at an OpenSky proxy.
        throw new Error("OpenSky source needs a proxyBase (OAuth2 + no browser CORS)");
      }
      const b = THAILAND_BBOX;
      const url = `${proxyBase}/states/all?lamin=${b.lamin}&lomin=${b.lomin}&lamax=${b.lamax}&lomax=${b.lomax}&extended=1`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      return (data.states ?? []).map(normalizeOpenSky).filter(Boolean);
    },
  };
}

// Synthetic fleet — deterministic, no network. Flights cruise on straight great-
// circle-ish tracks across the bbox and wrap when they exit, so trails grow and
// motion looks real. Count is read from globalThis.__mockFlightCount (default
// 40) so the perf test can bump it to 150 without touching settings.
function makeMockSource() {
  const fleet = [];
  let lastT = Date.now();
  const TYPES = [
    { t: "A320", category: "A3", v: 230 }, { t: "B738", category: "A3", v: 235 },
    { t: "A359", category: "A5", v: 250 }, { t: "B772", category: "A5", v: 248 },
    { t: "C172", category: "A1", v: 60 }, { t: "E190", category: "A3", v: 210 },
    { t: "LJ45", category: "A2", v: 200 },
  ];
  const AIRLINES = ["THA", "AIQ", "TVJ", "BAW", "SIA", "UAE", "QTR", "CPA"];
  function seed(n) {
    fleet.length = 0;
    for (let i = 0; i < n; i++) {
      const ty = TYPES[i % TYPES.length];
      fleet.push({
        id: "MOCK" + i.toString(16).padStart(4, "0"),
        callsign: AIRLINES[i % AIRLINES.length] + (100 + i),
        icaoType: ty.t, category: ty.category,
        lat: 6 + (i * 0.37) % 14,            // spread across 6–20 N
        lon: 97.5 + (i * 0.53) % 8,          // 97.5–105.5 E
        altM: 3000 + ((i * 700) % 9000),
        headingDeg: (i * 47) % 360,
        velMs: ty.v + (i % 5) * 4,
        vertRateMs: 0,
        onGround: false,
      });
    }
  }
  return {
    id: "mock",
    async fetchStates() {
      const want = Math.max(1, Math.min(400, globalThis.__mockFlightCount ?? 40));
      if (fleet.length !== want) seed(want);
      const now = Date.now();
      const dt = Math.min((now - lastT) / 1000, 120);
      lastT = now;
      for (const f of fleet) {
        // advance along heading (deg CW from north): dLat north, dLon east
        const dN = f.velMs * Math.cos((f.headingDeg * Math.PI) / 180) * dt;
        const dE = f.velMs * Math.sin((f.headingDeg * Math.PI) / 180) * dt;
        f.lat += dN / 111_320;
        f.lon += dE / (111_320 * Math.cos((f.lat * Math.PI) / 180));
        // wrap back into the bbox so the fleet never empties
        if (f.lat > 20.5) f.lat = 6; if (f.lat < 5.5) f.lat = 20;
        if (f.lon > 106) f.lon = 97.5; if (f.lon < 97) f.lon = 105.5;
      }
      return fleet.map((f) => ({ ...f, tEpoch: now }));
    },
  };
}

/** Build a FlightDataSource by id. */
export function makeSource(id, { proxyBase = "" } = {}) {
  switch (id) {
    case "airplaneslive": return makeAdsbxSource(id, ADSBX_BASE.airplaneslive, proxyBase);
    case "adsbfi": return makeAdsbxSource(id, ADSBX_BASE.adsbfi, proxyBase);
    case "opensky-proxy": return makeOpenSkySource(proxyBase);
    case "mock": return makeMockSource();
    case "adsblol": return makeAdsbxSource("adsblol", ADSBX_BASE.adsblol, proxyBase);
    case "airplaneslive":
    default: return makeAdsbxSource("airplaneslive", ADSBX_BASE.airplaneslive, proxyBase);
  }
}

// ---------------- model bucket mapping ----------------

/**
 * Map a normalised flight → aircraft-model bucket for buildLiveAircraftModel().
 * ADS-B emitter category is primary; ICAO type prefix overrides A3 mislabels.
 */
export function bucketForFlight(nf) {
  const t = (nf.icaoType || "").toUpperCase();
  if (/^(A31|A32|A21|A22|B73|B38|E19|E29|E17)/.test(t)) return "narrowbody";
  if (/^(B74|B77|B78|A33|A34|A35|A38|MD11|B76)/.test(t)) return "heavy";
  switch (nf.category) {
    case "A1": return "light";
    case "A2": return "bizjet";
    case "A3": return "narrowbody";
    case "A5": return "heavy";
    default: return "unknown";
  }
}

// ---------------- settings persistence ----------------
// Mirrors src/input.js: merge-over-frozen-defaults, try/catch for private mode.

const LS_KEY = "kuson.liveflights.settings.v1";

export const DEFAULT_LIVEFLIGHTS_SETTINGS = Object.freeze({
  enabled: false,
  source: "airplaneslive",   // verified CORS-OK browser-direct; adsb.lol is not
  intervalMs: 60000,   // operator's "every minute"; interpolation keeps it smooth
  proxyBase: "",
});

export function getLiveFlightsSettings() {
  try {
    const raw = globalThis.localStorage?.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_LIVEFLIGHTS_SETTINGS };
    return { ...DEFAULT_LIVEFLIGHTS_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_LIVEFLIGHTS_SETTINGS };
  }
}

export function setLiveFlightsSettings(patch) {
  const next = { ...getLiveFlightsSettings(), ...patch };
  try {
    globalThis.localStorage?.setItem(LS_KEY, JSON.stringify(next));
  } catch {
    /* localStorage missing / quota / private mode — in-memory only */
  }
  return next;
}
