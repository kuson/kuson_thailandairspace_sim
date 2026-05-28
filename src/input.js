// P3.T6: input pipeline — deadzone, expo, and gamepad polling.
//
// Decoupled from THREE / Drone / DOM so the math can be unit-tested in
// Node and so the Drone class doesn't grow a hard dependency on the
// Gamepad API (it gracefully degrades to keyboard-only on hosts that
// don't expose navigator.getGamepads).
//
// pollGamepad() returns a normalized stick state matching the existing
// keyboard convention used in _updateDrone / _updateAirplane:
//   pitch: +1 = nose-up command (E key analog)
//   roll:  +1 = left bank  (A key analog)
//   yaw:   +1 = yaw left (rudder-left analog; matches Three.js +Y CCW)
//   throttle: +1 = climb / throttle-up (W key analog)
//
// Mode 1 vs Mode 2 swaps which physical stick owns pitch vs throttle —
// the rest of the mapping is identical. Default is Mode 2 (real-world
// drone-radio convention used by most ready-to-fly platforms).

const SETTINGS_KEY = "thairspace.input.settings.v1";

export const DEFAULT_INPUT_SETTINGS = Object.freeze({
  deadzone: 0.10,        // [0..0.4]
  expo: 0.40,            // [0..0.95] — 0 = linear; higher = softer center
  stickMode: 2,          // 1 or 2 (Mode 2 = throttle on left stick Y)
  invertY: false,        // invert pitch axis (some sims/pilots prefer)
  mouseSensitivity: 0.0022,  // currently constant in drone.js; surfaced
                             // here so a UI slider can write through.
});

export function getInputSettings() {
  try {
    const raw = globalThis.localStorage?.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_INPUT_SETTINGS };
    return { ...DEFAULT_INPUT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_INPUT_SETTINGS };
  }
}

export function setInputSettings(patch) {
  const next = { ...getInputSettings(), ...patch };
  try {
    globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    // localStorage missing or quota — fine, in-memory defaults still apply.
  }
  return next;
}

/**
 * Deadzone with linear rescale so the post-deadzone output still spans
 * the full [-1, +1] range. dz must be in [0, 0.99).
 */
export function applyDeadzone(v, dz) {
  if (dz <= 0) return v;
  const a = v < 0 ? -v : v;
  if (a <= dz) return 0;
  const sign = v < 0 ? -1 : 1;
  return sign * (a - dz) / (1 - dz);
}

/**
 * Cubic expo curve: y = (1 - expo)·v + expo·v³. expo in [0, 0.95].
 *  - expo = 0    → linear (no shaping)
 *  - expo = 0.5  → soft center, full deflection unchanged at ±1
 *  - expo = 0.95 → near-pure cubic, very soft at center
 */
export function applyExpo(v, expo) {
  const e = expo < 0 ? 0 : expo > 0.95 ? 0.95 : expo;
  return (1 - e) * v + e * v * v * v;
}

/** Convenience: deadzone then expo with the given settings. */
export function shapeAxis(v, settings) {
  return applyExpo(applyDeadzone(v, settings.deadzone), settings.expo);
}

/**
 * Read the first connected gamepad and return a normalized stick state.
 * Returns `null` if no gamepad is connected or the API is unavailable.
 *
 * Axis mapping (Xbox / standard layout):
 *   axes[0]=LX  axes[1]=LY  axes[2]=RX  axes[3]=RY
 *   Y axes are -1 = up, +1 = down (browser convention).
 *
 * Mode 2 (default — throttle on left stick):
 *   LX → yaw   ; LY → throttle (flipped so up = climb)
 *   RX → roll  ; RY → pitch    (flipped so up = nose-up)
 * Mode 1 (throttle on right stick — RC sport convention):
 *   LX → yaw   ; LY → pitch    (flipped so up = nose-up)
 *   RX → roll  ; RY → throttle (flipped so up = climb)
 */
export function pollGamepad(settings) {
  const s = settings ?? getInputSettings();
  const nav = typeof navigator !== "undefined" ? navigator : globalThis.navigator;
  if (!nav?.getGamepads) return null;

  const pads = nav.getGamepads();
  if (!pads) return null;
  let pad = null;
  for (let i = 0; i < pads.length; i++) {
    const p = pads[i];
    if (p && p.connected) { pad = p; break; }
  }
  if (!pad) return null;

  const ax = pad.axes;
  const lx = ax[0] ?? 0, ly = ax[1] ?? 0;
  const rx = ax[2] ?? 0, ry = ax[3] ?? 0;

  const ySign = s.invertY ? -1 : 1;
  let yawRaw, pitchRaw, rollRaw, throttleRaw;
  if (s.stickMode === 1) {
    yawRaw      = lx;
    pitchRaw    = -ly * ySign;
    rollRaw     = rx;
    throttleRaw = -ry;
  } else {
    yawRaw      = lx;
    throttleRaw = -ly;
    rollRaw     = rx;
    pitchRaw    = -ry * ySign;
  }

  const buttons = pad.buttons || [];
  return {
    id: pad.id,
    connected: true,
    yaw:      shapeAxis(yawRaw,      s),
    pitch:    shapeAxis(pitchRaw,    s),
    roll:     shapeAxis(rollRaw,     s),
    throttle: shapeAxis(throttleRaw, s),
    // Buttons surfaced for future binding; Drone reads only what it needs.
    a:  !!buttons[0]?.pressed,
    b:  !!buttons[1]?.pressed,
    x:  !!buttons[2]?.pressed,
    y:  !!buttons[3]?.pressed,
    lb: !!buttons[4]?.pressed,
    rb: !!buttons[5]?.pressed,
    lt: buttons[6]?.value ?? 0,
    rt: buttons[7]?.value ?? 0,
  };
}
