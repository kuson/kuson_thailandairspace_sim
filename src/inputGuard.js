// inputGuard.js — B11.T7: single per-mode action guard + unified Escape
// ladder (design note §0.5.4).
//
// inputAllowed(action) is a PURE decision table consulted by existing
// keydown/click handlers (drone.js, ui.js, flightHistory undo, warp entry
// points). It reads live state through the four handles passed to install()
// — appMode (mode/detail source of truth, B11.T5), game (FSM state +
// typing-modal state, B7.T7/B7 typing.js), drone (flightLocked, B9/B10) —
// and never imports those modules directly, so a Node driver can exercise
// the full matrix with stub handles (see the throwaway driver used to
// verify every cell before shipping).
//
// Matrix (design §0.5.4):
//   WAVE blocks:            layerToggles, historyUndo, identify, warp.
//   BRIEFING/DEBRIEF block:  historyUndo, warp, identify.
//   Typing-modal-open blocks EVERYTHING.
//   Learning (tour) blocks:  warp, identify — but only while
//                            drone.flightLocked (tour sets this true for
//                            its own scripted stops; a caller that somehow
//                            reaches this with flightLocked false during
//                            "learning" is not blocked — defensive parity
//                            with the pre-existing drone.js `i` handler,
//                            which already gated identify on flightLocked
//                            alone, not on mode).
//   Freestyle blocks nothing.
//   Unknown/unlisted actions: always allowed (forward-compatible — a later
//   task adds 'focus').
//
// The Escape ladder (install()'s window keydown capture listener) is
// intentionally a SEPARATE concern from inputAllowed() — it doesn't consult
// the action matrix, it walks its own priority list (typing → WAVE abort
// confirm → briefing/debrief cancel → tour end confirm → confirm-card
// dismiss → noop) and only stopPropagation()s when it actually handles a
// step, so any retained listener (main.js:254 follow-cam release,
// typing.js's internal Escape, tutorial.js's own abort) still sees
// unhandled Escapes. See the Escape inventory in the B11.T7 report for the
// kept/superseded classification.

/** @type {object|null} */
let _appMode = null;
/** @type {object|null} */
let _game = null;
/** @type {object|null} */
let _drone = null;
/** @type {object|null} */
let _tourGuide = null;

/**
 * Wire the module's live state handles. Call once from main.js after
 * appMode, game, drone, and tourGuide all exist (mirrors uiProfiles.install's
 * call-once-after-construction pattern).
 * @param {{appMode: object, game: object, drone: object, tourGuide: object}} deps
 */
export function install({ appMode, game, drone, tourGuide }) {
  _appMode = appMode;
  _game = game;
  _drone = drone;
  _tourGuide = tourGuide;

  window.addEventListener("keydown", _onEscapeCapture, true /* capture */);
}

/** @returns {boolean} true iff a typing challenge is currently open. */
function _typingOpen() {
  return !!_game?.typing?.isOpen;
}

/**
 * Pure decision table. Never throws — a missing handle (e.g. a Node driver
 * stub that omits `game`) degrades to "no restriction from that handle",
 * matching how freestyle behaves when nothing is active.
 * @param {string} action one of "layerToggles"|"historyUndo"|"identify"|
 *   "warp"|"viewToggles"|"pause", or any forward-compatible future action.
 * @returns {boolean}
 */
export function inputAllowed(action) {
  // Typing modal open blocks everything (largely redundant with typing.js's
  // own capture-phase suppression — this is the defense-in-depth half for
  // any call site typing.js's listener doesn't reach, e.g. click-driven
  // warp/undo paths, which are mouse events typing.js never inspects).
  if (_typingOpen()) return false;

  const { mode, detail } = _appMode?.get?.() ?? { mode: "freestyle", detail: null };

  if (mode === "game" && detail === "wave") {
    if (action === "layerToggles") return false;
    if (action === "historyUndo") return false;
    if (action === "identify") return false;
    if (action === "warp") return false;
    return true; // viewToggles, pause, and anything unlisted stay allowed
  }

  if (mode === "game" && (detail === "briefing" || detail === "debrief")) {
    if (action === "historyUndo") return false;
    if (action === "warp") return false;
    if (action === "identify") return false;
    return true; // layerToggles, viewToggles, pause, unlisted stay allowed
  }

  if (mode === "learning") {
    if (_drone?.flightLocked) {
      if (action === "warp") return false;
      if (action === "identify") return false;
    }
    return true;
  }

  // freestyle (or any other/unrecognized mode) — blocks nothing.
  return true;
}

// ── Escape ladder ────────────────────────────────────────────────────────

/**
 * Capture-phase Escape ladder. Only stopPropagation()s on a step it
 * actually handles (1–4 below, or the confirm-card-open case) — an
 * unhandled Escape (step 5) falls through untouched so any retained
 * listener still fires.
 * @param {KeyboardEvent} e
 */
function _onEscapeCapture(e) {
  if (e.key !== "Escape") return;

  // A confirm card (abort-mission / end-tour) open takes priority over
  // everything below it — Escape dismisses the card (Continue semantics).
  // Must test open-ness, not existence: the node is lazily built once and
  // stays truthy forever, which would dead-end every later Escape here.
  if (_confirmCard && !_confirmCard.hasAttribute("hidden")) {
    e.preventDefault();
    e.stopPropagation();
    _dismissConfirmCard();
    return;
  }

  // 1) Typing modal open → let typing.js's own capture listener (registered
  // separately, see typing.js) handle abort. It's registered independently
  // of this listener; we simply decline to act so DOM listener order
  // between the two doesn't matter — whichever runs, only one does
  // anything, since typing.js checks its own `_open` flag.
  if (_typingOpen()) return;

  const { mode, detail } = _appMode?.get?.() ?? { mode: "freestyle", detail: null };

  // 2) WAVE → abort-confirm card (supersedes: nothing previously handled
  // Escape during WAVE — this is new coverage, not a takeover).
  if (mode === "game" && detail === "wave") {
    e.preventDefault();
    e.stopPropagation();
    _showConfirmCard({
      title: "ABORT MISSION?",
      body: "Progress in this wave will be lost.",
      confirmLabel: "Abort (Esc)",
      onConfirm: () => _game?.abort?.(),
    });
    return;
  }

  // 3) BRIEFING/DEBRIEF → close/cancel the card (supersedes gameMode.js's
  // own _briefingKeyListener / _debriefKeyListener Escape branches, which
  // are removed as part of this task — see the Escape inventory).
  if (mode === "game" && detail === "briefing") {
    e.preventDefault();
    e.stopPropagation();
    _game?._cancelBriefing?.();
    return;
  }
  if (mode === "game" && detail === "debrief") {
    e.preventDefault();
    e.stopPropagation();
    _game?._endDebrief?.();
    return;
  }

  // 4) Tour running → end-tour confirm card (the End-tour button ends
  // instantly; Escape gets a light confirm instead).
  if (mode === "learning" && _tourGuide?.running) {
    e.preventDefault();
    e.stopPropagation();
    _showConfirmCard({
      title: "END TOUR?",
      body: "You can restart the tour anytime from the panel.",
      confirmLabel: "End (Esc)",
      onConfirm: () => _tourGuide?.stop?.(),
    });
    return;
  }

  // 5) Else → noop. Do NOT stopPropagation — any other Escape listener
  // that legitimately remains (main.js:254 follow-cam release,
  // tutorial.js's own _escListener, typing.js's internal handler) still
  // sees this event.
}

// ── Confirm card (abort-mission / end-tour) ─────────────────────────────
//
// Reuses the gc-card / gc-title / gc-body / gc-btns / gc-btn-primary /
// gc-btn-secondary idiom already styled for the briefing/debrief cards
// (index.html) — no new CSS, no new DOM framework. One shared element,
// built lazily on first use, repurposed per call via textContent + a
// fresh onConfirm closure.

/** @type {HTMLElement|null} */
let _confirmCard = null;
/** @type {Function|null} */
let _confirmOnConfirm = null;

function _buildConfirmCard() {
  const overlay = document.createElement("div");
  overlay.id = "inputGuardConfirm";
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("hidden", "");

  const card = document.createElement("div");
  card.className = "gc-card";

  const title = document.createElement("div");
  title.className = "gc-title";
  title.id = "inputGuardConfirmTitle";

  const body = document.createElement("div");
  body.className = "gc-body";
  body.id = "inputGuardConfirmBody";

  const btns = document.createElement("div");
  btns.className = "gc-btns";

  const continueBtn = document.createElement("button");
  continueBtn.type = "button";
  continueBtn.className = "gc-btn-secondary";
  continueBtn.textContent = "Continue";
  continueBtn.addEventListener("click", () => _dismissConfirmCard());

  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "gc-btn-primary";
  confirmBtn.id = "inputGuardConfirmBtn";
  confirmBtn.addEventListener("click", () => {
    const cb = _confirmOnConfirm;
    _dismissConfirmCard();
    cb?.();
  });

  btns.appendChild(continueBtn);
  btns.appendChild(confirmBtn);

  card.appendChild(title);
  card.appendChild(body);
  card.appendChild(btns);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  return overlay;
}

/**
 * @param {{title: string, body: string, confirmLabel: string, onConfirm: Function}} opts
 */
function _showConfirmCard({ title, body, confirmLabel, onConfirm }) {
  if (!_confirmCard) _confirmCard = _buildConfirmCard();
  _confirmCard.querySelector("#inputGuardConfirmTitle").textContent = title;
  _confirmCard.querySelector("#inputGuardConfirmBody").textContent = body;
  _confirmCard.querySelector("#inputGuardConfirmBtn").textContent = confirmLabel;
  _confirmOnConfirm = onConfirm;
  _confirmCard.removeAttribute("hidden");
}

function _dismissConfirmCard() {
  _confirmCard?.setAttribute("hidden", "");
  _confirmOnConfirm = null;
}
