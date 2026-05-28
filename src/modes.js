/**
 * Flight mode enum + Easy Mode toggle.
 *
 * HOVERCRAFT is the Easy-Mode default: kinematic 6-DoF strafe, go in any
 * direction, no inertia. Best for airspace exploration. The existing
 * `_updateHovercraft` integrator in drone.js (originally `_updateFree`)
 * implements this — Phase 0 formalises it as a named mode.
 *
 * DRONE is the realistic Mavic 3 mode (second-order quadrotor controller).
 * Phase 0 falls back to HOVERCRAFT for DRONE until Phase 3 wires the real
 * physics module.
 *
 * AIRPLANE is the existing always-forward + bank-to-yaw fixed-wing model.
 * UFO is kinematic like HOVERCRAFT but distinct so future tweaks (no boost
 * cap, unconstrained pitch) can branch cleanly.
 */
export const FlightMode = Object.freeze({
  HOVERCRAFT: "hovercraft",
  DRONE:      "drone",
  AIRPLANE:   "airplane",
  UFO:        "ufo",
});

/**
 * Global Easy Mode toggle. When `enabled === true`, every preset resolves to
 * HOVERCRAFT regardless of its "realistic" default. Toggled by the M key
 * (wired in P0.T6). Persists in memory only — no localStorage yet (Phase 0).
 */
export const EasyMode = {
  enabled: true,
};

/**
 * Map a preset id (as used in SPEED_PRESETS at drone.js:764) to its
 * realistic-mode default. Easy Mode overrides this at the call site.
 */
export function defaultModeForPreset(presetId) {
  switch (presetId) {
    case "1x":         return FlightMode.DRONE;       // Mavic 3
    case "cessna172":  return FlightMode.AIRPLANE;
    case "learjet":    return FlightMode.AIRPLANE;
    case "b777":       return FlightMode.AIRPLANE;
    case "100x":       return FlightMode.UFO;
    default:           return FlightMode.HOVERCRAFT;
  }
}

/**
 * Resolve the effective mode for a preset, honouring Easy Mode.
 * Centralised so future caller sites (preset switch, snapshot restore,
 * tour start) all use the same resolution.
 */
export function resolveMode(presetId) {
  if (EasyMode.enabled) return FlightMode.HOVERCRAFT;
  return defaultModeForPreset(presetId);
}
