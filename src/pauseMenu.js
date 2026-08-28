// pauseMenu.js — B12.T3 (Three-Hats report §2, screen-level directives):
// a real pause menu for plain freestyle flight.
//
// OWNERSHIP: the inputGuard Escape ladder decides WHEN this menu opens or
// closes (freestyle only, nothing else open, follow-cam inactive — see
// inputGuard.js steps 0b/5); this module owns only the card itself and the
// pause/resume side effect. While open, a capture-phase keydown listener
// swallows every key except Tab / Enter / Escape (startScreen.js pattern)
// so flight keys, P, and warp shortcuts cannot reach the sim behind the
// modal; Tab keeps keyboard nav, Enter activates the focused button, and
// Escape is left for the ladder (registered earlier, so it runs first).
//
// Visuals reuse the gc-card idiom (briefing / debrief / confirm cards) —
// no new CSS beyond the #pauseMenu overlay selectors in index.html.

/** @type {HTMLElement|null} */
let _card = null;
/** @type {HTMLButtonElement|null} */
let _resumeBtn = null;
let _deps = null;

function _setPaused(on) {
  const drone = _deps?.drone;
  if (!drone || drone.paused === on) return;
  drone.paused = on;
  drone.onPauseChange?.(on);
}

function _build() {
  const overlay = document.createElement("div");
  overlay.id = "pauseMenu";
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", "Pause menu");
  overlay.setAttribute("hidden", "");

  const card = document.createElement("div");
  card.className = "gc-card";

  const title = document.createElement("div");
  title.className = "gc-title";
  title.textContent = "PAUSED";

  const btns = document.createElement("div");
  btns.className = "gc-btns pm-btns";

  _resumeBtn = document.createElement("button");
  _resumeBtn.type = "button";
  _resumeBtn.className = "gc-btn-primary";
  _resumeBtn.textContent = "Resume (Esc)";
  _resumeBtn.addEventListener("click", () => close());

  const restartBtn = document.createElement("button");
  restartBtn.type = "button";
  restartBtn.className = "gc-btn-secondary";
  restartBtn.textContent = "Restart flight";
  restartBtn.addEventListener("click", () => {
    close();
    _deps?.onRestart?.();
  });

  const menuBtn = document.createElement("button");
  menuBtn.type = "button";
  menuBtn.className = "gc-btn-secondary";
  menuBtn.textContent = "Main menu";
  menuBtn.addEventListener("click", () => {
    close(); // resume so a Tour/Play pick starts from a running sim
    _deps?.startScreen?.reopen?.();
  });

  btns.appendChild(_resumeBtn);
  btns.appendChild(restartBtn);
  btns.appendChild(menuBtn);

  card.appendChild(title);
  card.appendChild(btns);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  return overlay;
}

/** @returns {boolean} */
export function isOpen() {
  return !!_card && !_card.hasAttribute("hidden");
}

export function open() {
  if (!_deps) return;
  if (!_card) _card = _build();
  if (isOpen()) return;
  _setPaused(true);
  _card.removeAttribute("hidden");
  _resumeBtn?.focus();
}

export function close() {
  if (!isOpen()) return;
  _card.setAttribute("hidden", "");
  _setPaused(false);
}

/**
 * @param {{drone: object, onRestart: Function, startScreen: object}} deps
 * @returns {{isOpen: Function, open: Function, close: Function}}
 */
export function installPauseMenu(deps) {
  _deps = deps;
  window.addEventListener("keydown", (e) => {
    if (!isOpen()) return;
    if (e.key === "Tab" || e.key === "Enter" || e.key === "Escape") return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true /* capture */);
  return { isOpen, open, close };
}
