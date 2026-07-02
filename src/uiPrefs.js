// uiPrefs.js — unified visibility registry + sparse-override persistence
// (Betterment-11 §0.5.1). One object under kuson.uiprefs.v1: sparse
// {id: bool} overrides layered over each element's registry default.
// `modes` (per-mode overrides) is schema-ready but unused until a later
// task fills it in — treat missing as empty.
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

/** Effective visibility for one id: mode override → global override → default. */
export function isVisible(id, { mode } = {}) {
  const entry = _byId.get(id);
  if (!entry) return true;
  const prefs = getPrefs();
  if (mode && prefs.modes[mode] && id in prefs.modes[mode]) return prefs.modes[mode][id];
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
