// intercept.js — INTERCEPT wave: raid warning, weapons-free gate, base integrity.
// B9.T6: InterceptWave class (deps injection, start/update/dispose, scoring).
//
// Deps received from the GameMode instance (passed as `deps`):
//   deps.layer        — AirspaceLayer  (compiled airspace entries)
//   deps.atc          — AtcRadio        (.call)
//   deps.ufos         — UfoLayer        (.spawnAt, .setShielded, .setBehavior, .clear, etc.)
//   deps.crawlers     — CrawlerLayer    (.spawnRing, .clear, etc.)
//   deps.typing       — TypingChallenge (.open, .isOpen)
//   deps.weapons      — Weapons         (.setActive, .setTargetsProvider, .shots, .hits, .fire)
//   deps.aim          — AimMode         (.enable, .disable, .onFire)
//   deps._alerts      — AlertQueue      (optional)
//   deps.audio        — audio handle    (.play, .say)
//   deps._score       — GameScore       (set by GameMode before construction)
//   deps.getUi        — () => ui        (lazy getter for setGameBlipProvider)
//
// airports.json is fetched at module scope so the airport list is always
// available synchronously once the first wave is created.

import { geoToWorld } from "../coords.js";
import * as THREE from "three";

// ── Airport data (loaded asynchronously at module scope) ──────────────────

/** @type {{ icao: string, lat: number, lon: number, name: string }[] | null} */
let _airportData = null;

async function _loadAirports() {
  if (_airportData) return _airportData;
  try {
    const resp = await fetch("data/airports.json");
    const json = await resp.json();
    _airportData = json.airports ?? [];
  } catch {
    _airportData = [];
  }
  return _airportData;
}

// Kick off load immediately so it is ready by the time the first wave starts.
_loadAirports();

// ── Helper: build answers list from tier ──────────────────────────────────

/**
 * Build the typing challenge answers list for a given airspace and tier,
 * mirroring scramble.js _openChallenge logic exactly.
 * @param {{ id: string, shortName: string, name: string }} airspace
 * @param {{ answers: string }} tier
 * @returns {{ answers: string[], target: string }}
 */
function _buildAnswers(airspace, tier) {
  const mode = tier.answers;
  let answers;
  if (mode === "id") {
    answers = [airspace.id].filter(Boolean);
  } else if (mode === "short") {
    answers = [airspace.id, airspace.shortName].filter(Boolean);
  } else {
    // "all"
    answers = [airspace.id, airspace.shortName, airspace.name].filter(Boolean);
  }
  const target = mode === "id" ? airspace.id : (airspace.shortName || airspace.id);
  return { answers, target };
}

// ── Helper: pick defended airspace ───────────────────────────────────────

/**
 * Pick a random CTR from compiled that has a matching airport in airports.json.
 * Matching: airspace id prefix (e.g. "VTBD-CTR") starts with airport icao (e.g. "VTBD").
 * Returns { compiledEntry, airport } or null.
 * @param {object[]} compiled
 * @returns {{ compiledEntry: object, airport: object } | null}
 */
function _pickDefendedAirspace(compiled) {
  const airports = _airportData ?? [];
  // Build lookup: icao → airport
  const airportByIcao = new Map(airports.map((a) => [a.icao, a]));

  const candidates = [];
  for (const c of compiled) {
    const id = c.airspace?.id;
    if (!id) continue;
    // Match: airspace id starts with a known airport icao and has '-CTR' suffix
    for (const [icao, airport] of airportByIcao) {
      if (id === `${icao}-CTR`) {
        candidates.push({ compiledEntry: c, airport });
        break;
      }
    }
  }

  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// ── InterceptWave ─────────────────────────────────────────────────────────

export class InterceptWave {
  /**
   * @param {object} deps  GameMode instance (with all deps attached).
   * @param {{ tier: object, waveIndex: number }} opts
   */
  constructor(deps, { tier, waveIndex = 1 } = {}) {
    this._tier       = tier;
    this._waveIndex  = waveIndex;
    this._layer      = deps.layer;
    this._atc        = deps.atc;
    this._ufos       = deps.ufos;
    this._crawlers   = deps.crawlers;
    this._typing     = deps.typing;
    this._weapons    = deps.weapons;
    this._aim        = deps.aim;
    this._audio      = deps.audio;
    this._score      = deps._score;
    this._getUi      = deps.getUi ?? (() => null);

    // Wave state.
    this._disposed       = false;
    this._done           = false;
    this._outcome        = null;  // "WON" | "LOST"

    // Base integrity.
    this._integrity      = 100;

    // Kill counters.
    this._ufoKills       = 0;
    this._crawlerKills   = 0;

    // Weapons-free gate.
    this._weaponsFree    = false;
    this._gateOpen       = false;  // typing challenge in progress

    // Stagger state: list of UFO ids pending ATTACK_RUN release.
    this._pendingAttack  = [];  // { id, delayLeft }
    this._staggerTimer   = 0;

    // Beacon world position.
    this._beaconPos      = new THREE.Vector3();

    // Track spawned UFO/crawler ids.
    this._ufoIds         = [];
    this._crawlerIds     = [];

    // Per-wave shot/hit stats (reset weapons counters at start).
    this._shotsAtStart   = 0;
    this._hitsAtStart    = 0;

    // Tracked ids that are "gone" (killed + reached + retreated-despawned).
    this._ufoGone        = new Set();
    this._crawlerGone    = new Set();

    // Aim fire callback reference (so we can splice it back out if needed).
    this._fireCb         = null;

    // Wave-state Enter key listener (opens gate).
    this._enterKeyCb     = null;

    // Picked airspace/airport.
    this._airspace       = null;  // { id, shortName, name }
    this._airport        = null;  // airports.json entry

    // HUD strip element.
    this._strip          = null;

    // Debrief summary (filled on wave end).
    this._summary        = null;

    // Initialize.
    this._init();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** True when the wave has ended (won or lost). */
  get done() { return this._done; }

  /**
   * Summary of wave results — available after done === true.
   */
  summary() {
    return this._summary ?? {
      outcome:      this._outcome ?? "LOST",
      ufoKills:     this._ufoKills,
      crawlerKills: this._crawlerKills,
      accuracy:     0,
      integrity:    this._integrity,
      total:        0,
    };
  }

  /**
   * Per-frame update. Call every frame with delta-seconds.
   * @param {number} dt  seconds since last frame
   */
  update(dt) {
    if (this._disposed || this._done) return;

    // Integrity check first.
    if (this._integrity <= 0 && !this._done) {
      this._endWave("LOST");
      return;
    }

    // Stagger ATTACK_RUN releases after weapons-free.
    if (this._weaponsFree && this._pendingAttack.length > 0) {
      this._staggerTimer -= dt;
      if (this._staggerTimer <= 0) {
        const next = this._pendingAttack.shift();
        if (next != null) {
          this._ufos?.setBehavior(next, "ATTACK_RUN", { target: this._beaconPos });
        }
        this._staggerTimer = 5; // next release in 5 s
      }
    }

    // Update HUD strip.
    this._updateStrip();

    // Win check: all raiders gone AND integrity > 0.
    if (!this._done && this._integrity > 0) {
      if (this._checkAllGone()) {
        this._endWave("WON");
      }
    }
  }

  /**
   * Abort path: shut everything down cleanly.
   */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;

    // Disable aim + weapons.
    this._aim?.disable();
    if (this._fireCb) { this._aim?.offFire?.(this._fireCb); this._fireCb = null; }
    this._weapons?.setActive(false);
    this._weapons?.setTargetsProvider(() => []);

    // Close typing if open.
    if (this._typing?.isOpen) {
      if (typeof this._typing._close === "function") {
        this._typing._close({ correct: false, cancelled: true });
      }
    }

    // Remove wave Enter key listener.
    if (this._enterKeyCb) {
      window.removeEventListener("keydown", this._enterKeyCb, true);
      this._enterKeyCb = null;
    }

    // Clear combat entities.
    this._ufos?.clear();
    this._crawlers?.clear();

    // Clear radar blips.
    this._getUi()?.setGameBlipProvider(null);

    // Hide strip.
    this._showStrip(false);
  }

  // ── Internal — initialise ─────────────────────────────────────────────────

  _init() {
    // Pick defended airspace.
    const compiled = this._layer?.compiled ?? [];
    const picked = _pickDefendedAirspace(compiled);

    if (!picked) {
      // No matching CTR found — wave cannot start. End immediately.
      console.warn("[InterceptWave] No CTR+airport match found — wave skipped.");
      this._done = true;
      this._outcome = "WON";
      this._summary = { outcome: "WON", ufoKills: 0, crawlerKills: 0, accuracy: 0, integrity: 100, total: 0 };
      return;
    }

    const { compiledEntry, airport } = picked;
    const a = compiledEntry.airspace;
    this._airspace = {
      id:        a.id,
      shortName: a.shortName ?? a.id,
      name:      a.name ?? "",
    };
    this._airport = airport;

    // Resolve beacon world position from airport lat/lon.
    const wp = geoToWorld(airport.lat, airport.lon);
    this._beaconPos.set(wp.x, 0, wp.z);

    // Spawn UFOs.
    const ufoCount = this._tier.contacts + this._waveIndex - 1;
    for (let i = 0; i < ufoCount; i++) {
      const id = this._ufos?.spawnAt(this._airspace.id, {
        combat:      true,
        shielded:    true,
        orbitRadius: 8000,
      });
      if (id != null) {
        this._ufoIds.push(id);
      }
    }

    // Spawn crawlers.
    const crawlerCount = 2 + this._waveIndex;
    const spawnedCrawlerIds = this._crawlers?.spawnRing(this._beaconPos, crawlerCount, 10000) ?? [];
    this._crawlerIds = spawnedCrawlerIds;

    // Wire UFO callbacks.
    const prevOnReachTarget = this._ufos?.onReachTarget ?? null;
    const prevOnExplode     = this._ufos?.onExplode ?? null;
    this._ufos.onReachTarget = (id) => {
      if (!this._ufoIds.includes(id)) { prevOnReachTarget?.(id); return; }
      this._integrity = Math.max(0, this._integrity - 20);
      this._ufoGone.add(id);
      this._updateStrip();
      if (this._integrity <= 0 && !this._done) {
        this._endWave("LOST");
      }
    };
    this._ufos.onExplode = (id, position) => {
      if (this._ufoIds.includes(id)) {
        this._ufoKills++;
        this._ufoGone.add(id);
        this._weapons?.spawnBurstAt(position);
      }
      prevOnExplode?.(id, position);
    };

    // Wire crawler callbacks.
    const prevCrawlerOnReachBase = this._crawlers?.onReachBase ?? null;
    const prevCrawlerOnExplode   = this._crawlers?.onExplode ?? null;
    this._crawlers.onReachBase = (id) => {
      if (!this._crawlerIds.includes(id)) { prevCrawlerOnReachBase?.(id); return; }
      this._integrity = Math.max(0, this._integrity - 10);
      this._crawlerGone.add(id);
      this._updateStrip();
      if (this._integrity <= 0 && !this._done) {
        this._endWave("LOST");
      }
    };
    this._crawlers.onExplode = (id, position) => {
      if (this._crawlerIds.includes(id)) {
        this._crawlerKills++;
        this._crawlerGone.add(id);
        this._weapons?.spawnBurstAt(position);
      }
      prevCrawlerOnExplode?.(id, position);
    };

    // Enable aim + weapons.
    this._aim?.enable();
    this._weapons?.setActive(true);
    // Reset shot/hit counters at wave start.
    if (this._weapons) {
      this._shotsAtStart = this._weapons.shots;
      this._hitsAtStart  = this._weapons.hits;
    }

    // Wire target provider.
    this._weapons?.setTargetsProvider(() => this._buildTargets());

    // Wire fire callback via aim.onFire.
    this._fireCb = () => this._onFire();
    this._aim?.onFire(this._fireCb);

    // Wire radar blip provider.
    this._getUi()?.setGameBlipProvider(() => this._crawlers?.radarBlips() ?? []);

    // Build HUD strip.
    this._buildStrip();
    this._showStrip(true);

    // ATC raid warning.
    const n = ufoCount;
    const shortName = this._airspace.shortName;
    this._atc?.call({ airspaceId: this._airspace.id, count: n });
    this._audio?.say(`Raid warning — ${shortName}. ${n} contacts inbound. Identify for weapons free.`);

    // Set up stagger timer (first release fires immediately after weapons-free).
    // We pre-load all UFO ids into the pending queue.
    this._pendingAttack = [...this._ufoIds];
    this._staggerTimer  = 0; // first will fire immediately

    // Wave-state Enter key: opens weapons-free gate (capture phase, gated on strip visibility).
    this._enterKeyCb = (e) => {
      if (this._disposed || this._done) return;
      if (!this._strip || this._strip.style.display === "none") return;
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopImmediatePropagation();
        this._openGate();
      }
    };
    window.addEventListener("keydown", this._enterKeyCb, true);
  }

  // ── Internal — weapons-free gate ─────────────────────────────────────────

  /**
   * Called on every fire attempt from aim.onFire.
   * - If weapons-free: fire normally.
   * - If shielded: auto-open typing challenge (first attempt only).
   */
  _onFire() {
    if (this._disposed || this._done) return;
    if (this._weaponsFree) {
      this._weapons?.fire();
    } else {
      // First fire attempt while shielded → auto-open gate.
      this._openGate();
    }
  }

  /**
   * Open the weapons-free typing challenge.
   * Also called from the objective strip Enter handler.
   */
  _openGate() {
    if (this._disposed || this._done) return;
    if (this._gateOpen) return;
    if (this._weaponsFree) return;
    if (!this._typing || this._typing.isOpen) return;

    this._gateOpen = true;

    const { answers, target } = _buildAnswers(this._airspace, this._tier);
    const p = this._typing.open({
      prompt:   `RAID — ${this._airspace.shortName} — Type designator for WEAPONS FREE`,
      target,
      answers,
      timeoutS: this._tier.challengeS ?? 45,
    });

    if (!p) {
      this._gateOpen = false;
      return;
    }

    p.then((result) => {
      this._gateOpen = false;
      if (this._disposed || this._done) return;

      if (result.correct) {
        this._weaponsFree = true;
        // Drop shields on all spawned UFOs.
        for (const id of this._ufoIds) {
          this._ufos?.setShielded(id, false);
        }
        this._audio?.play("lockSweep");
        this._audio?.say("Weapons free, weapons free.");
        // Trigger first ATTACK_RUN immediately (stagger timer at 0).
        this._staggerTimer = 0;
        this._updateStrip();
      } else {
        // Wrong / cancelled — gate remains closed; player can retry via Enter.
      }
    });
  }

  // ── Internal — target building ────────────────────────────────────────────

  /**
   * Build merged target list for weapons hitscan.
   * Prefixes ids to avoid ufo id 3 == crawler id 3 collision.
   * @returns {Array<{ id: string, kind: string, position: THREE.Vector3, radius: number, shielded: boolean, takeHit: Function }>}
   */
  _buildTargets() {
    const targets = [];

    const ufoEntities = this._ufos?.getCombatEntities() ?? [];
    for (const e of ufoEntities) {
      if (!this._ufoIds.includes(e.id)) continue;
      targets.push({
        id:       `ufo-${e.id}`,
        kind:     "ufo",
        position: e.position,
        radius:   60,
        shielded: e.shielded,
        takeHit:  (dmg) => this._ufos?.takeHit(e.id, dmg),
      });
    }

    const crawlerEntities = this._crawlers?.getCombatEntities() ?? [];
    for (const e of crawlerEntities) {
      if (!this._crawlerIds.includes(e.id)) continue;
      targets.push({
        id:       `crawler-${e.id}`,
        kind:     "crawler",
        position: e.position,
        radius:   40,
        shielded: false,
        takeHit:  (dmg) => this._crawlers?.takeHit(e.id, dmg),
      });
    }

    return targets;
  }

  // ── Internal — win/lose check ─────────────────────────────────────────────

  /**
   * All raiders are "gone" when every spawned id is in the gone set.
   * A RETREAT UFO that later despawns counts as gone (tracked via onExplode
   * on the DESTROY state; and via onReachTarget for reach-and-retreat).
   * We poll live UFO list: if an id no longer appears in getCombatEntities
   * AND is not known-gone, we add it (it has retreated/despawned).
   */
  _checkAllGone() {
    // Poll live UFO entities to find ones that have despawned.
    const liveUfoIds = new Set(
      (this._ufos?.getCombatEntities() ?? []).map((e) => e.id)
    );
    for (const id of this._ufoIds) {
      if (!liveUfoIds.has(id)) {
        this._ufoGone.add(id);
      }
    }

    // Poll live crawlers.
    const liveCrawlerIds = new Set(
      (this._crawlers?.getCombatEntities() ?? []).map((e) => e.id)
    );
    // Also check for DESTROY-state crawlers that have faded — look for any
    // spawned id not in MOVE state (not in getCombatEntities output).
    for (const id of this._crawlerIds) {
      if (!liveCrawlerIds.has(id)) {
        this._crawlerGone.add(id);
      }
    }

    const allUfosGone     = this._ufoIds.every((id) => this._ufoGone.has(id));
    const allCrawlersGone = this._crawlerIds.every((id) => this._crawlerGone.has(id));
    return allUfosGone && allCrawlersGone;
  }

  // ── Internal — wave end ───────────────────────────────────────────────────

  _endWave(outcome) {
    if (this._done) return;
    this._done    = true;
    this._outcome = outcome;

    // Remove wave Enter key listener.
    if (this._enterKeyCb) {
      window.removeEventListener("keydown", this._enterKeyCb, true);
      this._enterKeyCb = null;
    }

    // Restore weapons/aim to idle.
    this._aim?.disable();
    this._weapons?.setActive(false);
    this._weapons?.setTargetsProvider(() => []);

    // Restore radar blip provider.
    this._getUi()?.setGameBlipProvider(null);

    // Hide strip.
    this._showStrip(false);

    // Close typing if somehow still open.
    if (this._typing?.isOpen) {
      if (typeof this._typing._close === "function") {
        this._typing._close({ correct: false, cancelled: true });
      }
    }

    // Compute score.
    const shotsThisWave = (this._weapons?.shots ?? 0) - this._shotsAtStart;
    const hitsThisWave  = (this._weapons?.hits  ?? 0) - this._hitsAtStart;
    const accuracy      = shotsThisWave > 0
      ? Math.round(100 * hitsThisWave / shotsThisWave)
      : 0;

    const ufoScore     = this._ufoKills     * 150 * (this._tier.mult ?? 1);
    const crawlerScore = this._crawlerKills * 75  * (this._tier.mult ?? 1);
    const accuracyBonus = accuracy;
    const integrityBonus = Math.max(0, this._integrity);
    const total = Math.round(ufoScore + crawlerScore + accuracyBonus + integrityBonus);

    this._summary = {
      outcome:      outcome,
      ufoKills:     this._ufoKills,
      crawlerKills: this._crawlerKills,
      accuracy,
      integrity:    this._integrity,
      total,
    };

    // Voice debrief line.
    if (outcome === "WON") {
      this._audio?.say(`Bandits neutralised. ${total} points.`);
    } else {
      this._audio?.say("Base overrun. Mission failed.");
    }
  }

  // ── Internal — HUD strip ─────────────────────────────────────────────────

  _buildStrip() {
    // Reuse the existing gameObjectiveStrip or create a new one.
    let strip = document.getElementById("gameObjectiveStrip");
    if (!strip) {
      strip = document.createElement("div");
      strip.id = "gameObjectiveStrip";
      document.body.appendChild(strip);
    }
    this._strip = strip;
  }

  _showStrip(visible) {
    if (!this._strip) return;
    this._strip.style.display = visible ? "flex" : "none";
  }

  _updateStrip() {
    if (!this._strip) return;
    const goneCount = this._ufoGone.size + this._crawlerGone.size;
    const totalRaiders = this._ufoIds.length + this._crawlerIds.length;
    const remaining = totalRaiders - goneCount;
    const wfHint = !this._weaponsFree
      ? " · Enter = identify for weapons free"
      : " · WEAPONS FREE";
    this._strip.textContent =
      `RAID — ${this._airspace?.shortName ?? "?"} · INTEGRITY ${this._integrity} · contacts ${remaining}${wfHint}`;
  }
}
