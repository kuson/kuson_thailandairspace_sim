// uiPrefs.js — unified visibility registry + sparse-override persistence
// (Betterment-11 §0.5.1). One object under kuson.uiprefs.v1: sparse
// {id: bool} overrides layered over each element's registry default.
// `modes` (per-mode overrides) is written/read by the View panel's
// Freestyle/Learning/Game tabs (B11.T6) and by uiProfiles.js as the
// override layer a profile's hide/show list must yield to.
//
// B11.T6 also adds a SESSION layer (module state, never persisted — see
// setActiveMode/setSession/clearSession below) that uiProfiles.js drives to
// apply/restore per-mode UI profiles without touching the persisted
// `global`/`modes` buckets. See isVisible()'s doc comment for the full
// effective-precedence rule.
import { getHudSettings } from "./ui.js";

const LS_KEY = "kuson.uiprefs.v1";

export const UI_ELEMENTS = [
  { id: "hudPanel",           label: "HUD panel",         group: "FLIGHT", sel: "#hud",                     default: true },
  // no static default: the pro/minimal HUD mode already persists in
  // kuson.hud.v1 (src/ui.js HUD_KEY) — read it live so existing users keep
  // their setting instead of being silently reset by this registry.
  // externalStore: kuson.hud.v1 (via ui.setHudPro) is the sole persistence
  // path for this id — set() below skips writing kuson.uiprefs.v1 for it.
  { id: "hudExtras",          label: "HUD extra rows",    group: "FLIGHT", defaultFn: () => getHudSettings().pro, externalStore: true },
  { id: "altTape",            label: "Altitude tape",     group: "FLIGHT", default: true },
  // default false: matches today — ui.js starts attitudeVisible=false, shown
  // only after the user presses H (design note says "true"; hard-rule
  // defaults-parity wins — see task report).
  { id: "attitude",           label: "Attitude indicator", group: "FLIGHT", default: false },
  { id: "crosshair",          label: "Crosshair",         group: "FLIGHT", sel: "#crosshairs",              default: true },
  { id: "simSpeed",           label: "Sim speed controls", group: "FLIGHT", sel: "#speedRow",                default: true },

  { id: "minimap",            label: "Minimap / radar",   group: "NAV",    sel: "#minimap",                 default: true },
  { id: "radarOptions",       label: "Radar options",     group: "NAV",    sel: "#radarOptions",             default: false },
  { id: "rangeRingsUi",       label: "Range rings option", group: "NAV",   sel: "label:has(#optRangeRings)", default: true },

  { id: "panel",              label: "Info panel",        group: "INFO",   sel: "#panel",                   default: true },
  { id: "quickWarpChips",     label: "Quick warp chips",  group: "INFO",   sel: "#quickWarpChips",           default: true },
  { id: "flightHistory",      label: "Flight history",    group: "INFO",   sel: "#historyBlock",             default: true },
  { id: "identifyCard",       label: "Identify card",     group: "INFO",   sel: "#identifyPanel",            default: true },
  { id: "liveFlightsSection", label: "Live flights",      group: "INFO",   sel: "#liveFlightsSection",       default: true },
  { id: "radioLog",           label: "Radio log",         group: "INFO",   sel: "#radioLog",                 default: true },

  { id: "alertBanner",        label: "Alert banner",      group: "ALERTS", sel: "#alertBanner",              default: true },
  { id: "alertChips",         label: "Alert chips",       group: "ALERTS", sel: "#alertChips",               default: true },

  { id: "controlsHint",       label: "Controls hint",     group: "HELP",   sel: "#controlsHint",             default: true },
  { id: "districtLabel",      label: "District label",    group: "HELP",   sel: "#placeLabel",               default: true },
  { id: "debugOverlay",       label: "Debug overlay",     group: "HELP",   default: false },
];

const _byId = new Map(UI_ELEMENTS.map((e) => [e.id, e]));
const _listeners = new Set();
let _runtime = null;   // set by init() — { ui, debugOverlay }

// B11.T6: SESSION layer — mode-ephemeral visibility overrides, never
// persisted to kuson.uiprefs.v1. `_activeMode` names which `modes[...]`
// bucket is "live" (null while in freestyle / no profile mode entered);
// `_session` holds the per-id overrides uiProfiles.js applies on top.
// Both are pure module state, wiped on setActiveMode()/clearSession().
let _activeMode = null;   // null | "learning" | "game"
let _session = {};        // id -> bool

function _emptyPrefs() {
  return { global: {}, modes: { game: {}, learning: {}, freestyle: {} } };
}

export function getPrefs() {
  try {
    const raw = globalThis.localStorage?.getItem(LS_KEY);
    if (!raw) return _emptyPrefs();
    const parsed = JSON.parse(raw);
    return {
      global: { ...parsed.global },
      modes: {
        game: { ...parsed.modes?.game },
        learning: { ...parsed.modes?.learning },
        freestyle: { ...parsed.modes?.freestyle },
      },
    };
  } catch {
    return _emptyPrefs();
  }
}

function _savePrefs(prefs) {
  try {
    globalThis.localStorage?.setItem(LS_KEY, JSON.stringify(prefs));
  } catch {
    /* localStorage missing / quota / private mode — in-memory only */
  }
}

/**
 * Effective visibility for one id.
 *
 * With an explicit `{mode}` arg (View-tab rendering: Freestyle/Learning/Game
 * tabs previewing a specific mode's persisted overrides): mode override →
 * global override → default. Session is NOT consulted — the tab is
 * previewing/editing the persisted `modes[mode]` bucket, not "what's on
 * screen right now".
 *
 * With no explicit mode (every other caller — DOM apply, HUD/key toggles,
 * View panel's Auto tab, uiProfiles' own bookkeeping — including `{mode}`
 * called with a falsy/absent value): session override → (if a profile mode
 * is active) that mode's persisted override → global override → default.
 * This is "what's effectively visible right now".
 *
 * Distinguishing "explicit mode" from "no mode" is done by truthiness of
 * `mode` (not key presence) — matches every existing call site, where
 * `apply()`/`snapshot()` pass `{mode}` with `mode` possibly undefined and
 * still mean "no mode".
 */
export function isVisible(id, { mode } = {}) {
  const entry = _byId.get(id);
  if (!entry) return true;
  const prefs = getPrefs();
  if (mode) {
    if (prefs.modes[mode] && id in prefs.modes[mode]) return prefs.modes[mode][id];
    if (id in prefs.global) return prefs.global[id];
    return entry.defaultFn ? entry.defaultFn() : entry.default;
  }
  if (id in _session) return _session[id];
  if (_activeMode && prefs.modes[_activeMode] && id in prefs.modes[_activeMode]) {
    return prefs.modes[_activeMode][id];
  }
  if (id in prefs.global) return prefs.global[id];
  return entry.defaultFn ? entry.defaultFn() : entry.default;
}

function _applyOne(entry, visible) {
  if (entry.apply) {
    entry.apply(visible, _runtime);
    return;
  }
  if (entry.sel) {
    document.querySelector(entry.sel)?.classList.toggle("uiHidden", !visible);
  }
}

/** Re-apply every registry entry's effective visibility to the DOM. */
export function apply(mode) {
  for (const entry of UI_ELEMENTS) {
    _applyOne(entry, isVisible(entry.id, { mode }));
  }
}

export function set(id, visible, { mode } = {}) {
  const entry = _byId.get(id);
  if (!entry) return;
  // B11.T6 routing rule: a plain set(id, v) (no explicit {mode}) made while
  // a profile mode is active routes to the SESSION layer instead of
  // persisting `global` — this is what makes every existing key/button/
  // checkbox toggle call site "session-only while a profile mode is active"
  // with zero changes to those call sites. externalStore ids (hudExtras) are
  // exempt — they keep writing through their own store (kuson.hud.v1 via
  // ui.setHudPro) even mid-mode; see module doc comment.
  if (!mode && _activeMode && !entry.externalStore) {
    setSession(id, visible);
    return;
  }
  // externalStore ids (e.g. hudExtras) persist through their own apply fn's
  // store (kuson.hud.v1 via ui.setHudPro) — writing kuson.uiprefs.v1 too
  // would create a second, staler source of truth that could shadow direct
  // changes to that store on a later load. Apply + notify only.
  if (!entry.externalStore) {
    const prefs = getPrefs();
    if (mode) {
      prefs.modes[mode] = { ...prefs.modes[mode], [id]: !!visible };
    } else {
      prefs.global[id] = !!visible;
    }
    _savePrefs(prefs);
  }
  _applyOne(entry, !!visible);
  for (const cb of _listeners) cb(id, !!visible);
}

// ---- B11.T6: SESSION layer — mode-ephemeral, never persisted ----

/**
 * Set which mode's persisted `modes[...]` bucket is "live" for precedence
 * purposes, and wipe any leftover session overrides from a previous mode.
 * Does NOT apply anything to the DOM — uiProfiles.js orchestrates applying
 * after this (it needs to snapshot pre-mode state first on entry).
 * @param {"learning"|"game"|null} mode
 */
export function setActiveMode(mode) {
  _activeMode = mode;
  _session = {};
}

/** Set one id's session-layer override, apply it, and notify subscribers. Never writes storage. */
export function setSession(id, visible) {
  const entry = _byId.get(id);
  if (!entry) return;
  _session[id] = !!visible;
  _applyOne(entry, !!visible);
  for (const cb of _listeners) cb(id, !!visible);
}

/** Wipe session overrides only — `_activeMode` and persisted prefs are untouched. */
export function clearSession() {
  _session = {};
}

/**
 * Clear one mode's persisted overrides only (View panel "Reset layout" on a
 * Freestyle/Learning/Game tab). `global` and other modes are left untouched.
 */
export function resetMode(mode) {
  if (!mode) return;
  const prefs = getPrefs();
  prefs.modes[mode] = {};
  _savePrefs(prefs);
  for (const entry of UI_ELEMENTS) {
    for (const cb of _listeners) cb(entry.id, isVisible(entry.id, { mode }));
  }
}

/**
 * Clear only the sparse `global` overrides (View panel "Reset layout").
 * `modes` is left untouched — it's schema-ready but unused until a later
 * task. Re-applies every entry's now-default-or-mode-only visibility and
 * notifies subscribers (e.g. the View panel) so checkboxes refresh.
 */
export function resetGlobal() {
  const prefs = getPrefs();
  prefs.global = {};
  _savePrefs(prefs);
  apply();
  for (const entry of UI_ELEMENTS) {
    for (const cb of _listeners) cb(entry.id, isVisible(entry.id));
  }
}

export function toggle(id, opts = {}) {
  const next = !isVisible(id, opts);
  set(id, next, opts);
  return next;
}

export function onChange(cb) {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

/** Effective visibility map for every registered id — harness API. */
export function snapshot(mode) {
  const out = {};
  for (const entry of UI_ELEMENTS) out[entry.id] = isVisible(entry.id, { mode });
  return out;
}

// ---- apply-fn targets (registered here so the plain-data table above stays
// readable; each id with no `sel` above is filled in below). ----

_byId.get("hudExtras").apply = (visible, rt) => {
  // setHudPro persists to kuson.hud.v1 (the authoritative store for this
  // id) and applies the DOM classes — uiPrefs never writes kuson.hud.v1
  // values into kuson.uiprefs.v1 itself.
  rt?.ui?.setHudPro?.(visible);
};

_byId.get("altTape").apply = (visible, rt) => {
  const ui = rt?.ui;
  if (!ui || ui.altTapeVisible === visible) return;
  ui.toggleAltTape();
};

_byId.get("attitude").apply = (visible, rt) => {
  const ui = rt?.ui;
  if (!ui || ui.attitudeVisible === visible) return;
  ui.toggleAttitude();
};

_byId.get("debugOverlay").apply = (visible, rt) => {
  rt?.debugOverlay?.setVisible?.(visible);
};

/**
 * Wire runtime dependencies (called once from main.js after `ui` and
 * `debugOverlay` exist) and apply the persisted/default state to the DOM.
 */
export function init({ ui, debugOverlay } = {}) {
  _runtime = { ui, debugOverlay };
  apply();
}
