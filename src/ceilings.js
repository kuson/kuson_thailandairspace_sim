// ceilings.js — per-aircraft operational + regulated altitude ceilings.
//
// Single source for the altitude-advisor (src/altitudeAdvisor.js) and the
// Settings editor (P2.T2). Defaults come from spec §10.2.1; the operator can
// override the numeric metres per preset, persisted to localStorage. The
// reference frame (AMSL vs AGL) is fixed per ceiling and not user-editable —
// the Mavic's 120 m rule is terrain-relative by regulation, the rest are
// pressure altitudes.
//
// A `null` ceiling means "no limit / no warnings" (the UFO joke preset).

const LS_KEY = "kuson.sim.ceilings";

// ref: "AMSL" (above mean sea level) | "AGL" (above ground level)
export const DEFAULT_CEILINGS = Object.freeze({
  "1x":        { operational: { m: 6000,  ref: "AMSL" }, regulated: { m: 120,   ref: "AGL"  } }, // Mavic 3: DJI svc / CAAT §2
  "cessna172": { operational: { m: 4267,  ref: "AMSL" }, regulated: { m: 3048,  ref: "AMSL" } }, // 14 000 / 10 000 ft (no O₂)
  "learjet":   { operational: { m: 13716, ref: "AMSL" }, regulated: { m: 12497, ref: "AMSL" } }, // FL450 / FL410
  "b777":      { operational: { m: 13137, ref: "AMSL" }, regulated: { m: 12497, ref: "AMSL" } }, // FL431 / FL410 RVSM
  "100x":      { operational: null, regulated: null },                                            // UFO: unlimited
});

function loadOverrides() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

let _overrides = loadOverrides();

function persist() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(_overrides));
  } catch {
    /* private mode — in-memory only */
  }
}

/**
 * Effective ceilings for a preset: operator overrides (numeric m only) merged
 * onto defaults, with the default ref frame preserved. Returns a fresh object
 * each call so callers can't mutate the defaults. `null` ceilings (UFO) are
 * passed through and never overridden.
 */
export function getCeilings(presetId) {
  const def = DEFAULT_CEILINGS[presetId] ?? { operational: null, regulated: null };
  const ovr = _overrides[presetId] ?? {};
  const merge = (band, key) => {
    if (!band) return null; // null default → stays unlimited
    const m = Number.isFinite(ovr[key]) ? ovr[key] : band.m;
    return { m, ref: band.ref };
  };
  return {
    operational: merge(def.operational, "operational"),
    regulated: merge(def.regulated, "regulated"),
  };
}

/** Set one ceiling band (metres) for a preset. Ignored for null-ceiling presets. */
export function setCeiling(presetId, band, metres) {
  const def = DEFAULT_CEILINGS[presetId];
  if (!def || !def[band]) return false; // unknown preset or unlimited band (UFO)
  if (!Number.isFinite(metres) || metres <= 0) return false;
  if (!_overrides[presetId]) _overrides[presetId] = {};
  _overrides[presetId][band] = metres;
  persist();
  return true;
}

/** Clear overrides for one preset (back to defaults). */
export function resetCeilings(presetId) {
  if (_overrides[presetId]) {
    delete _overrides[presetId];
    persist();
  }
}

/** True if the preset has any operator override active. */
export function hasOverride(presetId) {
  return !!_overrides[presetId] && Object.keys(_overrides[presetId]).length > 0;
}
