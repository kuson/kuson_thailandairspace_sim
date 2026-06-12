// groundSettings.js — persistence for the Betterment-6 ground orientation
// layers (airport beacons, range rings, province names) and B8.T9 volume
// glow. One object under kuson.grounddetail.v1; mirrors
// get/setLiveFlightsSettings. Defaults: airports + provinces on, range
// rings off (rings overlay the map → opt-in), volumeGlow on.
const LS_KEY = "kuson.grounddetail.v1";

export const DEFAULT_GROUND_DETAIL = { airports: true, rangeRings: false, provinces: true, volumeGlow: true, terrain: true, cityLights: true };

export function getGroundDetailSettings() {
  try {
    const raw = globalThis.localStorage?.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_GROUND_DETAIL };
    return { ...DEFAULT_GROUND_DETAIL, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_GROUND_DETAIL };
  }
}

export function setGroundDetailSettings(patch) {
  const next = { ...getGroundDetailSettings(), ...patch };
  try {
    globalThis.localStorage?.setItem(LS_KEY, JSON.stringify(next));
  } catch {
    /* localStorage missing / quota / private mode — in-memory only */
  }
  return next;
}
