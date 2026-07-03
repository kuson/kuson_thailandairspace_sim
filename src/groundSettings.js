// groundSettings.js — persistence for the Betterment-6 ground orientation
// layers (airport beacons, range rings, province names) and B8.T9 volume
// glow. One object under kuson.grounddetail.v1; mirrors
// get/setLiveFlightsSettings. Defaults: airports + provinces on, range
// rings off (rings overlay the map → opt-in), volumeGlow on.
// B11.T8: interiorFade (airspace interior-fill fade) defaults ON — the
// world stays readable inside stacked volumes; the outline + fresnel rim
// still carry the "cage" read, so OFF is the parity case per spec §0.
// B11.T9: declutter (altitude/distance declutter laws — src/declutter.js)
// defaults ON — OFF restores every touched layer's always-on legacy
// behaviour byte-for-byte (the module writes nothing while off).
// B11.T13: terrainShade (elevation-grid hillshade baked into detail-tile
// vertex colors) defaults ON — OFF is byte-identical to pre-T13 tile build
// (no vertex-color attribute allocated, no extra elevationAt sampling).
const LS_KEY = "kuson.grounddetail.v1";

export const DEFAULT_GROUND_DETAIL = { airports: true, rangeRings: false, provinces: true, volumeGlow: true, terrain: true, cityLights: true, water: true, interiorFade: true, declutter: true, terrainShade: true };

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
