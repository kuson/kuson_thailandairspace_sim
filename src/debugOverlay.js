// debugOverlay.js — renderer.info debug panel. Visibility is driven by
// uiPrefs (backquote → uiPrefs.toggle('debugOverlay') → setVisible below).
const SAMPLE_WINDOW = 30;
const DOM_THROTTLE_MS = 250;

// state_TODO §3: frame-budget logger behind ?debug=1. Lives here (not
// main.js) because update() is already the loop's once-per-frame timing
// seam. When the flag is absent `budget` below stays null — one falsy test
// per frame, no allocation, no logging.
const BUDGET_EMIT_MS = 5000;   // one console.info line every ~5 s
const BUDGET_WINDOW = 2048;    // ring capacity; a 5 s interval at 60 fps is ~300
const BUDGET_PAUSE_MS = 1000;  // gaps this long are tab-pauses, not frame cost

function budgetFlagOn() {
  try {
    return new URLSearchParams(window.location.search).get("debug") === "1";
  } catch {
    return false;
  }
}

export function installDebugOverlay(renderer) {
  const panel = document.createElement("div");
  Object.assign(panel.style, {
    position: "fixed",
    top: "8px",
    right: "8px",
    padding: "6px 10px",
    background: "var(--hud-bg)",
    color: "#c8e6ff",
    fontFamily: "ui-monospace, monospace",
    fontSize: "11px",
    lineHeight: "1.6",
    whiteSpace: "pre",
    pointerEvents: "none",
    zIndex: "9999",
    borderRadius: "4px",
    display: "none",
  });
  document.body.appendChild(panel);

  let visible = false;
  const frameTimes = [];
  let lastDomWrite = 0;

  // Frame-budget accumulator — allocated once, and only under ?debug=1.
  const budget = budgetFlagOn()
    ? { samples: new Float64Array(BUDGET_WINDOW), n: 0, lastNow: 0, lastEmit: 0 }
    : null;

  function emitBudget(now) {
    const n = Math.min(budget.n, BUDGET_WINDOW);
    if (n === 0) return;
    // Sorting a copy allocates, but only here — once per ~5 s, never per frame.
    const s = Array.from(budget.samples.subarray(0, n)).sort((a, b) => a - b);
    let sum = 0;
    for (let i = 0; i < n; i++) sum += s[i];
    const avg = sum / n;
    const p95 = s[Math.min(n - 1, Math.floor(n * 0.95))];
    const worst = s[n - 1];
    console.info(
      `[frame-budget] avg ${avg.toFixed(1)}ms | p95 ${p95.toFixed(1)}ms | ` +
      `worst ${worst.toFixed(1)}ms (${n} frames / ${((now - budget.lastEmit) / 1000).toFixed(1)}s)`
    );
  }

  function setVisible(next) {
    visible = !!next;
    panel.style.display = visible ? "block" : "none";
  }

  function update() {
    const now = performance.now();
    frameTimes.push(now);
    if (frameTimes.length > SAMPLE_WINDOW) frameTimes.shift();

    if (budget) {
      if (budget.lastNow > 0) {
        const ms = now - budget.lastNow;
        // Skip tab-hidden / long-pause gaps so "worst" stays a frame number.
        if (ms < BUDGET_PAUSE_MS) {
          budget.samples[budget.n % BUDGET_WINDOW] = ms;
          budget.n++;
        }
      } else {
        budget.lastEmit = now;   // first frame starts the emit clock
      }
      budget.lastNow = now;
      if (budget.lastEmit > 0 && now - budget.lastEmit >= BUDGET_EMIT_MS) {
        emitBudget(now);
        budget.lastEmit = now;
        budget.n = 0;            // per-interval stats, not lifetime
      }
    }

    if (!visible) return;

    if (now - lastDomWrite < DOM_THROTTLE_MS) return;
    lastDomWrite = now;

    let fps = 0;
    if (frameTimes.length >= 2) {
      const span = frameTimes[frameTimes.length - 1] - frameTimes[0];
      fps = ((frameTimes.length - 1) / (span / 1000));
    }

    const ri = renderer.info;
    panel.textContent = [
      `FPS      ${fps.toFixed(1)}`,
      `calls    ${ri.render.calls}`,
      `tris     ${ri.render.triangles}`,
      `geoms    ${ri.memory.geometries}`,
      `textures ${ri.memory.textures}`,
      `programs ${(ri.programs?.length ?? 0)}`,
    ].join("\n");
  }

  return { update, setVisible };
}
