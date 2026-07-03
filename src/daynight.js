// daynight.js — B10.T4 day/dusk/night cycle.
// Drives fog colour, hemi/sun light, tile tint, and sky-dome uniforms.
//
// API: installDayNight({ scene, skyRig, hemi, sun, groundTiles })
//   → { update(dt), setMode(m), getMode(), getNightFactor(), onModeChange }
//   onModeChange is a settable property (fn(mode)) — fires at the end of
//   setMode(), for every caller, so a UI control can stay in sync without
//   owning a second copy of "current mode" (B11.T14 bug b fix).
//
// Modes: "day" | "dusk" | "night" | "auto"
//   auto = Asia/Bangkok wall-clock hours/24.
//   day   t = 0.5 (noon)
//   dusk  t = 0.75 (late afternoon / golden hour)
//   night t = 0.0 (midnight)
//
// t ∈ [0,1): 0 = midnight, 0.5 = noon. Smoothstep blend between three bands:
//   DAY    [0.35 … 0.65]
//   DUSK   peak  0.75
//   NIGHT  [0.85 … 0.15] (wraps through 0)
//
// Per-frame budget: lerp + scalar assignments only — NO allocation.
// Scratch THREE.Color instances are module-level singletons.

// ---------------------------------------------------------------------------
// Persistence (mirrors groundSettings.js idiom)
// ---------------------------------------------------------------------------

const LS_KEY = "kuson.daynight.v1";
const DEFAULT_DAYNIGHT = { mode: "day" };

export function getDayNightSettings() {
  try {
    const raw = globalThis.localStorage?.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_DAYNIGHT };
    return { ...DEFAULT_DAYNIGHT, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_DAYNIGHT };
  }
}

export function setDayNightSettings(patch) {
  const next = { ...getDayNightSettings(), ...patch };
  try {
    globalThis.localStorage?.setItem(LS_KEY, JSON.stringify(next));
  } catch {
    /* localStorage missing / quota / private mode — in-memory only */
  }
  return next;
}

// ---------------------------------------------------------------------------
// Ramp-table constants  (DAY values copied byte-for-byte from main.js/sky.js)
// ---------------------------------------------------------------------------

// Fog colour
const FOG_DAY   = 0xa6cdee;
const FOG_DUSK  = 0xd9a07a;
const FOG_NIGHT = 0x0a1020;

// HemisphereLight: sky / ground
const HEMI_SKY_DAY   = 0xc6d8f0;
const HEMI_GND_DAY   = 0x394a3a;
const HEMI_INT_DAY   = 1.0;

const HEMI_SKY_DUSK  = 0xc6d8f0;  // same hues as spec
const HEMI_GND_DUSK  = 0x394a3a;
const HEMI_INT_DUSK  = 0.55;

const HEMI_SKY_NIGHT = 0x223048;
const HEMI_GND_NIGHT = 0x0a0f0a;
const HEMI_INT_NIGHT = 0.12;

// DirectionalLight (sun)
const SUN_COL_DAY   = 0xfff2d8;
const SUN_INT_DAY   = 1.1;
const SUN_COL_DUSK  = 0xffb070;
const SUN_INT_DUSK  = 0.5;
const SUN_INT_NIGHT = 0.0;

// Tile tint (scalar)
const TILE_DAY   = 0xffffff;
const TILE_DUSK  = 0xd8c8b8;
const TILE_NIGHT = 0x4a5566;

// Sky-dome Preetham params (DAY = today's BASE values from sky.js)
// The sky module uses u.turbidity / u.rayleigh / u.mieCoefficient / u.mieDirectionalG.
// updateSky() already scales rayleigh + mieCoefficient by altitude-k each frame —
// we write the BASE-level targets into the module's per-frame value instead of
// fighting them. Since updateSky() overwrites those uniforms using BASE * k, we
// store our own override on the rig object and patch updateSky's read path
// only when needed.  SAFER APPROACH: we drive sunPosition + write turbidity,
// mieDirectionalG (which updateSky does NOT touch), and set rayleigh/mieCoef
// targets that updateSky will scale by altitude-k on the same frame — that is,
// we write AFTER updateSky so our values land last in the frame.

// Sky colour approach: The Three.js Sky shader (Preetham) cannot produce an
// arbitrary horizon/top colour — it derives those from physics params.  For
// dusk/night we therefore: (a) fade rayleigh → 0 to darken the dome and (b)
// inject fog colour into the renderer clear colour so the horizon reads the
// target hue (night = very dark blue).  The spec says "horizon 0xff9e5e / top
// 0x2a3a6e" for dusk and "horizon 0x0d1626 / top 0x05080f" for night — these
// are the fog + renderer-clear proxies, not raw Preetham outputs. We implement
// them through:
//   • fog.color   (horizon / ground-level haze — already driven here)
//   • renderer.setClearColor (if available — optional; main.js doesn't call it)
//   • rayleigh / turbidity / mieCoefficient scale toward 0 at night (dome goes dark)
//
// This does NOT touch sky.js internals. updateSky() runs before us each frame
// (see _safe("sky-follow") at line ~727 of main.js vs our _safe("daynight") inserted
// after it). We write to the same uniforms AFTER updateSky so our dusk/night values
// win. At DAY we let updateSky's normal outputs stand (parity guaranteed by
// short-circuit when nightFactor === 0).

const SKY_RAYLEIGH_DAY  = 4;
const SKY_RAYLEIGH_DUSK = 1.5;
const SKY_RAYLEIGH_NIGHT = 0.0;

const SKY_TURB_DAY   = 3;
const SKY_TURB_DUSK  = 6;
const SKY_TURB_NIGHT = 0.05;

const SKY_MIE_COE_DAY  = 0.004;
const SKY_MIE_COE_DUSK = 0.02;
const SKY_MIE_COE_NIGHT = 0.0;

const SKY_MIE_G_DAY   = 0.8;
const SKY_MIE_G_DUSK  = 0.95;
const SKY_MIE_G_NIGHT = 0.8;

// ---------------------------------------------------------------------------
// Module-level scratch (no allocation in update())
// ---------------------------------------------------------------------------

import * as THREE from "three";

const _cFog    = new THREE.Color();
const _cHemiSky= new THREE.Color();
const _cHemiGnd= new THREE.Color();
const _cSunCol = new THREE.Color();
const _cTile   = new THREE.Color();

// Colour constants (set once)
const C_FOG_DAY    = new THREE.Color(FOG_DAY);
const C_FOG_DUSK   = new THREE.Color(FOG_DUSK);
const C_FOG_NIGHT  = new THREE.Color(FOG_NIGHT);

const C_HEMI_SKY_DAY  = new THREE.Color(HEMI_SKY_DAY);
const C_HEMI_GND_DAY  = new THREE.Color(HEMI_GND_DAY);
const C_HEMI_SKY_DUSK = new THREE.Color(HEMI_SKY_DUSK);
const C_HEMI_GND_DUSK = new THREE.Color(HEMI_GND_DUSK);
const C_HEMI_SKY_NIGHT= new THREE.Color(HEMI_SKY_NIGHT);
const C_HEMI_GND_NIGHT= new THREE.Color(HEMI_GND_NIGHT);

const C_SUN_DAY   = new THREE.Color(SUN_COL_DAY);
const C_SUN_DUSK  = new THREE.Color(SUN_COL_DUSK);
const C_SUN_NIGHT = new THREE.Color(0x102040);  // placeholder; intensity → 0

const C_TILE_DAY   = new THREE.Color(TILE_DAY);
const C_TILE_DUSK  = new THREE.Color(TILE_DUSK);
const C_TILE_NIGHT = new THREE.Color(TILE_NIGHT);

// ---------------------------------------------------------------------------
// Smoothstep helper (no allocation)
// ---------------------------------------------------------------------------

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// t-to-blend conversion
// Outputs: { dayW, duskW, nightW } summing to 1.
// ---------------------------------------------------------------------------

function blendWeights(t) {
  // Wrap t to [0,1)
  t = ((t % 1) + 1) % 1;

  // Night spans [0.85, 0.15] wrapping through 0.
  // Convert to a single "night-nearness" value in [0,1].
  let nightNear;
  if (t >= 0.85) {
    // 0.85 → 1.0 maps to 0 → 1
    nightNear = smoothstep(0.85, 1.0, t);
  } else if (t <= 0.15) {
    // 0.0 → 0.15 maps to 1 → 0
    nightNear = smoothstep(0.15, 0.0, t);
  } else {
    nightNear = 0;
  }

  // Day spans [0.35, 0.65].
  let dayNear;
  if (t >= 0.35 && t <= 0.65) {
    // bell: rises 0.35→0.5, falls 0.5→0.65
    if (t <= 0.5) {
      dayNear = smoothstep(0.35, 0.5, t);
    } else {
      dayNear = smoothstep(0.65, 0.5, t);
    }
  } else {
    dayNear = 0;
  }

  // Dusk peak 0.75 — transitions between day-end (0.65) and night-start (0.85)
  let duskNear = 0;
  if (t > 0.65 && t < 0.85) {
    // rise 0.65→0.75, fall 0.75→0.85
    if (t <= 0.75) {
      duskNear = smoothstep(0.65, 0.75, t);
    } else {
      duskNear = smoothstep(0.85, 0.75, t);
    }
  }
  // Dawn transition (mirror on the morning side): 0.15→0.35
  if (t >= 0.15 && t <= 0.35) {
    // treat as dusk-mirror: 0.15→0.25 rise, 0.25→0.35 fall
    let d;
    if (t <= 0.25) {
      d = smoothstep(0.15, 0.25, t);
    } else {
      d = smoothstep(0.35, 0.25, t);
    }
    duskNear = Math.max(duskNear, d);
  }

  // Normalise so they sum to 1
  const sum = dayNear + duskNear + nightNear;
  if (sum < 1e-9) {
    // t is in a pure transition — dusk dominates the transition gaps
    return { dayW: 0, duskW: 1, nightW: 0 };
  }
  return { dayW: dayNear / sum, duskW: duskNear / sum, nightW: nightNear / sum };
}

// ---------------------------------------------------------------------------
// Main factory
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {THREE.Scene}          opts.scene
 * @param {object}               opts.skyRig      — return value of installSky()
 * @param {THREE.HemisphereLight}opts.hemi
 * @param {THREE.DirectionalLight}opts.sun
 * @param {object}               opts.groundTiles — DynamicGround instance
 */
export function installDayNight({ scene, skyRig, hemi, sun, groundTiles }) {
  let _mode   = getDayNightSettings().mode ?? "day";
  let _t      = _modeToT(_mode);
  let _applied = false;   // true after first write so day short-circuit works

  // nightFactor: 0 = full day, 1 = full night (for B10.T5)
  let _nightFactor = 0;

  function _modeToT(m) {
    switch (m) {
      case "dusk":  return 0.75;
      case "night": return 0.0;
      case "auto":  return _bangkokT();
      default:      return 0.5;   // "day"
    }
  }

  function _bangkokT() {
    // Asia/Bangkok = UTC+7; toLocaleString with timeZone gives local hours
    const now = new Date();
    // Use Intl to get Bangkok hour accurately without depending on system TZ
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Bangkok",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: false,
    }).formatToParts(now);
    let h = 0, m = 0, s = 0;
    for (const p of parts) {
      if (p.type === "hour")   h = Number(p.value);
      if (p.type === "minute") m = Number(p.value);
      if (p.type === "second") s = Number(p.value);
    }
    return (h * 3600 + m * 60 + s) / 86400;
  }

  // Sun azimuth: simple east→west arc across the day.
  // At t=0 (midnight) sun is below horizon (y < 0).
  // At t=0.5 (noon)   sun is high (original SUN_DIR).
  // We keep the original SUN_DIR magnitude and rotate around the Z axis.
  // Original SUN_DIR = (0.5, 1.0, 0.4).normalize() — stored in skyRig.sunDir.
  const _origSunDir = skyRig ? skyRig.sunDir.clone() : new THREE.Vector3(0.5, 1.0, 0.4).normalize();

  function _updateSunDirection(t) {
    if (!sun || !skyRig) return;
    // Map t ∈ [0,1) → angle. noon (t=0.5) = straight up (angle=π/2 from east).
    // At t=0 (midnight) sun is directly below (angle = -π/2).
    // Simple formula: angle = 2π * (t - 0.5) → -π at midnight, +π at next midnight.
    // We clamp the y so the sun never flips underground on the visible arc.
    const angle = Math.PI * 2 * (t - 0.25);  // 0.25 offset → rises in east
    const sinA = Math.sin(angle);
    const cosA = Math.cos(angle);
    // East–west sweep: x swings from east (+) through west (-); y arcs high at noon.
    // We use a simple circular path in the XY plane, scaled to match the original
    // magnitude (≈1.15 normalised).
    skyRig.sunDir.set(cosA, sinA, _origSunDir.z).normalize();
    sun.position.copy(skyRig.sunDir);
    // sunSprite position is updated by updateSky() each frame using rig.sunDir,
    // so writing sunDir here is sufficient — no need to touch sky.js.
  }

  function update(/* dt */) {
    // Update t from mode
    if (_mode === "auto") {
      _t = _bangkokT();
    }
    // else: static preset — _t never changes

    const { dayW, duskW, nightW } = blendWeights(_t);
    // Darkness progression, not the night-band weight: dusk peak reads ≈0.6
    // (T4 pass criterion 0 / ≈0.6 / 1 at day/dusk/night — T5 light fade rides it).
    _nightFactor = Math.min(1, nightW + duskW * 0.6);

    // --- DAY short-circuit: exact parity guarantee --------------------------
    // When pure day (nightW≈0, duskW≈0), write exact DAY constants (not lerp
    // outputs that could be 1e-7 off), then mark applied and return.
    if (dayW >= 1 - 1e-9 && _mode !== "auto") {
      if (_applied && _mode === "day") {
        // Already applied exact day — skip writes to save ALU
        return;
      }
      _applyExactDay();
      _applied = true;
      return;
    }
    _applied = false;  // re-arm for next time we enter pure day

    // --- Lerp: fog colour ---------------------------------------------------
    _cFog.copy(C_FOG_DAY).lerp(C_FOG_DUSK, duskW + nightW > 0 ? duskW / (duskW + nightW + 1e-9) * (duskW + nightW) : 0);
    // Three-way blend: day→dusk→night
    _cFog.set(
      C_FOG_DAY.r * dayW + C_FOG_DUSK.r * duskW + C_FOG_NIGHT.r * nightW,
      C_FOG_DAY.g * dayW + C_FOG_DUSK.g * duskW + C_FOG_NIGHT.g * nightW,
      C_FOG_DAY.b * dayW + C_FOG_DUSK.b * duskW + C_FOG_NIGHT.b * nightW,
    );
    if (scene.fog) scene.fog.color.copy(_cFog);

    // --- Hemi sky -----------------------------------------------------------
    _cHemiSky.set(
      C_HEMI_SKY_DAY.r * dayW + C_HEMI_SKY_DUSK.r * duskW + C_HEMI_SKY_NIGHT.r * nightW,
      C_HEMI_SKY_DAY.g * dayW + C_HEMI_SKY_DUSK.g * duskW + C_HEMI_SKY_NIGHT.g * nightW,
      C_HEMI_SKY_DAY.b * dayW + C_HEMI_SKY_DUSK.b * duskW + C_HEMI_SKY_NIGHT.b * nightW,
    );
    _cHemiGnd.set(
      C_HEMI_GND_DAY.r * dayW + C_HEMI_GND_DUSK.r * duskW + C_HEMI_GND_NIGHT.r * nightW,
      C_HEMI_GND_DAY.g * dayW + C_HEMI_GND_DUSK.g * duskW + C_HEMI_GND_NIGHT.g * nightW,
      C_HEMI_GND_DAY.b * dayW + C_HEMI_GND_DUSK.b * duskW + C_HEMI_GND_NIGHT.b * nightW,
    );
    if (hemi) {
      hemi.color.copy(_cHemiSky);
      hemi.groundColor.copy(_cHemiGnd);
      hemi.intensity = HEMI_INT_DAY * dayW + HEMI_INT_DUSK * duskW + HEMI_INT_NIGHT * nightW;
    }

    // --- Sun ----------------------------------------------------------------
    _cSunCol.set(
      C_SUN_DAY.r * dayW + C_SUN_DUSK.r * duskW + C_SUN_NIGHT.r * nightW,
      C_SUN_DAY.g * dayW + C_SUN_DUSK.g * duskW + C_SUN_NIGHT.g * nightW,
      C_SUN_DAY.b * dayW + C_SUN_DUSK.b * duskW + C_SUN_NIGHT.b * nightW,
    );
    if (sun) {
      sun.color.copy(_cSunCol);
      sun.intensity = SUN_INT_DAY * dayW + SUN_INT_DUSK * duskW + SUN_INT_NIGHT * nightW;
    }

    // --- Sun azimuth --------------------------------------------------------
    _updateSunDirection(_t);

    // --- Sky dome uniforms (written AFTER updateSky so we win) ---------------
    if (skyRig?.sky?.material?.uniforms) {
      const u = skyRig.sky.material.uniforms;
      u.rayleigh.value       = SKY_RAYLEIGH_DAY * dayW + SKY_RAYLEIGH_DUSK * duskW + SKY_RAYLEIGH_NIGHT * nightW;
      u.turbidity.value      = SKY_TURB_DAY * dayW + SKY_TURB_DUSK * duskW + SKY_TURB_NIGHT * nightW + 0.05;
      u.mieCoefficient.value = SKY_MIE_COE_DAY * dayW + SKY_MIE_COE_DUSK * duskW + SKY_MIE_COE_NIGHT * nightW;
      u.mieDirectionalG.value= SKY_MIE_G_DAY * dayW + SKY_MIE_G_DUSK * duskW + SKY_MIE_G_NIGHT * nightW;
      u.sunPosition.value.copy(skyRig.sunDir);
    }
    // sunSprite opacity is managed by updateSky() (altitude fade) — leave alone
    // except at full night where we hide it entirely.
    if (skyRig?.sunSprite) {
      skyRig.sunSprite.visible = nightW < 0.95;
    }

    // --- Tile tint ----------------------------------------------------------
    // ONLY tint tiles that have a texture loaded (mat.map set) — leave
    // still-loading tiles (deep-ocean placeholder 0x10416e) untouched.
    if (groundTiles?._tiles) {
      _cTile.set(
        C_TILE_DAY.r * dayW + C_TILE_DUSK.r * duskW + C_TILE_NIGHT.r * nightW,
        C_TILE_DAY.g * dayW + C_TILE_DUSK.g * duskW + C_TILE_NIGHT.g * nightW,
        C_TILE_DAY.b * dayW + C_TILE_DUSK.b * duskW + C_TILE_NIGHT.b * nightW,
      );
      for (const [, e] of groundTiles._tiles) {
        const mat = e.mesh?.material;
        if (mat && mat.map) {
          mat.color.copy(_cTile);
        }
      }
    }
  }

  function _applyExactDay() {
    if (scene.fog) scene.fog.color.setHex(FOG_DAY);
    if (hemi) {
      hemi.color.setHex(HEMI_SKY_DAY);
      hemi.groundColor.setHex(HEMI_GND_DAY);
      hemi.intensity = HEMI_INT_DAY;
    }
    if (sun) {
      sun.color.setHex(SUN_COL_DAY);
      sun.intensity = SUN_INT_DAY;
    }
    // Restore original sun direction (noon)
    if (skyRig) {
      skyRig.sunDir.copy(_origSunDir);
      if (sun) sun.position.copy(_origSunDir);
    }
    // Sky uniforms — restore BASE values exactly (matches sky.js BASE object)
    if (skyRig?.sky?.material?.uniforms) {
      const u = skyRig.sky.material.uniforms;
      u.rayleigh.value        = SKY_RAYLEIGH_DAY;
      u.turbidity.value       = SKY_TURB_DAY;
      u.mieCoefficient.value  = SKY_MIE_COE_DAY;
      u.mieDirectionalG.value = SKY_MIE_G_DAY;
      u.sunPosition.value.copy(_origSunDir);
    }
    if (skyRig?.sunSprite) skyRig.sunSprite.visible = true;
    // Tile tint: 0xffffff only on textured tiles
    if (groundTiles?._tiles) {
      for (const [, e] of groundTiles._tiles) {
        const mat = e.mesh?.material;
        if (mat && mat.map) mat.color.setHex(TILE_DAY);
      }
    }
    _nightFactor = 0;
  }

  // B11.T14 fix (bug b, part 1): setMode() previously had no way to notify
  // callers of a mode change, so the WORLD-panel dropdown (ui.js #optTimeOfDay)
  // only reflected the engine mode when the CHANGE CAME FROM THE DROPDOWN
  // ITSELF. Any other caller (debug console, game trigger, future code) left
  // the select showing the old value. onModeChange is the single hook every
  // mode-change path (including the dropdown's own handler) now funnels
  // through, so ui.js can register once and stay correct regardless of
  // call site — the dropdown becomes a pure reflection of engine state
  // instead of a second, independently-mutated copy of it.
  let _onModeChange = null;

  function setMode(m) {
    _mode   = m;
    _t      = _modeToT(m);
    _applied = false;  // force re-apply
    setDayNightSettings({ mode: m });
    _onModeChange?.(m);
  }

  function getMode() {
    return _mode;
  }

  function getNightFactor() {
    return _nightFactor;
  }

  return {
    update,
    setMode,
    getMode,
    getNightFactor,
    set onModeChange(fn) { _onModeChange = fn; },
  };
}
