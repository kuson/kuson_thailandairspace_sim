import { bucketId } from "./gridMath.js";

const PRESET_MS = Object.freeze({
  "1h": 3600_000,
  "6h": 6 * 3600_000,
  "24h": 24 * 3600_000,
  "7d": 7 * 24 * 3600_000,
  all: Infinity,
});

const COLD = [20, 40, 120];
const CYAN = [0, 200, 200];
const YELLOW = [255, 220, 60];
const HOT = [220, 40, 40];

export function presetToMs(preset) {
  return PRESET_MS[preset] ?? PRESET_MS["24h"];
}

export function resolveWindow(settings, nowMs) {
  const { viewPreset, customFrom, customTo } = settings;

  if (viewPreset === "custom") {
    if (customFrom == null || customTo == null || customFrom >= customTo) {
      return null;
    }
    return {
      fromBucket: bucketId(customFrom),
      toBucket: bucketId(customTo),
    };
  }

  const spanMs = presetToMs(viewPreset);
  const toBucket = bucketId(nowMs);
  const fromBucket = spanMs === Infinity ? 0 : bucketId(nowMs - spanMs);
  return { fromBucket, toBucket };
}

export function bakeDensity(cellCounts, { cols, rows }) {
  const size = cols * rows;
  const counts = new Float32Array(size);

  for (const [key, value] of cellCounts) {
    const sep = key.indexOf(":");
    if (sep < 0) continue;
    const cellX = Number(key.slice(0, sep));
    const cellY = Number(key.slice(sep + 1));
    if (!Number.isFinite(cellX) || !Number.isFinite(cellY)) continue;
    if (cellX < 0 || cellY < 0 || cellX >= cols || cellY >= rows) continue;
    counts[cellY * cols + cellX] = value;
  }

  const logged = new Float32Array(size);
  let max = 0;
  for (let i = 0; i < size; i++) {
    const v = Math.log1p(counts[i]);
    logged[i] = v;
    if (v > max) max = v;
  }

  const density = new Float32Array(size);
  if (max > 0) {
    for (let i = 0; i < size; i++) {
      density[i] = logged[i] / max;
    }
  }
  return density;
}

function smoothstep(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

function mix(a, b, u) {
  return a + (b - a) * u;
}

function heatRgb(t) {
  if (t <= 0.33) {
    const u = t / 0.33;
    return [
      mix(COLD[0], CYAN[0], u),
      mix(COLD[1], CYAN[1], u),
      mix(COLD[2], CYAN[2], u),
    ];
  }
  if (t <= 0.66) {
    const u = (t - 0.33) / 0.33;
    return [
      mix(CYAN[0], YELLOW[0], u),
      mix(CYAN[1], YELLOW[1], u),
      mix(CYAN[2], YELLOW[2], u),
    ];
  }
  const u = (t - 0.66) / 0.34;
  return [
    mix(YELLOW[0], HOT[0], u),
    mix(YELLOW[1], HOT[1], u),
    mix(YELLOW[2], HOT[2], u),
  ];
}

export function densityToRgba(density, opacity) {
  const rgba = new Uint8ClampedArray(density.length * 4);
  for (let i = 0; i < density.length; i++) {
    const t = density[i];
    const base = i * 4;
    if (t <= 0) {
      rgba[base + 3] = 0;
      continue;
    }
    const [r, g, b] = heatRgb(t);
    rgba[base] = Math.round(r);
    rgba[base + 1] = Math.round(g);
    rgba[base + 2] = Math.round(b);
    rgba[base + 3] = Math.round(opacity * smoothstep(t) * 255);
  }
  return rgba;
}
