import { latLonToCell, bucketId } from "./gridMath.js";
import { altBinFromAltM } from "./altBins.js";

export function createCollector({
  store,
  getSettings,
  isLiveFlightsEnabled,
  now = () => Date.now(),
  requestWakeLock = async () => {
    if (typeof navigator !== "undefined" && navigator.wakeLock) {
      return navigator.wakeLock.request("screen");
    }
    return null;
  },
  isDocumentHidden = () => typeof document !== "undefined" && document.hidden,
  addVisibilityListener = (fn) => {
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", fn);
      return () => document.removeEventListener("visibilitychange", fn);
    }
    return () => {};
  },
}) {
  let status = { state: "off", detail: "" };
  let wakeLock = null;
  let removeVisibilityListener = null;
  let visibilityHandler = null;

  function setStatus(next) {
    status = next;
  }

  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release().catch(() => {});
      wakeLock = null;
    }
  }

  async function acquireWakeLock() {
    try {
      wakeLock = await requestWakeLock();
    } catch {
      /* wake lock unavailable — keep recording */
    }
  }

  /** Re-evaluate gates; release wake lock when not actively recording. */
  async function refreshStatus() {
    const settings = getSettings();
    if (!settings.recordingOn || settings.writer !== "browser") {
      releaseWakeLock();
      setStatus({ state: "off", detail: "" });
      return false;
    }
    if (!isLiveFlightsEnabled()) {
      releaseWakeLock();
      setStatus({ state: "blocked", detail: "Enable Live Flights to record" });
      return false;
    }
    if (isDocumentHidden()) {
      releaseWakeLock();
      setStatus({ state: "paused", detail: "paused (tab asleep)" });
      return false;
    }
    setStatus({ state: "recording", detail: "" });
    if (!wakeLock) await acquireWakeLock();
    return true;
  }

  async function splatPositions(list) {
    if (!(await refreshStatus())) return;

    const bId = bucketId(now());
    const records = [];
    for (const f of list) {
      if (!f) continue;
      const altBin = altBinFromAltM(f.altM, f.onGround);
      if (altBin === 0) continue;
      const cell = latLonToCell(f.lat, f.lon);
      if (!cell) continue;
      records.push({
        bucketId: bId,
        cellX: cell.cellX,
        cellY: cell.cellY,
        altBin,
        count: 1,
      });
    }
    if (records.length) await store.incrementMany(records);
  }

  visibilityHandler = () => { void refreshStatus(); };
  removeVisibilityListener = addVisibilityListener(visibilityHandler);

  return {
    async handlePositions(list) {
      await splatPositions(list);
    },

    getStatus() {
      return { ...status };
    },

    async setRecording(on) {
      if (on) {
        await refreshStatus();
      } else {
        releaseWakeLock();
        setStatus({ state: "off", detail: "" });
      }
    },

    dispose() {
      releaseWakeLock();
      removeVisibilityListener?.();
      removeVisibilityListener = null;
      setStatus({ state: "off", detail: "" });
    },
  };
}
