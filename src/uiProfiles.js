// uiProfiles.js — per-mode UI profiles (Betterment-11 §0.5.3 + B11.T6).
//
// Subscribes to appMode.onChange and drives uiPrefs' SESSION layer (T6) so
// entering learning/game hides/shows the right chrome for that mode without
// touching any persisted preference — and leaving restores the exact
// pre-entry state. Per-mode persisted overrides (uiPrefs `modes[mode]`,
// edited via the View panel's Freestyle/Learning/Game tabs) always win over
// a profile's hide/show verdict for a given id.
//
// install({ appMode, uiPrefs, layersApi }) takes its three collaborators as
// plain injected objects (not imported directly) so this module is
// testable with stubs — see the throwaway Node driver used to verify it.
// effectiveFor() is the one exception: it's pure read-only View-panel
// rendering support with no side effects to stub, so it imports uiPrefs
// directly (the module is a plain ES singleton, same store either way).
import * as uiPrefsModule from "./uiPrefs.js";

export const PROFILES = {
  learning:      { hide: ["quickWarpChips","liveFlightsSection","radioLog","flightHistory","simSpeed"], show: [], layers: { labels: true } },
  game_briefing: { hide: ["quickWarpChips","flightHistory"], show: [], layers: {} },
  game_wave:     { hide: ["panel","quickWarpChips","flightHistory","identifyCard","radarOptions","controlsHint","simSpeed","districtLabel"], show: ["radioLog"], layers: {} },
  game_debrief:  { hide: ["quickWarpChips","flightHistory"], show: [], layers: {} },
};

/**
 * Resolve a {mode, detail} pair (appMode.get()'s shape) to a PROFILES key,
 * or null when no profile applies (freestyle, or an unrecognized detail).
 * game+tutorial is treated as game_briefing — the tutorial rides the
 * briefing screen, same chrome needs.
 */
function _profileKeyFor({ mode, detail }) {
  if (mode === "learning") return "learning";
  if (mode === "game") {
    if (detail === "briefing" || detail === "tutorial") return "game_briefing";
    if (detail === "wave") return "game_wave";
    if (detail === "debrief") return "game_debrief";
    return null;
  }
  return null;
}

/**
 * Apply one profile's hide/show lists through the SESSION layer, letting a
 * persisted `modes[mode]` override win over the profile's verdict for any
 * id it names. `mode` is the appMode mode ("learning"|"game") — the bucket
 * `getPrefs().modes[mode]` overrides are read from.
 */
function _applyProfile(uiPrefs, mode, profileKey) {
  const profile = PROFILES[profileKey];
  if (!profile) return;
  const overrides = uiPrefs.getPrefs().modes[mode] || {};
  for (const id of profile.hide) {
    uiPrefs.setSession(id, Object.prototype.hasOwnProperty.call(overrides, id) ? overrides[id] : false);
  }
  for (const id of profile.show) {
    uiPrefs.setSession(id, Object.prototype.hasOwnProperty.call(overrides, id) ? overrides[id] : true);
  }
}

/**
 * Wire the profile system to live appMode transitions. Call once from
 * main.js after uiPrefs.init() (session layer needs the runtime deps uiPrefs
 * itself wires) and after layersApi's setter is reachable.
 * @param {{appMode: object, uiPrefs: object, layersApi: {getLabels: () => boolean, setLabels: (v: boolean) => void}}} deps
 * @returns {Function} unsubscribe (mirrors appMode.onChange's return)
 */
export function install({ appMode, uiPrefs, layersApi }) {
  // Base layers state captured once on freestyle → profiled-mode entry,
  // held for the whole mode session (including in-mode detail switches) so
  // exit restores exactly what was on screen before the mode was entered.
  // (Visibility state needs no equivalent snapshot-and-replay: exit takes
  // the "simplest correct" path — clear session + mode, then apply(), which
  // mathematically re-derives the pre-entry effective state by construction
  // since a profile only ever wrote the session layer. See the exit branch
  // below for the one documented exception — global edited mid-mode.)
  let _baseLabels = null;
  let _currentProfileKey = null;

  const unsubscribe = appMode.onChange((prev, next) => {
    const nextKey = _profileKeyFor(next);

    if (nextKey === null) {
      // Exit to freestyle (or an unrecognized detail — treated as no
      // profile). Only meaningful if a profile was actually active.
      if (_currentProfileKey === null) return;
      _currentProfileKey = null;
      uiPrefs.setActiveMode(null);
      uiPrefs.clearSession();
      // Base state IS the snapshot state unless global prefs were edited
      // mid-mode via the View panel's Auto tab — those are persisted
      // intentionally, so global wins over the stale snapshot value for
      // those ids. apply() re-derives session(none)/mode(none)/global/
      // default, which is exactly that semantic.
      uiPrefs.apply();
      if (_baseLabels !== null) {
        layersApi?.setLabels?.(_baseLabels);
      }
      _baseLabels = null;
      return;
    }

    if (_currentProfileKey === null) {
      // Entering a profiled mode from freestyle: snapshot pre-mode layers
      // state before anything changes (visibility state needs no snapshot —
      // see comment above `_baseLabels`).
      _baseLabels = !!layersApi?.getLabels?.();
      uiPrefs.setActiveMode(next.mode);
      _currentProfileKey = nextKey;
      _applyProfile(uiPrefs, next.mode, nextKey);
      const profile = PROFILES[nextKey];
      if (profile.layers.labels === true) {
        layersApi?.setLabels?.(true);
      }
      return;
    }

    // Switching detail within the same mode (e.g. game briefing→wave): do
    // NOT re-capture `_baseLabels` — it stays the mode-entry value. Clear
    // session and re-apply the new profile key's verdicts fresh.
    _currentProfileKey = nextKey;
    uiPrefs.clearSession();
    _applyProfile(uiPrefs, next.mode, nextKey);
  });

  return unsubscribe;
}

// Representative profile per tab (what the tab previews/edits — a mode can
// resolve to multiple profile keys over its lifetime, e.g. game has three;
// the tab shows the one that best represents "what does this mode usually
// look like"): learning → learning; game → game_wave (the most heavily
// profiled, gameplay-critical detail); freestyle → no profile (global only).
function _repProfileKeyForMode(mode) {
  if (mode === "learning") return "learning";
  if (mode === "game") return "game_wave";
  return null;
}

/**
 * For View-tab rendering: given a tab mode ('freestyle'|'learning'|'game'),
 * return the effective map that tab's rows should show, WITHOUT touching
 * live session state. Precedence: modes[mode] persisted override → profile
 * default for that mode's REPRESENTATIVE profile (see _repProfileKeyForMode)
 * → global → registry default.
 */
export function effectiveFor(mode) {
  const out = {};
  const overrides = uiPrefsModule.getPrefs().modes[mode] || {};
  const repKey = _repProfileKeyForMode(mode);
  const profile = repKey ? PROFILES[repKey] : null;
  for (const entry of uiPrefsModule.UI_ELEMENTS) {
    const id = entry.id;
    if (Object.prototype.hasOwnProperty.call(overrides, id)) {
      out[id] = overrides[id];
      continue;
    }
    if (profile) {
      if (profile.hide.includes(id)) { out[id] = false; continue; }
      if (profile.show.includes(id)) { out[id] = true; continue; }
    }
    // Global → registry default only — explicit {mode} form is session-free
    // by construction (uiPrefs.isVisible doc comment); `overrides` above
    // already covered the modes[mode]-has-this-id case, so this call's own
    // modes[mode] check is a guaranteed miss and falls straight through to
    // global → default. `mode` here is always one of the three real tab
    // names (never falsy) — effectiveFor's contract per the design note.
    out[id] = uiPrefsModule.isVisible(id, { mode });
  }
  return out;
}
