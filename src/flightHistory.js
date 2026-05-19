// flightHistory.js — undo/redo stack of drone positions (flight path bookmarks).
export class FlightHistory {
  constructor(drone) {
    this.drone = drone;
    this.stack = [];
    this.index = -1;
    this.maxSize = 120;
    this.pathSamples = [];
    this._lastSample = null;
    this.onChange = null;
  }

  /** Record a position snapshot if it differs from the current index. */
  push(snapshot, meta = {}) {
    const entry = {
      x: snapshot.x,
      y: snapshot.y,
      z: snapshot.z,
      yaw: snapshot.yaw,
      pitch: snapshot.pitch,
      speedPresetId: snapshot.speedPresetId ?? this.drone.speedPresetId,
      hover: snapshot.hover ?? this.drone.hover,
      label: meta.label ?? "",
      airspaceId: meta.airspaceId ?? null,
      t: Date.now(),
    };
    const cur = this.current;
    if (cur &&
        Math.hypot(cur.x - entry.x, cur.z - entry.z) < 80 &&
        Math.abs(cur.y - entry.y) < 40 &&
        cur.airspaceId === entry.airspaceId) {
      return;
    }
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(entry);
    if (this.stack.length > this.maxSize) {
      this.stack.shift();
    }
    this.index = this.stack.length - 1;
    this._notify();
  }

  get current() {
    return this.index >= 0 ? this.stack[this.index] : null;
  }

  canUndo() {
    return this.index > 0;
  }

  canRedo() {
    return this.index < this.stack.length - 1;
  }

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

  /** Sample manual flight for path polyline (world XZ points). */
  samplePosition(pos) {
    const key = `${Math.round(pos.x / 200)},${Math.round(pos.z / 200)},${Math.round(pos.y / 50)}`;
    if (key === this._lastSample) return;
    this._lastSample = key;
    this.pathSamples.push({ x: pos.x, y: pos.y, z: pos.z, t: Date.now() });
    if (this.pathSamples.length > 2000) this.pathSamples.shift();
  }

  getPath() {
    return this.pathSamples;
  }

  clear() {
    this.stack = [];
    this.index = -1;
    this.pathSamples = [];
    this._lastSample = null;
    this._notify();
  }

  _notify() {
    this.onChange?.({
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      index: this.index,
      total: this.stack.length,
      label: this.current?.label ?? "",
    });
  }
}
