// Mirrors src/flightSources.js: merge-over-frozen-defaults, try/catch for private mode.

const LS_KEY = "kuson.pathHeatmap.settings.v1";

export const DEFAULT_PATH_HEATMAP_SETTINGS = Object.freeze({
  recordingOn: false,
  writer: "browser",
  viewPreset: "24h",
  customFrom: null,
  customTo: null,
  show2d: true,
  show3d: true,
  opacity: 0.65,
  retentionDays: 14,
});

export function getPathHeatmapSettings() {
  try {
    const raw = globalThis.localStorage?.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_PATH_HEATMAP_SETTINGS };
    return { ...DEFAULT_PATH_HEATMAP_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PATH_HEATMAP_SETTINGS };
  }
}

export function setPathHeatmapSettings(patch) {
  const next = { ...getPathHeatmapSettings(), ...patch };
  try {
    globalThis.localStorage?.setItem(LS_KEY, JSON.stringify(next));
  } catch {
    /* localStorage missing / quota / private mode — in-memory only */
  }
  return next;
}
