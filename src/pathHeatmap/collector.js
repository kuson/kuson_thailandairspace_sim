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
  let acquireGen = 0;
  let refreshChain = Promise.resolve();
  let removeVisibilityListener = null;
  let visibilityHandler = null;

  function setStatus(next) {
    status = next;
  }

  function invalidateAcquires() {
    acquireGen++;
  }

  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release().catch(() => {});
      wakeLock = null;
    }
  }

  async function tryAcquireWakeLock() {
    if (wakeLock) return;
    const gen = ++acquireGen;
    try {
      const lock = await requestWakeLock();
      if (gen !== acquireGen || status.state !== "recording") {
        lock?.release?.().catch(() => {});
        return;
      }
      wakeLock = lock;
    } catch {
      /* wake lock unavailable — keep recording */
    }
  }

  async function refreshStatusImpl() {
    const settings = getSettings();
    if (!settings.recordingOn || settings.writer !== "browser") {
      invalidateAcquires();
      releaseWakeLock();
      setStatus({ state: "off", detail: "" });
      return false;
    }
    if (!isLiveFlightsEnabled()) {
      invalidateAcquires();
      releaseWakeLock();
      setStatus({ state: "blocked", detail: "Enable Live Flights to record" });
      return false;
    }
    if (isDocumentHidden()) {
      invalidateAcquires();
      releaseWakeLock();
      setStatus({ state: "paused", detail: "paused (tab asleep)" });
      return false;
    }
    setStatus({ state: "recording", detail: "" });
    await tryAcquireWakeLock();
    return true;
  }

  function refreshStatus() {
    const run = refreshChain.then(refreshStatusImpl);
    refreshChain = run.catch(() => {});
    return run;
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
        invalidateAcquires();
        releaseWakeLock();
        setStatus({ state: "off", detail: "" });
      }
    },

    dispose() {
      invalidateAcquires();
      releaseWakeLock();
      removeVisibilityListener?.();
      removeVisibilityListener = null;
      setStatus({ state: "off", detail: "" });
    },
  };
}
