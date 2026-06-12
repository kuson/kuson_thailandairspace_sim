// scramble.js — SCRAMBLE-lite wave: one contact at a time through
// CALLING → ANNOUNCED → TRAVEL → CHALLENGE → RESOLVED phases (B7.T8).
//
// Deps received via the GameMode instance (passed as `deps`):
//   deps.layer        — AirspaceLayer  (compiled, airspacesAt)
//   deps.startFlyTo   — (id, opts) camera transition
//   deps.getDronePos  — () => {x, y, z}
//   deps.atc          — AtcRadio        (.call)
//   deps.ufos         — UfoLayer        (.spawnAt, .banish, .clear)
//   deps.typing       — TypingChallenge (.open, .isOpen)
//   deps.alerts       — AlertQueue      (.publish, .retract)  injected via _alerts
//   deps.AlertTier    — tier object     injected via _alertTier
//
// NOTE: alerts and AlertTier are not stored on GameMode directly; ScrambleWave
// receives them via the extra `alerts` / `AlertTier` keys on the deps spread.

import { FT_TO_M } from "../coords.js";

const CONTACT_PHASE = {
  CALLING:    "CALLING",
  ANNOUNCED:  "ANNOUNCED",
  TRAVEL:     "TRAVEL",
  CHALLENGE:  "CHALLENGE",
  RESOLVED:   "RESOLVED",
};

// How many metres a "close-enough" re-open check uses.
const REOPEN_DELAY_S    = 1.0;  // seconds to wait before re-showing typing if still inside
const TRAVEL_CHECK_HZ   = 2;    // max membership checks per second
const HUD_UPDATE_HZ     = 2;    // max HUD refresh per second

// ── helpers ────────────────────────────────────────────────────────────────

function _pickContacts(layer, count) {
  const pool = layer.compiled.filter(
    (c) => c.airspace.category === "CTR" || c.airspace.category === "TMA"
  );
  if (pool.length === 0) return [];
  const out  = [];
  const used = new Set();
  let tries  = 0;
  while (out.length < count && tries < pool.length * 3) {
    tries++;
    const idx = Math.floor(Math.random() * pool.length);
    const c   = pool[idx];
    if (!used.has(c.airspace.id)) {
      used.add(c.airspace.id);
      out.push(c);
    }
  }
  return out;
}

function _fmtTime(totalS) {
  const s = Math.max(0, Math.floor(totalS));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function _bearing(fromPos, toPos) {
  const dx = toPos.x - fromPos.x;
  const dz = toPos.z - fromPos.z;
  return Math.round((Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360);
}

function _distNm(fromPos, toPos) {
  const dx = toPos.x - fromPos.x;
  const dz = toPos.z - fromPos.z;
  return Math.round(Math.sqrt(dx * dx + dz * dz) / 1852);
}

// ── ScrambleWave ──────────────────────────────────────────────────────────

export class ScrambleWave {
  /**
   * @param {object} deps  GameMode instance (contains layer, startFlyTo,
   *                       getDronePos, atc, ufos, typing) plus
   *                       deps._alerts / deps._alertTier injected by GameMode.
   * @param {{ contacts?: number, timeLimitS?: number }} opts
   */
  constructor(deps, { contacts = 3, timeLimitS = 90 } = {}) {
    this._layer      = deps.layer;
    this._flyTo      = deps.startFlyTo;
    this._dronePos   = deps.getDronePos;
    this._atc        = deps.atc;
    this._ufos       = deps.ufos;
    this._typing     = deps.typing;
    this._alerts     = deps._alerts   ?? null;
    this._alertTier  = deps._alertTier ?? null;
    this._audio      = deps.audio      ?? null;
    this._timeLimitS = timeLimitS;
    this._score      = deps._score;   // GameScore set before ScrambleWave constructed

    // Pick contacts once at construction time.
    this._contacts = _pickContacts(this._layer, contacts).map((c) => ({
      id:        c.airspace.id,
      shortName: c.airspace.shortName ?? c.airspace.id,
      name:      c.airspace.name      ?? "",
      centroid:  c.centroid,
      lost:      false,
      points:    0,
      wpm:       0,
      accuracy:  0,
    }));

    this._idx       = 0;      // current contact index
    this._phase     = CONTACT_PHASE.CALLING;
    this._done      = false;
    this._disposed  = false;

    // Per-contact travel timer.
    this._travelElapsed = 0;

    // Throttle accumulators.
    this._travelAcc  = 0;
    this._hudAcc     = 0;

    // Reopen-delay after cancel.
    this._reopenTimer = 0;
    this._reopenPending = false;

    // UFO id for the current contact.
    this._ufoId = null;

    // Whether typing promise has been consumed.
    this._challengeStarted = false;

    // Build HUD strip once.
    this._buildHud();

    // Start the first contact.
    this._startContact();
  }

  // ── HUD strip ─────────────────────────────────────────────────────────────

  _buildHud() {
    if (document.getElementById("gameObjective")) {
      this._hud = document.getElementById("gameObjective");
      return;
    }
    const el = document.createElement("div");
    el.id = "gameObjective";
    el.setAttribute("aria-live", "polite");
    el.setAttribute("hidden", "");

    const info = document.createElement("div");
    info.id = "gameObjectiveInfo";
    el.appendChild(info);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.id   = "gameAutopilotBtn";
    btn.textContent = "AUTOPILOT";
    btn.addEventListener("click", () => {
      const c = this._currentContact();
      if (!c) return;
      // The catalog vantage frames the volume from ~40k ft — ABOVE most
      // ceilings, so arrival alone would never satisfy the in-volume check.
      // After the cinematic, drop to the contact's mid-band altitude inside
      // the volume ("final approach").
      this._flyTo(c.id, {
        pushHistory: false,
        onComplete: () => {
          if (this._disposed) return;
          const comp = this._layer.compiled.find((x) => x.airspace.id === c.id);
          if (!comp) return;
          const a = comp.airspace;
          const pos = this._dronePos();
          pos.set(comp.centroid.x, ((a.lowerFt + a.upperFt) / 2) * FT_TO_M, comp.centroid.z);
        },
      });
    });
    el.appendChild(btn);

    document.body.appendChild(el);
    this._hud     = el;
    this._hudInfo = info;
  }

  _showHud(show) {
    if (!this._hud) return;
    if (show) {
      this._hud.removeAttribute("hidden");
    } else {
      this._hud.setAttribute("hidden", "");
    }
  }

  _updateHud() {
    if (!this._hud || this._hud.hasAttribute("hidden")) return;
    const c = this._currentContact();
    if (!c) return;
    const pos  = this._dronePos();
    const brg  = _bearing(pos, c.centroid);
    const nm   = _distNm(pos, c.centroid);
    const rem  = Math.max(0, this._timeLimitS - this._travelElapsed);
    const info = this._hud.querySelector("#gameObjectiveInfo") ?? this._hudInfo;
    if (info) {
      info.textContent =
        `TARGET: ${c.shortName}  ·  bears ${String(brg).padStart(3, "0")}°  ·  ${nm} nm  ·  ${_fmtTime(rem)}`;
    }
  }

  // ── Contact lifecycle ──────────────────────────────────────────────────────

  _currentContact() {
    return this._contacts[this._idx] ?? null;
  }

  _startContact() {
    if (this._disposed || this._idx >= this._contacts.length) {
      this._done = true;
      this._showHud(false);
      return;
    }
    const c = this._currentContact();
    this._travelElapsed  = 0;
    this._travelAcc      = 0;
    this._hudAcc         = 0;
    this._reopenPending  = false;
    this._reopenTimer    = 0;
    this._challengeStarted = false;
    this._ufoId          = null;
    this._phase          = CONTACT_PHASE.CALLING;

    // Calling phase: publish ATC call + spawn UFO.
    if (this._atc) this._atc.call({ airspaceId: c.id, count: 1 });
    if (this._ufos) this._ufoId = this._ufos.spawnAt(c.id);

    this._phase = CONTACT_PHASE.TRAVEL;
    this._showHud(true);
    this._updateHud();
  }

  _advanceContact() {
    this._idx++;
    if (this._idx >= this._contacts.length) {
      this._done = true;
      this._showHud(false);
    } else {
      this._startContact();
    }
  }

  _handleContactLost() {
    const c = this._currentContact();
    if (!c) return;
    c.lost = true;
    this._audio?.play("lost");
    this._score?.contactLost();
    // Banish UFO.
    if (this._ufos && this._ufoId !== null) this._ufos.banish(this._ufoId);
    this._ufoId = null;
    // Publish advisory alert.
    if (this._alerts && this._alertTier) {
      this._alerts.publish({
        key:     "scramble.lost",
        tier:    this._alertTier.ADVISORY,
        message: `Contact lost — ${c.shortName} overrun`,
      });
      // Auto-retract after 4 s via a timeout.
      setTimeout(() => {
        this._alerts?.retract("scramble.lost");
      }, 4000);
    }
    // Volume pulsing deferred (noted in B7.T8 task spec).
    this._phase = CONTACT_PHASE.RESOLVED;
    this._showHud(false);
    this._advanceContact();
  }

  // ── Per-frame update ───────────────────────────────────────────────────────

  /**
   * Drive the wave FSM.  Call every frame with delta-seconds.
   * @param {number} dt  seconds since last frame
   */
  update(dt) {
    if (this._disposed || this._done) return;

    const c = this._currentContact();
    if (!c) return;

    if (this._phase === CONTACT_PHASE.TRAVEL) {
      this._travelElapsed += dt;
      this._travelAcc     += dt;
      this._hudAcc        += dt;

      // HUD update ≤2 Hz.
      if (this._hudAcc >= 1 / HUD_UPDATE_HZ) {
        this._hudAcc = 0;
        this._updateHud();
      }

      // Reopen-pending countdown (after Esc cancel).
      if (this._reopenPending) {
        this._reopenTimer -= dt;
        if (this._reopenTimer <= 0) {
          this._reopenPending = false;
          // If still inside volume, immediately open challenge again.
          if (this._isInsideTarget()) {
            this._phase = CONTACT_PHASE.CHALLENGE;
            this._openChallenge(c);
          }
        }
        return;
      }

      // Travel timeout check.
      if (this._travelElapsed >= this._timeLimitS) {
        this._handleContactLost();
        return;
      }

      // Membership check ≤2 Hz.
      if (this._travelAcc >= 1 / TRAVEL_CHECK_HZ) {
        this._travelAcc = 0;
        if (this._isInsideTarget()) {
          this._phase = CONTACT_PHASE.CHALLENGE;
          this._openChallenge(c);
        }
      }
    }
    // CHALLENGE phase is async (Promise-driven); update() just watches for
    // the travel timer to expire while the challenge is open (handled inside
    // _openChallenge via the promise result).
  }

  _isInsideTarget() {
    const c   = this._currentContact();
    if (!c) return false;
    const pos = this._dronePos();
    const hits = this._layer.airspacesAt(pos.x, pos.y, pos.z);
    // airspacesAt returns airspace objects — check .id.
    return hits.some((a) => a.id === c.id);
  }

  _openChallenge(c) {
    if (!this._typing || this._typing.isOpen) return;
    if (this._challengeStarted) return;
    this._challengeStarted = true;
    this._showHud(false);

    const answers = [c.id, c.shortName, c.name].filter(Boolean);
    const p = this._typing.open({
      prompt:   "UNIDENTIFIED CRAFT — type the airspace designator",
      target:   c.shortName,
      answers,
      timeoutS: 45,
    });

    if (!p) {
      // typing.open returned null — already open (shouldn't happen, guard).
      this._challengeStarted = false;
      this._phase = CONTACT_PHASE.TRAVEL;
      this._showHud(true);
      return;
    }

    p.then((result) => {
      if (this._disposed) return;

      if (result.correct) {
        // Correct identification.
        this._audio?.play("banish");
        c.points   = this._score?.contactIdentified({
          elapsedS:   result.elapsedS,
          accuracy:   result.accuracy,
          timeLimitS: this._timeLimitS,
        }) ?? 0;
        c.wpm      = result.wpm      ?? 0;
        c.accuracy = result.accuracy ?? 0;
        c.lost     = false;

        // Record into persisted stats.
        const { getGameStats, setGameStats } = this._statsModule ?? {};
        if (getGameStats && setGameStats) {
          const stats = getGameStats();
          const prev  = stats.airspacesIdentified[c.id] ?? 0;
          setGameStats({ airspacesIdentified: { [c.id]: prev + 1 } });
        }

        // Banish UFO.
        if (this._ufos && this._ufoId !== null) this._ufos.banish(this._ufoId);
        this._ufoId = null;
        this._phase = CONTACT_PHASE.RESOLVED;
        this._advanceContact();

      } else if (result.cancelled) {
        // Esc pressed — go back to TRAVEL, reopen after 1 s if still inside.
        this._challengeStarted = false;
        this._phase            = CONTACT_PHASE.TRAVEL;
        this._reopenPending    = true;
        this._reopenTimer      = REOPEN_DELAY_S;
        this._showHud(true);

      } else if (result.timeout) {
        // 45 s typing timeout — same as travel timeout (lost).
        this._challengeStarted = false;
        this._handleContactLost();

      } else {
        // Incorrect answer submitted — treat as cancel (re-enterable).
        this._challengeStarted = false;
        this._phase            = CONTACT_PHASE.TRAVEL;
        this._reopenPending    = true;
        this._reopenTimer      = REOPEN_DELAY_S;
        this._showHud(true);
      }
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** True when all contacts have been resolved (or lost). */
  get done() { return this._done; }

  /**
   * Summary of wave results.
   * @returns {{ contacts: Array, total: number, identified: number, lost: number }}
   */
  summary() {
    const identified = this._contacts.filter((c) => !c.lost).length;
    const lost       = this._contacts.filter((c) =>  c.lost).length;
    const total      = this._contacts.reduce((s, c) => s + c.points, 0);
    return {
      contacts:   this._contacts.map((c) => ({
        id:        c.id,
        shortName: c.shortName,
        lost:      c.lost,
        points:    c.points,
        wpm:       c.wpm,
        accuracy:  c.accuracy,
      })),
      total,
      identified,
      lost,
    };
  }

  /**
   * Abort path: close typing if open, clear UFOs, hide HUD, cancel timers.
   */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;

    // Close typing challenge if open (fires Esc path internally).
    if (this._typing?.isOpen) {
      // TypingChallenge has no public cancel(); calling _close is internal.
      // The only public path is Esc which calls _close({correct:false, cancelled:true}).
      // We synthesise it via the private seam if available, otherwise rely on
      // the settled guard — the promise will resolve with cancelled:true.
      if (typeof this._typing._close === "function") {
        this._typing._close({ correct: false, cancelled: true });
      }
    }

    // Clear all UFOs immediately (no banish animation — abort path).
    if (this._ufos) this._ufos.clear();
    this._ufoId = null;

    // Hide HUD strip.
    this._showHud(false);

    // Retract any pending alert.
    this._alerts?.retract("scramble.lost");
  }
}
