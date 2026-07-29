import { openHeatStore } from "./store.js";
import { createCollector } from "./collector.js";
import { resolveWindow, bakeDensity, densityToRgba } from "./bake.js";
import { BBOX, gridSize, bucketId } from "./gridMath.js";
import { getPathHeatmapSettings, setPathHeatmapSettings } from "./settings.js";
import { HeatLayer2D } from "./layer2d.js";
import { HeatLayer3D } from "./layer3d.js";

const REBAKE_INTERVAL_MS = 60_000;

export async function createPathHeatmapModule({ scene, liveFlights, ui, getLiveEnabled }) {
  const store = await openHeatStore();
  const layer2d = new HeatLayer2D();
  const layer3d = new HeatLayer3D(scene);
  ui.setHeatLayer2d(layer2d);

  const { cols, rows } = gridSize();
  let lastBake = null;
  let cellsInView = 0;
  let rebakeTimer = null;
  let lastRebakeAt = 0;
  let lastWindowKey = "";

  const collector = createCollector({
    store,
    getSettings: getPathHeatmapSettings,
    isLiveFlightsEnabled: getLiveEnabled,
  });

  function updateUiStatus() {
    ui.setHeatStatus?.({
      collector: collector.getStatus(),
      cellsInView,
      settings: getPathHeatmapSettings(),
    });
  }

  function pushToLayers() {
    const settings = getPathHeatmapSettings();
    layer2d.setOpacity(settings.opacity);
    layer3d.setOpacity(settings.opacity);
    layer3d.setVisible(settings.show3d);

    if (!lastBake) {
      layer2d.clear();
      layer3d.setTextureRGBA(null, 0, 0);
      return;
    }

    const { rgba, cols: c, rows: r } = lastBake;

    if (settings.show2d) {
      const imageData = new ImageData(new Uint8ClampedArray(rgba), c, r);
      layer2d.setImageData(imageData, {
        cols: c,
        rows: r,
        lamin: BBOX.lamin,
        lomin: BBOX.lomin,
        lamax: BBOX.lamax,
        lomax: BBOX.lomax,
      });
    } else {
      layer2d.clear();
    }

    if (settings.show3d) {
      layer3d.setTextureRGBA(rgba, c, r);
    } else {
      layer3d.setTextureRGBA(null, 0, 0);
    }
  }

  async function refreshBake({ force = false } = {}) {
    const settings = getPathHeatmapSettings();
    const windowKey = JSON.stringify([settings.viewPreset, settings.customFrom, settings.customTo]);
    const now = Date.now();
    if (!force && settings.recordingOn) {
      const elapsed = now - lastRebakeAt;
      if (elapsed < REBAKE_INTERVAL_MS && windowKey === lastWindowKey) return;
    }
    lastWindowKey = windowKey;
    lastRebakeAt = now;

    const win = resolveWindow(settings, now);
    if (!win) {
      cellsInView = 0;
      lastBake = null;
      layer2d.clear();
      layer3d.setTextureRGBA(null, 0, 0);
      updateUiStatus();
      return;
    }

    const cellCounts = await store.sumRange(win);
    cellsInView = cellCounts.size;
    const density = bakeDensity(cellCounts, { cols, rows });
    const rgba = densityToRgba(density, settings.opacity);
    lastBake = { rgba, cols, rows };
    pushToLayers();
    updateUiStatus();
  }

  function scheduleThrottledRebake() {
    if (rebakeTimer) return;
    const settings = getPathHeatmapSettings();
    if (!settings.recordingOn) return;
    const delay = Math.max(0, REBAKE_INTERVAL_MS - (Date.now() - lastRebakeAt));
    rebakeTimer = setTimeout(() => {
      rebakeTimer = null;
      void refreshBake();
    }, delay);
  }

  liveFlights.onPositions = (list) => {
    void collector.handlePositions(list).then(() => {
      if (getPathHeatmapSettings().recordingOn) scheduleThrottledRebake();
      updateUiStatus();
    }).catch(() => {});
  };

  const onVisibilityChange = () => updateUiStatus();
  document.addEventListener("visibilitychange", onVisibilityChange);

  async function applySettings() {
    const settings = getPathHeatmapSettings();
    await collector.setRecording(settings.recordingOn);
    await refreshBake({ force: true });
  }

  async function clearData() {
    await store.clear();
    await refreshBake({ force: true });
  }

  async function onLiveFlightsChange() {
    await collector.setRecording(getPathHeatmapSettings().recordingOn);
    updateUiStatus();
  }

  const settings = getPathHeatmapSettings();
  if (settings.retentionDays > 0) {
    const cutoff = bucketId(Date.now() - settings.retentionDays * 864e5);
    await store.pruneOlderThan(cutoff);
  }
  await applySettings();

  return {
    applySettings,
    refreshBake: () => refreshBake({ force: true }),
    clearData,
    onLiveFlightsChange,
    dispose() {
      if (rebakeTimer) clearTimeout(rebakeTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      liveFlights.onPositions = null;
      collector.dispose();
      layer2d.clear();
      layer3d.dispose();
    },
    getStatus() {
      return { collector: collector.getStatus(), cellsInView };
    },
  };
}

export { getPathHeatmapSettings, setPathHeatmapSettings };
