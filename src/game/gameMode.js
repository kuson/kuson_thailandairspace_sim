// gameMode.js — finite-state machine for the game flow.
//
// States cycle IDLE → BRIEFING → WAVE → DEBRIEF → IDLE.  abort() is legal
// from any non-IDLE state and short-circuits back to IDLE immediately.
// The class is inert while IDLE: update() returns at the top without touching
// any dep.  Later tasks fill the BRIEFING/WAVE/DEBRIEF bodies.
//
// Deps injected at construction:
//   layer       — AirspaceLayer instance (wave geometry queries).
//   startFlyTo  — the function defined in main.js (camera transition).
//   getDronePos — () => drone.position (live world-space position).
//   atc         — AtcRadio instance (optional; wired in B7.T5).
//   ufos        — UfoLayer instance (optional; wired in B7.T6).
//   typing      — TypingChallenge instance (optional; wired in B7.T7).
//   alerts      — AlertQueue singleton (optional; wired in B7.T8).
//   AlertTier   — frozen tier object (optional; wired in B7.T8).
//   tutorial    — Tutorial instance (optional; wired in B8.T7).

import { ScrambleWave, DIFFICULTY_TIERS } from "./scramble.js";
import { GameScore, getGameStats, setGameStats } from "./score.js";

// Map persisted key string → tier object (fallback to CADET).
function _tierFromKey(key) {
  return Object.values(DIFFICULTY_TIERS).find((t) => t.key === key) ?? DIFFICULTY_TIERS.CADET;
}

const LEGAL = {
  IDLE:     ["BRIEFING"],
  BRIEFING: ["WAVE", "IDLE"],
  WAVE:     ["DEBRIEF", "IDLE"],
  DEBRIEF:  ["IDLE", "WAVE"],
};

export class GameMode {
  /**
   * @param {{
   *   layer: object,
   *   startFlyTo: Function,
   *   getDronePos: Function,
   *   atc?: object,
   *   ufos?: object,
   *   typing?: object,
   *   alerts?: object,
   *   AlertTier?: object,
   *   audio?: object,
   *   tutorial?: object,
   * }} deps
   */
  constructor({ layer, startFlyTo, getDronePos, atc, ufos, typing, alerts, AlertTier, audio, tutorial }) {
    this.layer       = layer;
    this.startFlyTo  = startFlyTo;
    this.getDronePos = getDronePos;
    this.atc         = atc        ?? null;
    this.ufos        = ufos       ?? null;
    /** @type {import("./typing.js").TypingChallenge|null} */
    this.typing      = typing     ?? null;
    this._alerts     = alerts     ?? null;
    this._alertTier  = AlertTier  ?? null;
    this.audio       = audio      ?? null;
    /** @type {import("./tutorial.js").Tutorial|null} */
    this.tutorial    = tutorial   ?? null;

    this.state       = "IDLE";
    this._listeners  = new Map(); // event -> Set<cb>

    /** @type {ScrambleWave|null} */
    this._wave  = null;
    /** @type {GameScore|null} */
    this._score = null;

    // Multi-wave session counters (reset on start()).
    this._waveIndex    = 1;
    this._sessionTotal = 0;

    // DOM cards — built lazily.
    this._briefingCard = null;
    this._debriefCard  = null;
    this._briefingKeyListener = null;
  }

  // ── tiny emitter ───────────────────────────────────────────────────────────

  /**
   * Subscribe to an event.
   * @param {string} event
   * @param {Function} cb
   * @returns {Function} unsubscribe
   */
  on(event, cb) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(cb);
    return () => this._listeners.get(event)?.delete(cb);
  }

  /** @param {string} event  @param {*} payload */
  _emit(event, payload) {
    this._listeners.get(event)?.forEach((cb) => cb(payload));
  }

  // ── transition guard ───────────────────────────────────────────────────────

  /**
   * Attempt a state transition.  Logs and returns false if illegal.
   * @param {string} next
   * @returns {boolean}
   */
  _enter(next) {
    if (!LEGAL[this.state]?.includes(next)) {
      console.error(`[GameMode] illegal transition ${this.state} → ${next}`);
      return false;
    }
    this.state = next;
    this._emit("state", next);
    return true;
  }

  // ── public API ─────────────────────────────────────────────────────────────

  /** Transition IDLE → BRIEFING: show briefing card. */
  start() {
    if (!this._enter("BRIEFING")) return false;
    // Reset session counters for a fresh run.
    this._waveIndex    = 1;
    this._sessionTotal = 0;
    this._showBriefing();
    return true;
  }

  /** Return to IDLE from any non-IDLE state; emits "abort" first. */
  abort() {
    if (this.state === "IDLE") return;
    // Clean up wave if active.
    this._wave?.dispose();
    this._wave = null;
    // Hide all cards before emitting.
    this._hideBriefing();
    this._hideDebrief();
    this._emit("abort", this.state);
    // Reset session state cleanly.
    this._waveIndex    = 1;
    this._sessionTotal = 0;
    this.state = "IDLE";
    this._emit("state", "IDLE");
  }

  /**
   * Per-frame tick.  Returns immediately in IDLE (no dep access).
   * @param {number} dt  seconds since last frame
   */
  update(dt) {
    if (this.state === "IDLE") return;
    switch (this.state) {
      case "BRIEFING":
        // Driven by button/keydown events; nothing to update per-frame.
        break;
      case "WAVE":
        if (this._wave) {
          this._wave.update(dt);
          if (this._wave.done) {
            this._enterDebrief();
          }
        }
        break;
      case "DEBRIEF":
        // Driven by button/keydown events; nothing to update per-frame.
        break;
    }
  }

  // ── BRIEFING ───────────────────────────────────────────────────────────────

  _selectTier(key) {
    // Update active highlight on tier buttons.
    if (this._tierBtns) {
      Object.values(this._tierBtns).forEach((tb) => {
        tb.classList.toggle("gc-tier--active", tb.dataset.tierKey === key);
      });
    }
    // Update the contact-count bullet dynamically.
    const tier = _tierFromKey(key);
    const li = this._briefingCard?.querySelector("#gcContactCountLine");
    if (li) li.textContent = `${tier.contacts} unidentified contacts inbound`;
    // Persist selection.
    setGameStats({ difficulty: key });
  }

  _showBriefing() {
    if (!this._briefingCard) this._buildBriefingCard();

    // Restore persisted tier selection on each open.
    const savedKey = getGameStats().difficulty ?? "cadet";
    this._selectTier(savedKey);

    this._briefingCard.removeAttribute("hidden");

    // Capture-phase keydown, gated on card visibility — permanent listener.
    if (!this._briefingKeyListener) {
      this._briefingKeyListener = (e) => {
        if (this._briefingCard?.hasAttribute("hidden")) return;
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopImmediatePropagation();
          this._beginWave();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopImmediatePropagation();
          this._cancelBriefing();
        } else if (e.key === "1") {
          e.preventDefault();
          e.stopImmediatePropagation();
          this._selectTier("cadet");
        } else if (e.key === "2") {
          e.preventDefault();
          e.stopImmediatePropagation();
          this._selectTier("pilot");
        } else if (e.key === "3") {
          e.preventDefault();
          e.stopImmediatePropagation();
          this._selectTier("ace");
        } else if (e.key === "t" || e.key === "T") {
          // B8.T7 — tutorial offer (only rendered for fresh players).
          if (this._tutorialOffer && !this._tutorialOffer.hasAttribute("hidden")) {
            e.preventDefault();
            e.stopImmediatePropagation();
            this._startTutorial();
          }
        }
      };
      window.addEventListener("keydown", this._briefingKeyListener, true);
    }
    // B8.T7 — show the first-time tutorial offer only for fresh players.
    if (this._tutorialOffer) {
      const st = getGameStats();
      if (!st.tutorialDone && st.wavesPlayed === 0 && this.tutorial) {
        this._tutorialOffer.removeAttribute("hidden");
      } else {
        this._tutorialOffer.setAttribute("hidden", "");
      }
    }
  }

  _startTutorial() {
    this._hideBriefing();
    if (!this._enter("IDLE")) {
      this.state = "IDLE";
      this._emit("state", "IDLE");
    }
    this.tutorial?.start();
  }

  _hideBriefing() {
    this._briefingCard?.setAttribute("hidden", "");
  }

  _buildBriefingCard() {
    if (document.getElementById("gameBriefing")) {
      this._briefingCard = document.getElementById("gameBriefing");
      return;
    }
    const overlay = document.createElement("div");
    overlay.id = "gameBriefing";
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Game briefing");
    overlay.setAttribute("hidden", "");

    const card = document.createElement("div");
    card.className = "gc-card";

    const title = document.createElement("div");
    title.className = "gc-title";
    title.textContent = "OPERATION SKY GUARDIAN — SCRAMBLE";

    // Tier selector row — three buttons above the briefing bullets.
    const tierRow = document.createElement("div");
    tierRow.className = "gc-tier-row";
    this._tierBtns = {};
    Object.values(DIFFICULTY_TIERS).forEach((t) => {
      const tb = document.createElement("button");
      tb.type = "button";
      tb.className = "gc-tier";
      tb.textContent = t.label;
      tb.dataset.tierKey = t.key;
      tb.addEventListener("click", () => this._selectTier(t.key));
      tierRow.appendChild(tb);
      this._tierBtns[t.key] = tb;
    });

    // Briefing bullets — contact count line is dynamic.
    const body = document.createElement("ul");
    body.className = "gc-body";

    const contactLi = document.createElement("li");
    contactLi.id = "gcContactCountLine";
    body.appendChild(contactLi);

    [
      "Fly into each target airspace volume",
      "Identify it by typing its designator",
      "Speed and accuracy earn bonus points",
    ].forEach((txt) => {
      const li = document.createElement("li");
      li.textContent = txt;
      body.appendChild(li);
    });

    // B8.T7 — first-time tutorial offer (visibility managed in _showBriefing).
    const tutOffer = document.createElement("button");
    tutOffer.type = "button";
    tutOffer.id = "gameTutorialOffer";
    tutOffer.className = "gc-btn-secondary";
    tutOffer.textContent = "First time? → 60-second tutorial (T)";
    tutOffer.setAttribute("hidden", "");
    tutOffer.addEventListener("click", () => this._startTutorial());
    this._tutorialOffer = tutOffer;

    const btns = document.createElement("div");
    btns.className = "gc-btns";

    const beginBtn = document.createElement("button");
    beginBtn.type = "button";
    beginBtn.className = "gc-btn-primary";
    beginBtn.textContent = "Begin (Enter)";
    beginBtn.addEventListener("click", () => this._beginWave());

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "gc-btn-secondary";
    cancelBtn.textContent = "Cancel (Esc)";
    cancelBtn.addEventListener("click", () => this._cancelBriefing());

    btns.appendChild(beginBtn);
    btns.appendChild(cancelBtn);

    card.appendChild(title);
    card.appendChild(tierRow);
    card.appendChild(body);
    card.appendChild(tutOffer);
    card.appendChild(btns);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    this._briefingCard = overlay;
  }

  _cancelBriefing() {
    this._hideBriefing();
    if (!this._enter("IDLE")) {
      // If guard fails just force IDLE (already handled in abort).
      this.state = "IDLE";
      this._emit("state", "IDLE");
    }
  }

  // ── WAVE ───────────────────────────────────────────────────────────────────

  _beginWave() {
    this._hideBriefing();
    this._hideDebrief();
    if (!this._enter("WAVE")) return;
    this._score = new GameScore();
    // Resolve difficulty tier from persistence.
    const tierKey    = getGameStats().difficulty ?? "cadet";
    const tier       = _tierFromKey(tierKey);
    // Per-wave escalation: contacts grow by 1 each wave (cap +3); time shrinks 10% per wave (floor 45 s).
    const wi       = this._waveIndex;
    const contacts  = tier.contacts  + Math.min(3, wi - 1);
    const timeLimitS = Math.max(45, Math.round(tier.timeLimitS * Math.pow(0.9, wi - 1)));
    // Inject score and stat helpers into deps bundle.
    const deps = this;
    deps._score      = this._score;
    deps._statsModule = { getGameStats, setGameStats };
    this._lastTierLabel = tier.label;
    // Pass explicit per-wave opts so they override tier-derived values.
    this._wave = new ScrambleWave(deps, { tier, contacts, timeLimitS });
    // Pass stat helpers to the wave after construction (wave reads _statsModule
    // from deps reference which is `this`).
    this._wave._statsModule = { getGameStats, setGameStats };
    // B8.T6: voice — wave > 1 uses numbered announcement; wave 1 uses legacy scramble call.
    const n = this._wave._contacts?.length ?? contacts;
    if (wi > 1) {
      this.audio?.say(`Wave ${wi} — ${n} contacts inbound`);
    } else {
      this.audio?.say(`Scramble, scramble, scramble — ${n} contacts inbound`);
    }
  }

  _enterDebrief() {
    const summary = this._wave?.summary() ?? { contacts: [], total: 0, identified: 0, lost: 0 };
    this._wave = null;
    if (!this._enter("DEBRIEF")) return;
    // Accumulate session running total.
    this._sessionTotal += summary.total;
    // B8.T3: announce debrief.
    this.audio?.say(`Wave complete — ${summary.total} points`);

    // Persist stats — bestScore compares SESSION total; waveReached tracks highest wave index reached.
    const stats      = getGameStats();
    const newWaves   = (stats.wavesPlayed ?? 0) + 1;
    const newBest    = Math.max(stats.bestScore ?? 0, this._sessionTotal);
    const newReached = Math.max(stats.waveReached ?? 0, this._waveIndex);
    // Merge identified counts (from this wave only — per-wave contacts in summary).
    const idPatch = {};
    for (const c of summary.contacts) {
      if (!c.lost) idPatch[c.id] = (stats.airspacesIdentified[c.id] ?? 0) + 1;
    }
    setGameStats({ wavesPlayed: newWaves, bestScore: newBest, waveReached: newReached, airspacesIdentified: idPatch });

    this._showDebrief(summary, newBest);
  }

  // ── DEBRIEF ────────────────────────────────────────────────────────────────

  _showDebrief(summary, bestScore) {
    if (!this._debriefCard) this._buildDebriefCard();
    // Update title: WAVE {n} — {TIER}.
    const titleEl = this._debriefCard.querySelector("#gameDebriefTitle");
    if (titleEl) titleEl.textContent = `WAVE ${this._waveIndex} — ${this._lastTierLabel ?? "CADET"}`;
    this._populateDebrief(summary, bestScore);
    // Sync button labels to match multi-wave UI.
    this._refreshDebriefButtons();
    this._debriefCard.removeAttribute("hidden");
    this.audio?.play("chime");

    if (!this._debriefKeyListener) {
      this._debriefKeyListener = (e) => {
        if (this._debriefCard?.hasAttribute("hidden")) return;
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopImmediatePropagation();
          this._nextWaveDebrief();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopImmediatePropagation();
          this._endDebrief();
        }
      };
      window.addEventListener("keydown", this._debriefKeyListener, true);
    }
  }

  _hideDebrief() {
    this._debriefCard?.setAttribute("hidden", "");
  }

  _buildDebriefCard() {
    if (document.getElementById("gameDebrief")) {
      this._debriefCard = document.getElementById("gameDebrief");
      return;
    }
    const overlay = document.createElement("div");
    overlay.id = "gameDebrief";
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Wave debrief");
    overlay.setAttribute("hidden", "");

    const card = document.createElement("div");
    card.className = "gc-card";

    const title = document.createElement("div");
    title.className = "gc-title";
    title.id = "gameDebriefTitle";
    title.textContent = "DEBRIEF";

    const table = document.createElement("div");
    table.className = "gc-table";
    table.id = "gameDebriefTable";

    const footer = document.createElement("div");
    footer.className = "gc-footer";
    footer.id = "gameDebriefFooter";

    const btns = document.createElement("div");
    btns.className = "gc-btns";

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "gc-btn-primary";
    nextBtn.id = "gameDebriefNextBtn";
    nextBtn.textContent = "Next wave (Enter)";
    nextBtn.addEventListener("click", () => this._nextWaveDebrief());

    const endBtn = document.createElement("button");
    endBtn.type = "button";
    endBtn.className = "gc-btn-secondary";
    endBtn.id = "gameDebriefEndBtn";
    endBtn.textContent = "End (Esc)";
    endBtn.addEventListener("click", () => this._endDebrief());

    btns.appendChild(nextBtn);
    btns.appendChild(endBtn);

    card.appendChild(title);
    card.appendChild(table);
    card.appendChild(footer);
    card.appendChild(btns);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    this._debriefCard = overlay;
  }

  _populateDebrief(summary, bestScore) {
    const table  = this._debriefCard?.querySelector("#gameDebriefTable");
    const footer = this._debriefCard?.querySelector("#gameDebriefFooter");
    if (!table || !footer) return;

    table.innerHTML = "";
    for (const c of summary.contacts) {
      const row = document.createElement("div");
      row.className = "gc-row" + (c.lost ? " gc-row-lost" : " gc-row-ok");

      const name = document.createElement("span");
      name.className = "gc-row-name";
      name.textContent = c.shortName;

      const pts = document.createElement("span");
      pts.className = "gc-row-pts";
      if (c.lost) {
        pts.textContent = "LOST";
      } else {
        pts.textContent =
          `+${c.points} pts  ·  ${c.wpm} wpm  ·  ${Math.round(c.accuracy * 100)}%`;
      }

      row.appendChild(name);
      row.appendChild(pts);
      table.appendChild(row);
    }

    footer.innerHTML = "";
    const totalLine = document.createElement("div");
    totalLine.className = "gc-total";
    totalLine.textContent = `WAVE SCORE: ${summary.total}`;
    const sessionLine = document.createElement("div");
    sessionLine.className = "gc-session";
    sessionLine.textContent = `SESSION TOTAL: ${this._sessionTotal}`;
    const bestLine = document.createElement("div");
    bestLine.className = "gc-best";
    bestLine.textContent = `BEST: ${bestScore}`;
    footer.appendChild(totalLine);
    footer.appendChild(sessionLine);
    footer.appendChild(bestLine);
  }

  /** Refresh button label text (called each time debrief is shown). */
  _refreshDebriefButtons() {
    const nextBtn = this._debriefCard?.querySelector("#gameDebriefNextBtn");
    const endBtn  = this._debriefCard?.querySelector("#gameDebriefEndBtn");
    if (nextBtn) nextBtn.textContent = "Next wave (Enter)";
    if (endBtn)  endBtn.textContent  = "End (Esc)";
  }

  /** "Next wave" handler: advance wave index and begin the next wave. */
  _nextWaveDebrief() {
    this._hideDebrief();
    this._waveIndex++;
    this._beginWave();
  }

  /** "End" handler: return to IDLE and reset session state. */
  _endDebrief() {
    this._hideDebrief();
    this._waveIndex    = 1;
    this._sessionTotal = 0;
    this._enter("IDLE");
  }
}
