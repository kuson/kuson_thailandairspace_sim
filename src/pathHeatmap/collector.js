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

  function shouldRecord(settings) {
    if (!settings.recordingOn) {
      setStatus({ state: "off", detail: "" });
      return false;
    }
    if (settings.writer !== "browser") {
      setStatus({ state: "off", detail: "" });
      return false;
    }
    if (!isLiveFlightsEnabled()) {
      setStatus({ state: "blocked", detail: "Enable Live Flights to record" });
      return false;
    }
    if (isDocumentHidden()) {
      setStatus({ state: "paused", detail: "paused (tab asleep)" });
      return false;
    }
    return true;
  }

  async function splatPositions(list) {
    const settings = getSettings();
    if (!shouldRecord(settings)) return;

    setStatus({ state: "recording", detail: "" });

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

  function onVisibilityChange() {
    const settings = getSettings();
    if (!settings.recordingOn || settings.writer !== "browser") return;
    if (isDocumentHidden()) {
      setStatus({ state: "paused", detail: "paused (tab asleep)" });
    } else if (isLiveFlightsEnabled()) {
      setStatus({ state: "recording", detail: "" });
    }
  }

  removeVisibilityListener = addVisibilityListener(onVisibilityChange);

  return {
    async handlePositions(list) {
      await splatPositions(list);
    },

    getStatus() {
      return { ...status };
    },

    async setRecording(on) {
      if (on) {
        const settings = getSettings();
        if (settings.recordingOn && settings.writer === "browser") {
          await acquireWakeLock();
        }
        if (!shouldRecord(settings)) return;
        setStatus({ state: "recording", detail: "" });
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
