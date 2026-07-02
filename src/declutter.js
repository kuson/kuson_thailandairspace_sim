// declutter.js — altitude/distance declutter laws (Betterment-11 §0.5.6).
//
// One toggleable module that fades/hides secondary ground-orientation and
// label layers as the camera gets far from them (or the drone climbs), so
// the world stays legible at range instead of turning into a wall of text.
// A single master checkbox ("Declutter", WORLD section, persisted via
// groundSettings.js's `declutter` key) gates every law: OFF restores
// today's always-on behaviour byte-for-byte (this module writes nothing).
//
// Design constraint (verified against every target layer's source before
// writing this module): airspace labels (airspace.js updateLabelScales),
// province names (provinces.js updateScales), and airport beacons/names
// (airports.js updateScales) each already run UNTHROTTLED, EVERY FRAME, and
// unconditionally rewrite `material.opacity` from their own distance/rank
// logic — there is no persistent "base opacity" field sitting idle on those
// objects between frames. So for those three layers this module does NOT
// cache-and-restore a base value; it multiplies whatever the owning layer's
// own per-frame pass just wrote by a law factor, applied every frame using
// a factor cached at the 4 Hz tick. On master-OFF (or law factor 1.0) the
// multiply is simply skipped, and the owning layer's own unconditional
// per-frame write is itself the "restore" — nothing stale can persist past
// one frame.
//
// Range rings are the one true persistent-base case: rangeRings.js sets
// each ring LineLoop's `material.opacity` ONCE at construction and never
// touches it again in update(). For that layer alone this module caches the
// authored base opacity in a WeakMap and explicitly restores it when the
// AGL law factor returns to 1 or the master toggle goes OFF (mirrors the
// _ensureFadeMaterial/_restoreFadeMaterial cache-and-restore idiom already
// used by airspace.js's B11.T8 interior-fade feature).
//
// The district label (#placeLabel) is DOM, not a THREE material, and is
// updated only by ui.js's textContent write (event-driven, not per-frame) —
// so it also needs an explicit "set opacity back to default" restore path.
//
// Live-flight callsign-only sprites get an ADDITIONAL multiplicative fade on
// top of the existing K25 data-line rule's own opacity write (liveFlights.js
// updateLabelScales already writes `f.label.material.opacity` fresh every
// frame from its own distance/fade-state formula) — same "multiply the
// fresh per-frame value" shape as provinces/airports/airspace-labels.

import * as THREE from "three";
import { elevationAt } from "./terrain.js";
import { worldToGeo } from "./coords.js";

// ---------------------------------------------------------------------------
// LAWS — every tunable in one table (spec §0.5.6). Distances in metres,
// altitudes in metres AGL, to match the rest of the codebase's world units
// (geoToWorld/elevationAt/drone.position are all metres).
// ---------------------------------------------------------------------------
export const LAWS = {
  // Province names: opacity 1→0 over camera-distance 60→90 km; also fully
  // hidden (factor 0) once the drone is above 6 km AGL.
  province: {
    fadeStartM: 60_000,
    fadeEndM: 90_000,
    aglHideM: 6_000,
  },
  // Airport beacons + names: fade 80→120 km, no AGL term.
  airport: {
    fadeStartM: 80_000,
    fadeEndM: 120_000,
  },
  // Airspace labels: keep the nearest 12 (by camera distance) at full
  // (subject to the layer's own fade below 150 km), fade the rest to 0.25;
  // ALL labels fade to 0 beyond 150 km regardless of rank.
  airspaceLabel: {
    nearestFull: 12,
    othersFactor: 0.25,
    hardRangeM: 150_000,
  },
  // Range rings: ×0.5 opacity above 5 km AGL.
  rangeRings: {
    aglDimM: 5_000,
    dimFactor: 0.5,
  },
  // District label: hidden above 8 km AGL (registry-respecting — see
  // _applyDistrictLabel below).
  districtLabel: {
    aglHideM: 8_000,
  },
  // Live-flight callsign-only sprites: fade 60→100 km, ON TOP of the
  // existing K25 data-line rule (DATA_LINE_K in liveFlights.js). Only
  // applies to sprites that are callsign-only (i.e. NOT in the nearest-K
  // data-line set and not the current selection — liveFlights.js's own
  // `showData` condition).
  liveFlightCallsign: {
    fadeStartM: 60_000,
    fadeEndM: 100_000,
  },
};

// Throttle: the expensive part (distance computation + the airspace-labels
// nearest-12 sort) runs at this cadence; cheap per-frame reapplication of
// the cached factors happens every call (see update()).
const TICK_INTERVAL_S = 0.25; // 4 Hz

// ---------------------------------------------------------------------------
// Pure law evaluators — exported so a Node driver can exercise the exact
// math without spinning up THREE/DOM. Each takes plain numbers and returns
// a [0, 1] multiplicative factor (never a color, never "on" by itself —
// laws only ever multiply toward off, per spec: "a law NEVER turns
// something on").
// ---------------------------------------------------------------------------

/** Linear ramp: 1 at/below `start`, 0 at/above `end`, lerp between. */
function _rampDown(value, start, end) {
  if (value <= start) return 1;
  if (value >= end) return 0;
  return 1 - (value - start) / (end - start);
}

/** Province-name law factor. distM = camera→sprite distance; aglM = drone AGL. */
export function provinceFactor(distM, aglM) {
  if (aglM > LAWS.province.aglHideM) return 0;
  return _rampDown(distM, LAWS.province.fadeStartM, LAWS.province.fadeEndM);
}

/** Airport beacon/name law factor. distM = camera→label distance. */
export function airportFactor(distM) {
  return _rampDown(distM, LAWS.airport.fadeStartM, LAWS.airport.fadeEndM);
}

/**
 * Airspace-label law factor for one sprite given its RANK (0 = nearest) among
 * currently-considered sprites, and its camera distance. Nearest `nearestFull`
 * get factor 1 (before the hard-range cutoff); the rest get `othersFactor`.
 * Every sprite, regardless of rank, is hard-zeroed beyond `hardRangeM`.
 */
export function airspaceLabelFactor(rank, distM) {
  if (distM >= LAWS.airspaceLabel.hardRangeM) return 0;
  return rank < LAWS.airspaceLabel.nearestFull ? 1 : LAWS.airspaceLabel.othersFactor;
}

/** Range-ring law factor. aglM = drone AGL. */
export function rangeRingsFactor(aglM) {
  return aglM > LAWS.rangeRings.aglDimM ? LAWS.rangeRings.dimFactor : 1;
}

/** District-label law: true = should be hidden by the AGL law. */
export function districtLabelHidden(aglM) {
  return aglM > LAWS.districtLabel.aglHideM;
}

/**
 * Live-flight callsign-only sprite law factor. Returns 1 (no-op) for
 * data-line sprites — the law only ever touches the callsign-only variant,
 * per spec ("ADD fade 60→100 km for callsign-only sprites").
 */
export function liveFlightCallsignFactor(distM, isCallsignOnly) {
  if (!isCallsignOnly) return 1;
  return _rampDown(distM, LAWS.liveFlightCallsign.fadeStartM, LAWS.liveFlightCallsign.fadeEndM);
}

// ---------------------------------------------------------------------------
// Stateful module — install() wires layer references, update() runs the
// throttled pass + every-frame cheap reapplication.
// ---------------------------------------------------------------------------

/**
 * @param {object} deps
 * @param {import("./airspace.js").AirspaceLayer} deps.layer
 * @param {{ ref: () => ({ group: THREE.Group, updateScales?: Function } | null) }} deps.provinces
 *   `ref()` returns the live installProvinceLines() result (or null before
 *   its async install resolves) — labels live as group children with
 *   userData.lat/lon.
 * @param {{ ref: () => ({ group: THREE.Group } | null) }} deps.airports
 *   `ref()` returns the live installAirportBeacons() result (or null).
 * @param {{ group: THREE.Group }} deps.rangeRings — installRangeRings() result.
 * @param {object} deps.ui — the UI instance (unused directly today; accepted
 *   per spec's install() signature for symmetry with other layer installs
 *   and in case a future law needs to read UI state).
 * @param {import("./liveFlights.js").LiveFlightsLayer} deps.liveFlights
 * @param {typeof import("./uiPrefs.js")} deps.uiPrefs — used read-only, to
 *   check the districtLabel registry's `.uiHidden` state so the law never
 *   fights it (see _applyDistrictLabel).
 * @param {() => boolean} deps.getSetting — returns the current master
 *   toggle state (groundDetail.declutter). Read fresh each update() call so
 *   flipping the checkbox takes effect on the very next frame.
 */
export function install({ layer, provinces, airports, rangeRings, ui, liveFlights, uiPrefs, getSetting }) {
  // Range-ring base-opacity cache (the one layer whose material opacity is
  // NOT rewritten every frame by its own update() — see file header).
  const _ringBase = new WeakMap(); // THREE.Material -> authored opacity
  // District-label DOM element, resolved lazily (may not exist yet at
  // install time in exotic bootstraps; re-queried if not found).
  let _placeLabelEl = null;

  let _tickAccum = TICK_INTERVAL_S; // fire on the first update() call
  let _wasOn = null; // tri-state so the very first tick always runs its OFF/ON transition path

  // Cached per-tick results, reapplied every frame between ticks.
  let _provinceFactors = new WeakMap(); // Sprite -> factor
  let _airportFactors = new WeakMap();  // Sprite -> factor (label); marker/halo share it
  let _airspaceLabelFactors = new WeakMap(); // Sprite -> factor
  let _rangeRingFactor = 1;
  let _districtHidden = false;
  let _liveFlightFactors = new Map(); // flight id -> factor (Map: ids are stable strings, WeakMap needs objects)

  function _resolveEl() {
    if (_placeLabelEl && _placeLabelEl.isConnected) return _placeLabelEl;
    _placeLabelEl = document.getElementById("placeLabel");
    return _placeLabelEl;
  }

  // Restore every touched object to its legacy (law-untouched) state. Called
  // immediately and completely when the master toggle goes OFF, so parity
  // holds even mid-fade.
  function _restoreAll() {
    // Provinces/airports/airspace-labels: nothing to restore — their owning
    // layer rewrites opacity unconditionally next frame regardless (see file
    // header). Just drop the cached factors so a stale multiply can't apply
    // on the transitional frame before the next real tick.
    _provinceFactors = new WeakMap();
    _airportFactors = new WeakMap();
    _airspaceLabelFactors = new WeakMap();
    _liveFlightFactors.clear();

    // Range rings: explicit restore — this layer's own update() does NOT
    // rewrite opacity, so a stale multiplied value WOULD persist otherwise.
    const rr = rangeRings?.group;
    if (rr) {
      for (const child of rr.children) {
        if (child.material && _ringBase.has(child.material)) {
          child.material.opacity = _ringBase.get(child.material);
        }
      }
    }
    _rangeRingFactor = 1;

    // District label: clear the law's inline opacity override. Empty string
    // falls back to the stylesheet default (see file header + law comment).
    const el = _resolveEl();
    if (el) {
      el.style.opacity = "";
      el.style.pointerEvents = "";
    }
    _districtHidden = false;
  }

  /** AGL at the drone's current position, metres. 0 before terrain resolves
   *  (elevationAt returns 0 pre-load — matches the rest of the codebase's
   *  bootstrap-race handling, e.g. provinces.js/airports.js reliftToTerrain). */
  function _aglOf(drone) {
    if (!drone) return 0;
    const { lat, lon } = worldToGeo(drone.position.x, drone.position.z);
    return Math.max(0, drone.position.y - elevationAt(lat, lon));
  }

  // ---- per-layer tick passes (the O(n) heavy work, gated to 4 Hz) --------

  function _tickProvinces(camPos, aglM) {
    const p = provinces?.ref?.();
    if (!p || !p.group.visible) return;
    for (const child of p.group.children) {
      // Only the name sprites carry lat/lon userData (the boundary
      // LineSegments object does not) — boundary lines are intentionally
      // NOT in the law table (spec: "leave them").
      if (!(child instanceof THREE.Sprite) || child.userData.lat === undefined) continue;
      const dist = child.position.distanceTo(camPos);
      _provinceFactors.set(child, provinceFactor(dist, aglM));
    }
  }

  function _tickAirports(camPos) {
    const a = airports?.ref?.();
    if (!a || !a.group.visible) return;
    for (const child of a.group.children) {
      if (!(child instanceof THREE.Sprite)) continue; // markers are Mesh; halos+labels are Sprite
      const dist = child.position.distanceTo(camPos);
      _airportFactors.set(child, airportFactor(dist));
    }
  }

  function _tickAirspaceLabels(camPos) {
    const group = layer?.labelsGroup;
    if (!group || !group.visible) return;
    // Only rank/factor sprites that are actually visible right now (the
    // layer's own updateLabelScales already ran earlier in the frame and
    // decided screen-space visibility) — matches spec "compute distances
    // only ... over labelsGroup.children" while staying O(n) + one sort
    // over the already-small visible set, not the full 144-volume catalog.
    const entries = [];
    for (const sp of group.children) {
      if (!sp.visible) continue;
      entries.push({ sp, dist: sp.position.distanceTo(camPos) });
    }
    entries.sort((a, b) => a.dist - b.dist); // ONE sort per tick
    for (let i = 0; i < entries.length; i++) {
      const { sp, dist } = entries[i];
      _airspaceLabelFactors.set(sp, airspaceLabelFactor(i, dist));
    }
  }

  function _tickRangeRings(aglM) {
    const rr = rangeRings?.group;
    if (!rr || !rr.visible) { _rangeRingFactor = 1; return; }
    _rangeRingFactor = rangeRingsFactor(aglM);
    // Cache each ring LineLoop's authored base opacity the first time the
    // law touches it (spec: "cache the base value the first time the law
    // touches an object").
    for (const child of rr.children) {
      if (child.material && !_ringBase.has(child.material)) {
        _ringBase.set(child.material, child.material.opacity);
      }
    }
  }

  function _tickDistrictLabel(aglM) {
    _districtHidden = districtLabelHidden(aglM);
  }

  function _tickLiveFlights(camPos) {
    if (!liveFlights || !liveFlights._enabled || !liveFlights.labelsGroup?.visible) {
      _liveFlightFactors.clear();
      return;
    }
    for (const f of liveFlights.flights.values()) {
      if (!f.label || !f.label.visible) continue;
      // Mirrors liveFlights.js updateLabelScales' own `showData` condition
      // exactly (nearest DATA_LINE_K, or the current selection, carry the
      // data row — everyone else is callsign-only). We don't have direct
      // access to that private rank here, so we re-derive "is this a
      // data-line sprite" the same way the layer itself flags it: via
      // f._labelSig, which liveFlights.js rebuilds as
      // `${airline.name}|${logoReady}|${dsig}` where dsig is the LITERAL
      // string "none" iff showData was false for that rebuild (else a
      // "HDG|ALT|GS|VS"-shaped tail). "none" is always the final `|`-
      // delimited segment, so `endsWith("|none")` is an exact, unambiguous
      // match — reads an existing field rather than restructuring the K25
      // rule.
      const isCallsignOnly = !!f._labelSig && f._labelSig.endsWith("|none");
      const dist = f.dist ?? (camPos ? f.world.distanceTo(camPos) : 0);
      _liveFlightFactors.set(f.id, liveFlightCallsignFactor(dist, isCallsignOnly));
    }
  }

  // ---- per-frame cheap reapplication (runs every call, not just ticks) --

  function _applyProvinces() {
    const p = provinces?.ref?.();
    if (!p || !p.group.visible) return;
    for (const child of p.group.children) {
      const factor = _provinceFactors.get(child);
      if (factor === undefined || !child.material) continue;
      child.material.opacity *= factor;
      if (factor <= 0) child.visible = false;
    }
  }

  function _applyAirports() {
    const a = airports?.ref?.();
    if (!a || !a.group.visible) return;
    for (const child of a.group.children) {
      const factor = _airportFactors.get(child);
      if (factor === undefined || !child.material) continue;
      child.material.opacity *= factor;
      if (factor <= 0) child.visible = false;
    }
  }

  function _applyAirspaceLabels() {
    const group = layer?.labelsGroup;
    if (!group || !group.visible) return;
    for (const sp of group.children) {
      const factor = _airspaceLabelFactors.get(sp);
      if (factor === undefined || !sp.visible || !sp.material) continue;
      sp.material.opacity *= factor;
      if (factor <= 0) sp.visible = false;
    }
  }

  function _applyRangeRings() {
    const rr = rangeRings?.group;
    if (!rr || !rr.visible) return;
    if (_rangeRingFactor >= 1) return; // no-op — base already holds
    for (const child of rr.children) {
      if (child.material && _ringBase.has(child.material)) {
        child.material.opacity = _ringBase.get(child.material) * _rangeRingFactor;
      }
    }
  }

  // Registry-respecting: if #placeLabel already carries .uiHidden (the
  // unified visibility registry — uiPrefs.js — hid it, e.g. the user turned
  // off "District label" or a mode profile hides it), `.uiHidden` is
  // `display: none !important` (index.html), which wins over any inline
  // `style.opacity` we set here regardless of value. So the law is always
  // safe to apply — it can never "fight" the registry's hide, it can only
  // ever ADD an opacity-0 on top of an already-visible element. We only
  // write element.style.opacity directly (never uiPrefs.set()), per spec:
  // "never write user prefs from a law".
  function _applyDistrictLabel() {
    const el = _resolveEl();
    if (!el) return;
    if (_districtHidden) {
      el.style.opacity = "0";
      el.style.pointerEvents = "none";
    } else {
      el.style.opacity = "";
      el.style.pointerEvents = "";
    }
  }

  function _applyLiveFlights() {
    if (!liveFlights || !liveFlights.labelsGroup?.visible) return;
    for (const f of liveFlights.flights.values()) {
      const factor = _liveFlightFactors.get(f.id);
      if (factor === undefined || !f.label || !f.label.visible || !f.label.material) continue;
      f.label.material.opacity *= factor;
      if (factor <= 0) f.label.visible = false;
    }
  }

  /**
   * Per-frame entry point (spec: `update(camera, dt)` — drone is threaded
   * through here as a second positional dependency so the AGL laws can read
   * it; call site is `declutter.update(camera, drone, dt)`, see main.js).
   */
  function update(camera, drone, dt) {
    const on = !!getSetting();

    if (!on) {
      if (_wasOn !== false) _restoreAll();
      _wasOn = false;
      return; // master OFF ⇒ every layer at its legacy value; nothing written.
    }
    _wasOn = true;

    const camPos = camera.position;
    _tickAccum += dt;
    if (_tickAccum >= TICK_INTERVAL_S) {
      _tickAccum = 0;
      const aglM = _aglOf(drone);
      _tickProvinces(camPos, aglM);
      _tickAirports(camPos);
      _tickAirspaceLabels(camPos);
      _tickRangeRings(aglM);
      _tickDistrictLabel(aglM);
      _tickLiveFlights(camPos);
    }

    // Cheap reapplication every frame, using whatever the tick last computed
    // (or nothing, before the first tick fires — factors default to "not
    // present" which _apply* treats as a no-op, so frame 1 is legacy-safe).
    _applyProvinces();
    _applyAirports();
    _applyAirspaceLabels();
    _applyRangeRings();
    _applyDistrictLabel();
    _applyLiveFlights();
  }

  return { update };
}
