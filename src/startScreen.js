// startScreen.js — B7.T9: full-viewport start overlay with real load progress
// and three launch modes: Explore / Tour / Play.
//
// DESIGN NOTES:
//   • Built immediately in installStartScreen(); never blocks the sim if
//     construction throws (failure-safe stub returned instead).
//   • Progress bar advances with tick(label) — N_EXPECTED=6 steps, clamped
//     at 95% until ready() is called.
//   • ready({ onExplore, onTour, onPlay }) fills bar to 100% and shows three
//     launch buttons.  Last choice persisted in localStorage kuson.start.v1.
//   • fail(message) shows the error in red and keeps the overlay up.
//   • Keyboard: 1/2/3 select; Enter activates highlighted button.
//     Both capture-phase, gated on overlay visibility (same pattern as typing.js).
//     stopImmediatePropagation prevents any sim key reaching flight handlers.
//   • `dismissed` property becomes true when the user picks a mode OR when
//     the stub is returned after a construction error.

const LS_KEY  = "kuson.start.v1";
const N_EXPECTED = 6;   // expected tick() calls; progress clamped at 95% until ready()

// Thailand silhouette — simple stylised polygon (not a real shape, just
// evocative for a branding mark at ~80×140 px).
const THAILAND_PATH =
  "M 40,2 L 55,8 L 62,20 L 68,35 L 65,48 L 70,60 L 72,75 " +
  "L 65,88 L 58,100 L 55,115 L 48,132 L 42,138 L 38,128 " +
  "L 40,115 L 34,100 L 28,88 L 24,72 L 22,58 L 28,45 " +
  "L 26,32 L 30,18 L 38,6 Z";

function loadChoice() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return 0;
    const v = JSON.parse(raw);
    if (typeof v === "number" && v >= 0 && v <= 2) return v;
    return 0;
  } catch {
    return 0;
  }
}

function saveChoice(idx) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(idx));
  } catch {
    /* private mode — ignore */
  }
}

/** Build the start-screen and return its controller API. */
export function installStartScreen() {
  try {
    return _build();
  } catch (e) {
    console.warn("[startScreen] construction failed:", e);
    return { tick() {}, ready() {}, fail() {}, reopen() {}, dismissed: true };
  }
}

function _build() {
  let _dismissed = false;
  let _tickCount  = 0;
  let _handlers   = null;   // set by ready()
  let _highlighted = loadChoice();  // 0=Explore 1=Tour 2=Play

  // ── Overlay root ──────────────────────────────────────────────────────────
  const overlay = document.createElement("div");
  overlay.id = "startScreen";

  // ── Inner column ──────────────────────────────────────────────────────────
  const col = document.createElement("div");
  col.className = "ss-col";

  // Thailand SVG silhouette
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 94 140");
  svg.setAttribute("width",  "80");
  svg.setAttribute("height", "140");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svgNS, "path");
  path.setAttribute("d", THAILAND_PATH);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "#66ffcc");
  path.setAttribute("stroke-width", "2.5");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);

  // Title
  const title = document.createElement("h1");
  title.className = "ss-title";
  title.textContent = "THAI AIRSPACE SIM";

  // Progress bar wrapper
  const barOuter = document.createElement("div");
  barOuter.className = "ss-bar-outer";
  const barInner = document.createElement("div");
  barInner.className = "ss-bar-inner";
  barInner.style.width = "0%";
  barOuter.appendChild(barInner);

  // Status label
  const status = document.createElement("div");
  status.className = "ss-status";
  status.textContent = "Initialising…";

  // Buttons row (hidden until ready)
  const btnsRow = document.createElement("div");
  btnsRow.className = "ss-buttons";
  btnsRow.style.display = "none";

  const LABELS = [
    { emoji: "🗺",  text: "Explore" },
    { emoji: "🎓", text: "Tour (5 min)" },
    { emoji: "🛸", text: "Play — Sky Guardian" },
  ];
  const btns = LABELS.map((def, i) => {
    const b = document.createElement("button");
    b.className = "ss-btn";
    b.dataset.idx = String(i);
    b.innerHTML = `<span class="ss-btn-key">${i + 1}</span>` +
                  `<span class="ss-btn-emoji">${def.emoji}</span> ` +
                  `<span class="ss-btn-label">${def.text}</span>`;
    b.addEventListener("click", () => _activate(i));
    btnsRow.appendChild(b);
    return b;
  });

  // Assemble column
  col.appendChild(svg);
  col.appendChild(title);
  col.appendChild(barOuter);
  col.appendChild(status);
  col.appendChild(btnsRow);
  overlay.appendChild(col);
  document.body.appendChild(overlay);

  // ── Keyboard listeners (capture-phase, gated on visibility) ──────────────
  // Registered once, never removed (same pattern as typing.js).
  window.addEventListener("keydown", _onKeyDown, true);

  function _isVisible() {
    return !_dismissed && overlay.style.display !== "none";
  }

  function _onKeyDown(e) {
    if (!_isVisible()) return;
    e.stopImmediatePropagation();
    // Only process key actions when buttons are shown
    if (btnsRow.style.display === "none") { e.preventDefault(); return; }
    if (e.key === "1") { e.preventDefault(); _setHighlight(0); }
    else if (e.key === "2") { e.preventDefault(); _setHighlight(1); }
    else if (e.key === "3") { e.preventDefault(); _setHighlight(2); }
    else if (e.key === "Enter") { e.preventDefault(); _activate(_highlighted); }
  }

  function _setHighlight(idx) {
    _highlighted = idx;
    btns.forEach((b, i) => {
      b.classList.toggle("ss-btn--active", i === idx);
    });
  }

  function _setBarWidth(pct) {
    try { barInner.style.width = pct + "%"; } catch {}
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  function tick(label) {
    try {
      _tickCount = Math.min(_tickCount + 1, N_EXPECTED - 1);
      const pct = Math.round((_tickCount / N_EXPECTED) * 95);
      _setBarWidth(pct);
      status.textContent = label ?? "Loading…";
      status.style.color = "";
    } catch {}
  }

  function ready(handlers) {
    try {
      _handlers = handlers;
      _setBarWidth(100);
      status.style.display = "none";
      btnsRow.style.display = "flex";
      _setHighlight(_highlighted);
      // Focus the highlighted button so keyboard-Enter works immediately.
      btns[_highlighted]?.focus();
    } catch {}
  }

  function fail(message) {
    try {
      status.textContent = message ?? "Load failed.";
      status.style.color = "#ff5050";
    } catch {}
  }

  function _activate(idx) {
    try {
      if (!_handlers) return;
      saveChoice(idx);
      _dismissed = true;
      overlay.style.display = "none";
      const cbs = [_handlers.onExplore, _handlers.onTour, _handlers.onPlay];
      const cb  = cbs[idx];
      if (typeof cb === "function") cb();
    } catch {}
  }

  // B12.T3: pause menu's "Main menu" — re-show the overlay after a
  // dismissal. Handlers set by ready() persist, so a pick routes exactly
  // like the first time (Explore = just close, Tour/Play = start them).
  function reopen() {
    try {
      if (!_handlers) return; // never before ready()
      _dismissed = false;
      overlay.style.display = "";
      _setHighlight(_highlighted);
      btns[_highlighted]?.focus();
    } catch {}
  }

  return {
    tick,
    ready,
    fail,
    reopen,
    get dismissed() { return _dismissed; },
  };
}
