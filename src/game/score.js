// score.js — in-wave scoring and game-stats persistence (B7.T8).
//
// GameScore tracks per-wave points and streak multiplier.
// getGameStats / setGameStats persist aggregate stats under kuson.game.v1.

// ── Persistence ────────────────────────────────────────────────────────────

const STATS_KEY = "kuson.game.v1";
const STATS_DEFAULT = {
  bestScore:            0,
  wavesPlayed:          0,
  airspacesIdentified:  {},
};

function _withDefaults(raw) {
  // Merge raw into a fresh default so new keys always exist.
  const out = { ...STATS_DEFAULT };
  if (raw && typeof raw === "object") {
    if (typeof raw.bestScore           === "number") out.bestScore           = raw.bestScore;
    if (typeof raw.wavesPlayed         === "number") out.wavesPlayed         = raw.wavesPlayed;
    if (raw.airspacesIdentified && typeof raw.airspacesIdentified === "object") {
      out.airspacesIdentified = { ...raw.airspacesIdentified };
    }
  }
  return out;
}

/**
 * Load game stats from localStorage.  Corrupt JSON falls back to defaults.
 * @returns {{ bestScore: number, wavesPlayed: number, airspacesIdentified: Record<string,number> }}
 */
export function getGameStats() {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw) return { ...STATS_DEFAULT, airspacesIdentified: {} };
    return _withDefaults(JSON.parse(raw));
  } catch {
    return { ...STATS_DEFAULT, airspacesIdentified: {} };
  }
}

/**
 * Merge `patch` into the stored stats and write back.
 * @param {Partial<typeof STATS_DEFAULT>} patch
 */
export function setGameStats(patch) {
  const current = getGameStats();
  const next = { ...current };
  if (typeof patch.bestScore  === "number") next.bestScore  = patch.bestScore;
  if (typeof patch.wavesPlayed === "number") next.wavesPlayed = patch.wavesPlayed;
  if (patch.airspacesIdentified && typeof patch.airspacesIdentified === "object") {
    next.airspacesIdentified = {
      ...current.airspacesIdentified,
      ...patch.airspacesIdentified,
    };
  }
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(next));
  } catch {
    /* private mode — in-memory only */
  }
}

// ── GameScore ─────────────────────────────────────────────────────────────

const MAX_STREAK = 10;

export class GameScore {
  constructor() {
    /** Points accumulated in the current wave. */
    this.waveScore = 0;
    /** Current identification streak (reset on contactLost). */
    this.streak    = 0;
  }

  /**
   * Award points for a successful contact identification.
   *
   * Formula:
   *   base      = 100
   *   speedBonus = max(0, 1 - elapsedS / timeLimitS)   → 0..1 (so final up to 2×)
   *   streakMult = 1.1 ^ streak  (streak capped at MAX_STREAK before multiply)
   *   points     = round(base × (1 + speedBonus) × accuracy × streakMult)
   *
   * @param {{ elapsedS: number, accuracy: number, timeLimitS: number }} opts
   * @returns {number} points awarded (rounded integer)
   */
  contactIdentified({ elapsedS, accuracy, timeLimitS }) {
    const base       = 100;
    const speedBonus = Math.max(0, 1 - elapsedS / timeLimitS);
    const cappedStreak = Math.min(this.streak, MAX_STREAK);
    const streakMult = Math.pow(1.1, cappedStreak);
    const points     = Math.round(base * (1 + speedBonus) * accuracy * streakMult);
    this.streak++;
    this.waveScore += points;
    return points;
  }

  /**
   * Register a contact loss — resets the streak.
   */
  contactLost() {
    this.streak = 0;
  }

  /**
   * Reset wave score and streak to zero.
   */
  reset() {
    this.waveScore = 0;
    this.streak    = 0;
  }
}
