// flightHistory.js — meaningful flight-event log + undo/redo (Betterment-2 E2).
//
// Betterment-1 recorded only catalog fly-to bookmarks plus a time-based
// "Manual flight" snapshot every 12 s, and the HUD row was always expanded.
// Operator report E2: the panel takes too much space and should show the last
// (up to 100) COURSE or LOCATION changes — a view-only camera toggle is NOT a
// course change. This rebuild:
//   - logs a curated set of events (HISTORY_EVENT_TYPES) by diffing state each
//     frame; camera view / identify / map / unit / settings are excluded by
//     construction (nothing calls record() for them);
//   - caps the ring at 100;
//   - keeps undo/redo navigating the ring with a correct cursor.

/**
 * The only events that create a history entry. ADDITIVE ONLY — removing a type
 * is a breaking change for anything that reads `entry.type`.
 *
 * Explicitly EXCLUDED (never recorded): camera view toggle (V / ← / → / ↓),
 * identify toggle, map-primary toggle, unit toggle, settings panel changes.
 */
export const HISTORY_EVENT_TYPES = Object.freeze({
  START:    "start",     // initial spawn / GPS start
  RESET:    "reset",     // reset to Bangkok
  FLYTO:    "flyto",     // catalog warp arrival
  TOUR:     "tour",      // tour complete
  COURSE:   "course",    // heading changed >= COURSE_DELTA_DEG since last entry
  POSITION: "position",  // moved >= POSITION_DELTA_M since last entry
  PRESET:   "preset",    // aircraft preset change
  MODE:     "mode",      // Easy <-> Realistic
  PAUSE:    "pause",     // pause / resume
  RTH:      "rth",       // RTH engage / disengage
  BOUNDARY: "boundary",  // entered / left an airspace volume
});

const COURSE_DELTA_DEG = 15;
const POSITION_DELTA_M = 2000;
const MAX_SIZE = 100;

function angleDeltaDeg(a, b) {
  let d = ((a - b + 540) % 360) - 180;
  return Math.abs(d);
}

function compass8(deg) {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

export class FlightHistory {
  constructor(drone) {
    this.drone = drone;
    this.stack = [];
    this.index = -1;
    this.maxSize = MAX_SIZE;
    this.pathSamples = [];
    this._lastSample = null;
    this._baseline = null;   // last-recorded state, for delta detection
    this.onChange = null;
  }

  // ---------------- entry creation ----------------

  _entryFrom(snapshot, type, label, airspaceId) {
    return {
      x: snapshot.x, y: snapshot.y, z: snapshot.z,
      yaw: snapshot.yaw, pitch: snapshot.pitch,
      speedPresetId: snapshot.speedPresetId ?? this.drone.speedPresetId,
      hover: snapshot.hover ?? this.drone.hover,
      type, label: label ?? "", airspaceId: airspaceId ?? null,
      t: Date.now(),
    };
  }

  /**
   * Append an explicit event (start / reset / flyto / tour). Truncates any
   * redo tail, then caps the ring at maxSize. Refreshes the delta baseline so
   * an explicit jump doesn't immediately re-trigger a course/position event.
   */
  record(type, snapshot, { label = "", airspaceId = null } = {}) {
    const entry = this._entryFrom(snapshot, type, label, airspaceId);
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(entry);
    if (this.stack.length > this.maxSize) this.stack.shift();
    this.index = this.stack.length - 1;
    this._baseline = { ...entry };
    this._notify();
    return entry;
  }

  /** Back-compat shim — older call sites pass {label, airspaceId}. */
  push(snapshot, meta = {}) {
    const type = meta.type
      ?? (meta.airspaceId ? HISTORY_EVENT_TYPES.FLYTO : HISTORY_EVENT_TYPES.POSITION);
    return this.record(type, snapshot, meta);
  }

  /**
   * Per-frame state diff. Records at most one event per call, choosing the
   * most meaningful change. Discrete changes (preset/mode/pause/rth/boundary)
   * win over course, which wins over position. Camera/identify/map/unit/
   * settings are never passed in, so they can't produce an entry.
   *
   * @param ctx {{
   *   snapshot, free:boolean, presetId, presetDisplay, easy:boolean,
   *   paused:boolean, rthActive:boolean, insideId:(string|null)
   * }}
   */
  track(ctx) {
    const snap = ctx.snapshot;
    if (!this._baseline) {
      // First observation — seed the baseline, don't record.
      this._baseline = this._entryFrom(snap, HISTORY_EVENT_TYPES.START, "");
      this._baseline.presetId = ctx.presetId;
      this._baseline.easy = ctx.easy;
      this._baseline.paused = ctx.paused;
      this._baseline.rthActive = ctx.rthActive;
      this._baseline.insideId = ctx.insideId ?? null;
      return;
    }
    const b = this._baseline;

    // --- discrete changes (always tracked, regardless of free flight) ---
    if (ctx.presetId !== b.presetId) {
      return this._recordTracked(ctx, HISTORY_EVENT_TYPES.PRESET, `Aircraft → ${ctx.presetDisplay ?? ctx.presetId}`);
    }
    if (ctx.easy !== b.easy) {
      return this._recordTracked(ctx, HISTORY_EVENT_TYPES.MODE, `Mode → ${ctx.easy ? "Easy" : "Realistic"}`);
    }
    if (ctx.paused !== b.paused) {
      return this._recordTracked(ctx, HISTORY_EVENT_TYPES.PAUSE, ctx.paused ? "Paused" : "Resumed");
    }
    if (ctx.rthActive !== b.rthActive) {
      return this._recordTracked(ctx, HISTORY_EVENT_TYPES.RTH, ctx.rthActive ? "RTH engaged" : "RTH cleared");
    }
    const insideId = ctx.insideId ?? null;
    if (insideId !== (b.insideId ?? null)) {
      const label = insideId ? `Entered ${insideId}` : "Left airspace";
      return this._recordTracked(ctx, HISTORY_EVENT_TYPES.BOUNDARY, label, insideId);
    }

    // --- spatial changes only count during free flight ---
    if (ctx.free) {
      const headingDeg = ((-snap.yaw * 180) / Math.PI) % 360;
      const baseHeadingDeg = ((-b.yaw * 180) / Math.PI) % 360;
      if (angleDeltaDeg(headingDeg, baseHeadingDeg) >= COURSE_DELTA_DEG) {
        const h = ((headingDeg % 360) + 360) % 360;
        return this._recordTracked(ctx, HISTORY_EVENT_TYPES.COURSE, `Turn to ${h.toFixed(0)}° ${compass8(h)}`);
      }
      const dist = Math.hypot(snap.x - b.x, snap.z - b.z);
      if (dist >= POSITION_DELTA_M) {
        return this._recordTracked(ctx, HISTORY_EVENT_TYPES.POSITION, `Moved ${(dist / 1000).toFixed(1)} km`);
      }
    }
  }

  _recordTracked(ctx, type, label, airspaceId = null) {
    const entry = this.record(type, ctx.snapshot, { label, airspaceId });
    // record() reset _baseline to the snapshot; re-attach the discrete fields
    // so subsequent diffs compare against the state at this entry.
    this._baseline.presetId = ctx.presetId;
    this._baseline.easy = ctx.easy;
    this._baseline.paused = ctx.paused;
    this._baseline.rthActive = ctx.rthActive;
    this._baseline.insideId = ctx.insideId ?? null;
    return entry;
  }

  /**
   * Re-seed the baseline after an undo/redo/reset restore so the teleport
   * doesn't get logged as a spurious course/position/preset event next frame.
   */
  resetBaseline(ctx) {
    this._baseline = this._entryFrom(ctx.snapshot, HISTORY_EVENT_TYPES.START, "");
    this._baseline.presetId = ctx.presetId;
    this._baseline.easy = ctx.easy;
    this._baseline.paused = ctx.paused;
    this._baseline.rthActive = ctx.rthActive;
    this._baseline.insideId = ctx.insideId ?? null;
  }

  // ---------------- navigation ----------------

  get current() {
    return this.index >= 0 ? this.stack[this.index] : null;
  }

  canUndo() { return this.index > 0; }
  canRedo() { return this.index < this.stack.length - 1; }

  undo() {
    if (!this.canUndo()) return null;
    this.index--;
    const s = this.current;
    this._notify();
    return s;
  }

  redo() {
    if (!this.canRedo()) return null;
    this.index++;
    const s = this.current;
    this._notify();
    return s;
  }

  /** Newest-first list for the collapsible UI. */
  getEntries() {
    return this.stack.map((e, i) => ({ ...e, i })).reverse();
  }

  // ---------------- path sampling (unchanged) ----------------

  samplePosition(pos) {
    const key = `${Math.round(pos.x / 200)},${Math.round(pos.z / 200)},${Math.round(pos.y / 50)}`;
    if (key === this._lastSample) return;
    this._lastSample = key;
    this.pathSamples.push({ x: pos.x, y: pos.y, z: pos.z, t: Date.now() });
    if (this.pathSamples.length > 2000) this.pathSamples.shift();
  }

  getPath() { return this.pathSamples; }

  clear() {
    this.stack = [];
    this.index = -1;
    this.pathSamples = [];
    this._lastSample = null;
    this._baseline = null;
    this._notify();
  }

  _notify() {
    this.onChange?.({
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      index: this.index,
      total: this.stack.length,
      label: this.current?.label ?? "",
      entries: this.getEntries(),
    });
  }
}
