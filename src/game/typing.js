// typing.js — TypingChallenge modal with hard flight-input suppression.
//
// INPUT SUPPRESSION DESIGN:
//   Two window-level CAPTURE-phase listeners are registered ONCE in the
//   constructor and gated on this.isOpen.  They are never removed, so
//   repeated open/close cannot leak or duplicate listeners.
//
//   keydown (capture): when open —
//     • target is the modal input  → stopImmediatePropagation (not
//       preventDefault, so text insertion works); handle Enter (resolve)
//       and Escape (cancel) with preventDefault.
//     • target is anything else    → preventDefault + stopImmediatePropagation
//       + refocus the input.
//   keyup (capture): when open → stopImmediatePropagation.
//
//   On open: drone.keys.clear() (same as the blur precedent in drone.js:1204)
//   and document.exitPointerLock?.() so the pointer is freed.
//
// This guarantees no flight key (w/a/s/d/q/e/i/k/p/v/r/space) reaches the
// drone's bubble-phase listeners while the modal is open, and no stale
// held-key persists from before open.

export class TypingChallenge {
  /**
   * @param {{ drone: object }} deps
   *   drone — Drone instance; must expose a `keys` Set.
   */
  constructor({ drone }) {
    this.drone = drone;

    /** @type {boolean} */
    this._open = false;

    /** @type {Function|null}  resolve callback for the pending Promise */
    this._resolve = null;

    /** Whether the promise has already been settled (guards one-shot). */
    this._settled = false;

    // ── Build DOM once ───────────────────────────────────────────────────────

    // Outer overlay (full-screen backdrop + flex centering).
    this._modal = document.createElement("div");
    this._modal.id = "typingModal";
    this._modal.setAttribute("aria-modal", "true");
    this._modal.setAttribute("role", "dialog");
    this._modal.setAttribute("aria-label", "Typing challenge");

    // Inner card — all content children live here.
    const card = document.createElement("div");
    card.className = "tc-card";

    this._promptEl = document.createElement("div");
    this._promptEl.className = "tc-prompt";

    this._glyphRow = document.createElement("div");
    this._glyphRow.className = "tc-glyphs";

    this._input = document.createElement("input");
    this._input.type = "text";
    this._input.autocomplete = "off";
    this._input.spellcheck = false;
    this._input.setAttribute("autocorrect", "off");
    this._input.setAttribute("autocapitalize", "off");
    this._input.className = "tc-input";
    this._input.setAttribute("aria-label", "Type the challenge text");

    this._barOuter = document.createElement("div");
    this._barOuter.className = "tc-bar-outer";
    this._barInner = document.createElement("div");
    this._barInner.className = "tc-bar-inner";
    this._barOuter.appendChild(this._barInner);

    this._hint = document.createElement("div");
    this._hint.className = "tc-hint";
    this._hint.textContent = "Enter = confirm · Esc = cancel";

    card.appendChild(this._promptEl);
    card.appendChild(this._glyphRow);
    card.appendChild(this._input);
    card.appendChild(this._barOuter);
    card.appendChild(this._hint);
    this._modal.appendChild(card);

    this._modal.style.display = "none";
    document.body.appendChild(this._modal);

    // ── State for the current challenge ─────────────────────────────────────

    /** @type {string} */        this._target   = "";
    /** @type {string[]} */      this._answers  = [];
    /** @type {number} */        this._timeoutS = 90;
    /** @type {number} */        this._startTs  = 0;
    /** @type {number} */        this._totalKeystrokes = 0;
    /** @type {number} */        this._wrongKeystrokes = 0;
    /** @type {string} */        this._prevNorm  = "";
    /** @type {number|null} */   this._tickId   = null;  // setInterval id

    // ── Permanent capture-phase listeners (gated on this._open) ─────────────

    window.addEventListener("keydown", (e) => {
      if (!this._open) return;
      if (e.target === this._input) {
        // Text insertion must proceed, so no preventDefault for regular keys.
        e.stopImmediatePropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          this._confirmInput();
        } else if (e.key === "Escape") {
          e.preventDefault();
          this._close({ correct: false, cancelled: true });
        }
      } else {
        // Any other target: block entirely and refocus input.
        e.preventDefault();
        e.stopImmediatePropagation();
        this._input.focus();
      }
    }, true /* capture */);

    window.addEventListener("keyup", (e) => {
      if (!this._open) return;
      e.stopImmediatePropagation();
    }, true /* capture */);

    // ── Input event for per-glyph feedback ──────────────────────────────────

    this._input.addEventListener("input", () => this._onInput());
  }

  // ── Public getters ──────────────────────────────────────────────────────────

  /** @returns {boolean} */
  get isOpen() { return this._open; }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Open the modal for a new challenge.
   *
   * @param {{
   *   prompt:    string,
   *   target:    string,
   *   answers:   string[],
   *   timeoutS?: number,
   * }} opts
   * @returns {Promise<{correct:boolean, elapsedS:number, accuracy:number,
   *                    wpm:number, cancelled?:boolean, timeout?:boolean}>|null}
   *   Returns null if already open.
   */
  open({ prompt, target, answers, timeoutS = 90 }) {
    if (this._open) return null;

    // ── Suppress stale held keys / pointer lock ──────────────────────────────
    this.drone.keys.clear();
    document.exitPointerLock?.();

    // ── Reset state ──────────────────────────────────────────────────────────
    this._target          = target;
    this._answers         = answers;
    this._timeoutS        = timeoutS;
    this._startTs         = performance.now();
    this._totalKeystrokes = 0;
    this._wrongKeystrokes = 0;
    this._prevNorm        = "";
    this._settled         = false;
    this._resolve         = null;

    // ── Build glyph spans ────────────────────────────────────────────────────
    this._glyphRow.innerHTML = "";
    this._glyphs = Array.from(target).map((ch) => {
      const s = document.createElement("span");
      s.className = "glyph-dim";
      s.textContent = ch;
      this._glyphRow.appendChild(s);
      return s;
    });

    // ── Reset input + prompt ─────────────────────────────────────────────────
    this._input.value = "";
    this._promptEl.textContent = prompt;
    this._barInner.style.width = "100%";

    // ── Show modal ───────────────────────────────────────────────────────────
    this._modal.style.display = "";
    this._open = true;

    // Focus after display so the browser honours it.
    requestAnimationFrame(() => this._input.focus());

    // ── Countdown bar ────────────────────────────────────────────────────────
    const started = performance.now();
    this._tickId = setInterval(() => {
      if (!this._open) return;
      const elapsed = (performance.now() - started) / 1000;
      const frac = Math.max(0, 1 - elapsed / this._timeoutS);
      this._barInner.style.width = `${(frac * 100).toFixed(1)}%`;
      if (frac <= 0) {
        this._close({
          correct:  false,
          timeout:  true,
          elapsedS: this._timeoutS,
          accuracy: this._accuracy(),
          wpm:      this._wpm(this._timeoutS),
        });
      }
    }, 100);

    // ── Return Promise ───────────────────────────────────────────────────────
    return new Promise((resolve) => { this._resolve = resolve; });
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Normalize a string for answer matching:
   *   lowercase → NFD → strip combining diacritics → collapse whitespace/hyphens → trim.
   * @param {string} s
   * @returns {string}
   */
  _normalize(s) {
    return s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[\s\-]+/g, " ")
      .trim();
  }

  /** @returns {number} accuracy in [0,1] */
  _accuracy() {
    return 1 - this._wrongKeystrokes / Math.max(1, this._totalKeystrokes);
  }

  /** @param {number} elapsedS @returns {number} WPM (rounded, capped at 999) */
  _wpm(elapsedS) {
    const minutes = Math.max(elapsedS, 0.001) / 60;
    return Math.min(999, Math.round((this._input.value.length / 5) / minutes));
  }

  /** Called on each input event: update keystroke counters + glyph feedback. */
  _onInput() {
    this._totalKeystrokes++;
    const val     = this._input.value;
    const normVal = this._normalize(val);

    // Determine wrong keystrokes: current value is NOT a prefix of any answer.
    const isPrefix = this._answers.some((a) =>
      this._normalize(a).startsWith(normVal)
    );
    if (!isPrefix && normVal.length > 0) {
      this._wrongKeystrokes++;
    }
    this._prevNorm = normVal;

    // Per-glyph feedback against best-matching answer.
    this._updateGlyphs(val);
  }

  /**
   * Update glyph spans by comparing typed value against the best-matching
   * normalized answer prefix.
   * @param {string} typed
   */
  _updateGlyphs(typed) {
    const normTyped = this._normalize(typed);
    // Pick answer whose normalized form has the longest common prefix with typed.
    let bestAnswer = this._answers[0] ?? this._target;
    let bestLen = 0;
    for (const a of this._answers) {
      const na = this._normalize(a);
      let common = 0;
      while (common < normTyped.length && common < na.length &&
             normTyped[common] === na[common]) {
        common++;
      }
      if (common > bestLen) { bestLen = common; bestAnswer = a; }
    }

    // Compare character-by-character using the display target (not normalized).
    // We map typed chars onto target chars positionally (simple approach for
    // single-word/short phrases like "Bangkok CTR"). Per-glyph comparison uses
    // the same leniency as the final match: case-insensitive, space ≡ hyphen —
    // a correct-but-lowercase answer must never show red.
    const target = this._target;
    const eq = (a, b) => {
      if (a === undefined || b === undefined) return false;
      const ca = /[\s\-]/.test(a) ? " " : a.toLowerCase();
      const cb = /[\s\-]/.test(b) ? " " : b.toLowerCase();
      return ca === cb;
    };
    for (let i = 0; i < this._glyphs.length; i++) {
      const span = this._glyphs[i];
      if (i >= typed.length) {
        span.className = "glyph-dim";
      } else if (eq(typed[i], target[i])) {
        span.className = "glyph-ok";
      } else {
        span.className = "glyph-bad";
      }
    }
  }

  /** Enter key pressed — check answer and resolve. */
  _confirmInput() {
    const val = this._input.value;
    const normVal = this._normalize(val);
    const correct = this._answers.some((a) => this._normalize(a) === normVal);
    const elapsedS = (performance.now() - this._startTs) / 1000;
    this._close({
      correct,
      elapsedS,
      accuracy: this._accuracy(),
      wpm:      this._wpm(elapsedS),
    });
  }

  /**
   * Internal: hide modal, stop timers, resolve Promise exactly once.
   * @param {object} result
   */
  _close(result) {
    if (this._settled) return;
    this._settled = true;
    this._open = false;

    // Stop countdown.
    if (this._tickId !== null) {
      clearInterval(this._tickId);
      this._tickId = null;
    }

    // Normalise result shape.
    const out = {
      correct:   result.correct   ?? false,
      elapsedS:  result.elapsedS  ?? (performance.now() - this._startTs) / 1000,
      accuracy:  result.accuracy  ?? this._accuracy(),
      wpm:       result.wpm       ?? this._wpm((performance.now() - this._startTs) / 1000),
      ...(result.cancelled && { cancelled: true }),
      ...(result.timeout   && { timeout:   true  }),
    };

    this._modal.style.display = "none";
    this._input.value = "";

    // Resolve promise exactly once (guarded by _settled above).
    this._resolve?.(out);
    this._resolve = null;
  }
}
