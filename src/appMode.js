// appMode.js — source of truth for the app-level mode/detail pair (B11.T5,
// design note §0.5.3 ¶1).
//
// `mode`   ∈ freestyle | learning | game
// `detail` ∈ null | briefing | wave | debrief | tutorial
//
// This module is a small event-source: it holds {mode, detail}, exposes
// get()/onChange(), and DERIVES its state from notifier calls made by the
// host (main.js) in response to game-state changes, tour start/stop, and
// tutorial start/end. It does NOT import game/tour/ui modules — all wiring
// happens in main.js — so it stays dependency-free and trivially testable
// (see the throwaway driver script used to verify the emitted sequence).

let _mode = "freestyle";
let _detail = null;

// Remembers the last known game-FSM state string so tutorial-end can
// re-derive the correct {game, detail} instead of hardcoding freestyle —
// tutorial is entered via BRIEFING→IDLE (B8) but must restore to whatever
// game state is "really" current (e.g. back to {game, briefing}).
let _lastGameState = "IDLE";

// Tracks whether a tour is currently running, purely to decide what
// notifyGameState(IDLE) should resolve to (freestyle/null only when no tour
// is in flight — tours never drive game state, but this keeps the two
// notifier families independent of call order).
let _tourRunning = false;

const _listeners = new Set();

/** @returns {{mode: string, detail: string|null}} */
export function get() {
  return { mode: _mode, detail: _detail };
}

/**
 * Subscribe to change events. `cb(prev, next)` fires only on an actual
 * change (mode or detail differs from the current value).
 * @param {(prev: {mode:string,detail:string|null}, next: {mode:string,detail:string|null}) => void} cb
 * @returns {Function} unsubscribe
 */
export function onChange(cb) {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

function _transition(mode, detail) {
  if (mode === _mode && detail === _detail) return;
  const prev = { mode: _mode, detail: _detail };
  _mode = mode;
  _detail = detail;
  const next = { mode: _mode, detail: _detail };
  for (const cb of _listeners) cb(prev, next);
}

// ── Game FSM notifier ────────────────────────────────────────────────────

/**
 * Called with the game-FSM state string on every GameMode `onState` tick.
 * IDLE resolves to freestyle/null unless a tour is currently running (tours
 * never touch game state directly, so this only matters if a caller somehow
 * notifies game IDLE mid-tour — kept for symmetry/defensiveness).
 * @param {"IDLE"|"BRIEFING"|"WAVE"|"DEBRIEF"} state
 */
export function notifyGameState(state) {
  _lastGameState = state;
  switch (state) {
    case "IDLE":
      if (!_tourRunning) _transition("freestyle", null);
      break;
    case "BRIEFING":
      _transition("game", "briefing");
      break;
    case "WAVE":
      _transition("game", "wave");
      break;
    case "DEBRIEF":
      _transition("game", "debrief");
      break;
  }
}

// ── Tour notifiers ───────────────────────────────────────────────────────

/** Tour started successfully — learning/null. */
export function notifyTourStart() {
  _tourRunning = true;
  _transition("learning", null);
}

/** Tour stopped (finished, skipped-to-end, or ended by the user) — freestyle/null. */
export function notifyTourStop() {
  _tourRunning = false;
  _transition("freestyle", null);
}

// ── Tutorial notifiers ───────────────────────────────────────────────────

/**
 * Tutorial entered. The game FSM hands tutorial through BRIEFING→IDLE (B8),
 * but app-mode-wise the tutorial is still "game" activity — game/tutorial.
 */
export function notifyTutorialStart() {
  _transition("game", "tutorial");
}

/**
 * Tutorial exited (finish or abort). Re-derives {game, detail} from the
 * last known game-FSM state rather than hardcoding freestyle — if tutorial
 * was entered from BRIEFING (the only path today) and the underlying game
 * state is still BRIEFING, this restores {game, briefing}; if the game FSM
 * has since gone IDLE it resolves to {freestyle, null}.
 */
export function notifyTutorialEnd() {
  switch (_lastGameState) {
    case "BRIEFING":
      _transition("game", "briefing");
      break;
    case "WAVE":
      _transition("game", "wave");
      break;
    case "DEBRIEF":
      _transition("game", "debrief");
      break;
    case "IDLE":
    default:
      _transition("freestyle", null);
      break;
  }
}
