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
  // 0 = keep forever; only Clear heat data wipes IndexedDB (no auto-prune).
  retentionDays: 0,
});

export function getPathHeatmapSettings() {
  try {
    const raw = globalThis.localStorage?.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_PATH_HEATMAP_SETTINGS };
    const next = { ...DEFAULT_PATH_HEATMAP_SETTINGS, ...JSON.parse(raw) };
    // Migrate legacy 7–14 day prune → persistent store.
    if (next.retentionDays !== 0) {
      next.retentionDays = 0;
      try {
        globalThis.localStorage?.setItem(LS_KEY, JSON.stringify(next));
      } catch {
        /* private mode / quota */
      }
    }
    return next;
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
