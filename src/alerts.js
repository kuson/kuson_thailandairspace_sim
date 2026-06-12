// alerts.js — single-banner alert priority queue (spec §3.11, §10.3).
//
// Betterment-1 rendered RTH, geofence, and (later) altitude warnings as
// independent ribbons that stacked on top of each other — the operator saw
// three banners at once at Sattahip with a stale RTH reason. This queue makes
// exactly ONE alert own the banner at a time, chosen by a fixed priority. The
// rest surface as small chips so the user knows they exist without the banner
// fighting itself.
//
// Sources publish/retract by a stable `key` (one key per subsystem instance,
// e.g. "geofence", "rth", "alt"). Re-publishing the same key updates it in
// place. The host calls flush() once per frame; listeners are notified only
// when the active set actually changed (no DOM thrash).

// Lower rank = higher priority (renders in the banner).
export const AlertTier = Object.freeze({
  NO_FLY:       { id: "NO_FLY",       rank: 0, cls: "nofly" },
  AUTH_CLAMP:   { id: "AUTH_CLAMP",   rank: 1, cls: "auth" },
  RTH_ACTIVE:   { id: "RTH_ACTIVE",   rank: 2, cls: "rth" },
  ALT_OVER_REG: { id: "ALT_OVER_REG", rank: 3, cls: "over" },
  ALT_OVER_OP:  { id: "ALT_OVER_OP",  rank: 4, cls: "over" },
  ALT_AT_REG:   { id: "ALT_AT_REG",   rank: 5, cls: "warn" },
  ALT_AT_OP:    { id: "ALT_AT_OP",    rank: 6, cls: "warn" },
  RADIO:        { id: "RADIO",        rank: 7, cls: "radio" },
  ADVISORY:     { id: "ADVISORY",     rank: 8, cls: "advisory" },
});

class AlertQueue {
  constructor() {
    this._active = new Map();   // key -> {key, tier, message, ts}
    this._listeners = [];
    this._dirty = false;
  }

  /**
   * Add or update an alert. `tier` is an AlertTier member. No-op (no dirty
   * flag) when the tier+message are unchanged, so per-frame re-publishing is
   * cheap and won't thrash the DOM.
   */
  publish({ key, tier, message }) {
    if (!key || !tier) return;
    const prev = this._active.get(key);
    if (prev && prev.tier === tier && prev.message === message) return;
    this._active.set(key, {
      key,
      tier,
      message,
      ts: prev?.ts ?? (typeof performance !== "undefined" ? performance.now() : Date.now()),
    });
    this._dirty = true;
  }

  /** Remove an alert by key. */
  retract(key) {
    if (this._active.delete(key)) this._dirty = true;
  }

  clear() {
    if (this._active.size) {
      this._active.clear();
      this._dirty = true;
    }
  }

  subscribe(fn) {
    this._listeners.push(fn);
    return () => {
      const i = this._listeners.indexOf(fn);
      if (i >= 0) this._listeners.splice(i, 1);
    };
  }

  /**
   * Notify listeners if the active set changed since the last flush. Emits
   * { active, chips, all } where `active` is the highest-priority alert (the
   * banner) and `chips` is everything else, both sorted by rank.
   */
  flush() {
    if (!this._dirty) return;
    this._dirty = false;
    const sorted = [...this._active.values()].sort(
      (a, b) => a.tier.rank - b.tier.rank || a.ts - b.ts,
    );
    const payload = {
      active: sorted[0] ?? null,
      chips: sorted.slice(1),
      all: sorted,
    };
    for (const fn of this._listeners) fn(payload);
  }

  /** Test helper: snapshot of the current active alerts, sorted. */
  _snapshot() {
    return [...this._active.values()]
      .sort((a, b) => a.tier.rank - b.tier.rank)
      .map((a) => ({ key: a.key, tier: a.tier.id, message: a.message }));
  }
}

export const alerts = new AlertQueue();
