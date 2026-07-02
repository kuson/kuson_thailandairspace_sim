// theme.js — Betterment-11 theme token system (B11.T3). Owns the JS-side
// canvas/branch palettes and the active-theme state machine. CSS custom
// properties (index.html :root + :root[data-theme="…"] blocks) own every
// DOM color; this module never touches DOM styles directly beyond flipping
// the `data-theme` attribute that the CSS selectors key off of.
const LS_KEY = "kuson.theme.v1";

// classic canvas values copied EXACTLY from today's literals (pre-task) —
// see src/ui.js _drawHeadingCompass / _drawAltTape / minimap draw code.
// accent  = rgb(102,255,204) == #66ffcc
// danger  = rgb(255,64,64)   == #ff4040 (today's rgba(255, 64, 64, …) literal)
export const THEMES = {
  classic: {
    label: "Classic",
    canvas: {
      accent: "102,255,204",
      accentDim: "71,179,143",
      mute: "138,150,167",
      marks: "255,255,255",
      danger: "255,64,64",
    },
    branch: { RTAF: "#19c9c1", RTN: "#2b4cd8", RTA: "#33a83a" },
  },
  daylight: {
    label: "Daylight",
    canvas: {
      accent: "11,127,106",
      accentDim: "8,89,74",
      mute: "90,102,118",
      marks: "16,22,30",
      danger: "200,30,58",
    },
    branch: { RTAF: "#0f8f86", RTN: "#2b4cd8", RTA: "#2f8a34" },
  },
  nvg: {
    label: "NVG",
    canvas: {
      accent: "57,255,92",
      accentDim: "40,179,64",
      mute: "80,168,96",
      marks: "157,255,176",
      danger: "255,210,63",
    },
    branch: { RTAF: "#39ff5c", RTN: "#9dffb0", RTA: "#22c93f" },
  },
  amber: {
    label: "Amber",
    canvas: {
      accent: "255,176,0",
      accentDim: "179,123,0",
      mute: "168,120,40",
      marks: "255,214,140",
      danger: "255,106,63",
    },
    branch: { RTAF: "#ffb000", RTN: "#ff8a00", RTA: "#d99400" },
  },
};

function readPersistedName() {
  try {
    const raw = globalThis.localStorage?.getItem(LS_KEY);
    if (!raw) return "classic";
    const parsed = JSON.parse(raw);
    return THEMES[parsed?.name] ? parsed.name : "classic";
  } catch {
    return "classic";
  }
}

export const theme = { current: THEMES[readPersistedName()] };

const _listeners = new Set();

/**
 * Compose an rgba() string from a theme.canvas.* "r,g,b" triplet + alpha.
 * Keeps the alpha value at every call site identical to today's literal
 * while sourcing the base color from the active theme.
 */
export function canvasAlpha(rgbTriplet, a) {
  return `rgba(${rgbTriplet},${a})`;
}

export function applyTheme(name) {
  if (!THEMES[name]) return;
  document.documentElement.dataset.theme = name;
  theme.current = THEMES[name];
  try {
    globalThis.localStorage?.setItem(LS_KEY, JSON.stringify({ name }));
  } catch {
    /* localStorage missing / quota / private mode — in-memory only */
  }
  for (const cb of _listeners) cb(name);
}

export function onThemeChange(cb) {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}
