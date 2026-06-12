// audio.js — procedural Web Audio core: buses, alert tones, settings.
// B8.T1 — buses + tone library + alert subscription + settings UI hook.
//
// Graph (once unlocked):
//   ctx → masterGain → engineBus (gain node, placeholder for B8.T2)
//                    → sfxBus    (one-shot tones, alert tones)
//
// All per-shot nodes (OscillatorNode, AudioBufferSourceNode) are created
// on demand inside play() — this is fine because they are truly one-shot
// (start once, stop once, then auto-disconnect). The no-allocation rule
// applies only to the per-FRAME update() path.
//
// Pre-unlock: all play() calls are silent no-ops. unlock() is idempotent.

const LS_KEY = "kuson.audio.v1";
const DEFAULTS = Object.freeze({ volume: 0.7, muted: false, voice: true });

/** Load settings from localStorage; merge with defaults; corrupt-JSON safe. */
export function getAudioSettings() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { ...DEFAULTS };
    return {
      volume: typeof parsed.volume === "number" ? Math.max(0, Math.min(1, parsed.volume)) : DEFAULTS.volume,
      muted:  typeof parsed.muted  === "boolean" ? parsed.muted  : DEFAULTS.muted,
      voice:  typeof parsed.voice  === "boolean" ? parsed.voice  : DEFAULTS.voice,
    };
  } catch {
    return { ...DEFAULTS }; // private mode or corrupt JSON
  }
}

/** Persist a partial patch over current settings. */
export function setAudioSettings(patch) {
  const current = getAudioSettings();
  const next = { ...current, ...patch };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(next));
  } catch {
    /* private mode — in-memory only */
  }
  return next;
}

// ---------------------------------------------------------------------------
// Tier → tone name mapping (used by alert subscription).
// Ranks 0–6 are safety-class (NO_FLY, AUTH_CLAMP, RTH_ACTIVE, ALT_OVER_REG,
// ALT_OVER_OP, ALT_AT_REG, ALT_AT_OP). RADIO = rank 7. ADVISORY = rank 8.
// ---------------------------------------------------------------------------
function _toneForTier(tier) {
  if (!tier) return null;
  if (tier.id === "RADIO")    return "alertRadio";
  if (tier.id === "ADVISORY") return "alertAdvisory";
  return "alertSafety"; // all safety-rank tiers (rank 0–6)
}

// ---------------------------------------------------------------------------
// installAudio — factory. Call once from main.js.
// ---------------------------------------------------------------------------
export function installAudio({ alerts }) {
  let ctx  = null;
  let masterGain  = null;
  let engineBus   = null;
  let sfxBus      = null;
  let _noiseBuffer = null; // 1 s white-noise buffer, built once at unlock

  // Settings loaded at construction time; kept in sync by setVolume/setMuted.
  const _settings = getAudioSettings();

  // Target gain values for smooth ramps (80 ms) in update().
  let _targetMasterGain = _settings.muted ? 0 : _settings.volume;
  let _unlocked = false;

  // Pointer + keyboard unlock listeners (removed once ctx is running).
  let _pdListener = null;
  let _kdListener = null;

  // Alert deduplication.
  let _alertUnsub  = null;
  const _seenAlerts = new Set(); // keys of alerts that fired a tone

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /** Create the AudioContext and build the bus graph. Called from unlock(). */
  function _createContext() {
    ctx = new AudioContext();

    masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(_targetMasterGain, ctx.currentTime);
    masterGain.connect(ctx.destination);

    engineBus = ctx.createGain();
    engineBus.gain.setValueAtTime(0, ctx.currentTime); // placeholder — B8.T2
    engineBus.connect(masterGain);

    sfxBus = ctx.createGain();
    sfxBus.gain.setValueAtTime(1, ctx.currentTime);
    sfxBus.connect(masterGain);

    // Build shared 1 s white-noise buffer (used by alertRadio and banish).
    const SR = ctx.sampleRate;
    _noiseBuffer = ctx.createBuffer(1, SR, SR);
    const data = _noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
  }

  /** Schedule an envelope-clean gain ramp: 0 → peak over `att` s, then
   *  linear decay to 0 over `rel` s, starting at `t`. Returns the GainNode. */
  function _env(g, t, att, peak, rel) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + att);
    g.gain.linearRampToValueAtTime(0, t + att + rel);
  }

  // -------------------------------------------------------------------------
  // Tone library
  // -------------------------------------------------------------------------

  function _playAlertSafety() {
    // Urgent triple beep: 3 × 60 ms square 950 Hz, 70 ms gap between starts.
    const t = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const g   = ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(950, t);
      osc.connect(g);
      g.connect(sfxBus);
      const start = t + i * 0.070;
      _env(g, start, 0.005, 0.25, 0.055);
      osc.start(start);
      osc.stop(start + 0.065);
    }
  }

  function _playAlertRadio() {
    // Radio squelch chirp: 40 ms white-noise burst then 120 ms sine sweep 1200→800 Hz.
    const t = ctx.currentTime;

    // Noise burst
    const ns  = ctx.createBufferSource();
    const nsG = ctx.createGain();
    ns.buffer = _noiseBuffer;
    ns.connect(nsG);
    nsG.connect(sfxBus);
    _env(nsG, t, 0.005, 0.3, 0.030);
    ns.start(t);
    ns.stop(t + 0.040);

    // Sine sweep
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.type = "sine";
    const t2 = t + 0.045;
    osc.frequency.setValueAtTime(1200, t2);
    osc.frequency.linearRampToValueAtTime(800, t2 + 0.120);
    osc.connect(g);
    g.connect(sfxBus);
    _env(g, t2, 0.005, 0.4, 0.110);
    osc.start(t2);
    osc.stop(t2 + 0.125);
  }

  function _playAlertAdvisory() {
    // Single soft ping: sine 660 Hz, 200 ms decay.
    const t   = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(660, t);
    osc.connect(g);
    g.connect(sfxBus);
    _env(g, t, 0.005, 0.25, 0.190);
    osc.start(t);
    osc.stop(t + 0.200);
  }

  function _playTick() {
    // 15 ms 2 kHz blip at low gain.
    const t   = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(2000, t);
    osc.connect(g);
    g.connect(sfxBus);
    _env(g, t, 0.005, 0.12, 0.008);
    osc.start(t);
    osc.stop(t + 0.015);
  }

  function _playLockSweep() {
    // Sine sweep 400→1600 Hz over 350 ms + short bell (sine 1318 Hz decay).
    const t   = ctx.currentTime;

    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(400, t);
    osc.frequency.exponentialRampToValueAtTime(1600, t + 0.350);
    osc.connect(g);
    g.connect(sfxBus);
    _env(g, t, 0.005, 0.35, 0.340);
    osc.start(t);
    osc.stop(t + 0.360);

    // Bell overlay
    const bell  = ctx.createOscillator();
    const bellG = ctx.createGain();
    bell.type = "sine";
    bell.frequency.setValueAtTime(1318, t + 0.320);
    bell.connect(bellG);
    bellG.connect(sfxBus);
    _env(bellG, t + 0.320, 0.005, 0.3, 0.300);
    bell.start(t + 0.320);
    bell.stop(t + 0.640);
  }

  function _playBanish() {
    // Noise through lowpass sweep 4k→200 Hz over 500 ms + bell 880 Hz.
    const t   = ctx.currentTime;

    const ns     = ctx.createBufferSource();
    const lp     = ctx.createBiquadFilter();
    const noiseG = ctx.createGain();
    ns.buffer = _noiseBuffer;
    ns.loop   = true;
    lp.type   = "lowpass";
    lp.frequency.setValueAtTime(4000, t);
    lp.frequency.exponentialRampToValueAtTime(200, t + 0.500);
    ns.connect(lp);
    lp.connect(noiseG);
    noiseG.connect(sfxBus);
    _env(noiseG, t, 0.010, 0.4, 0.490);
    ns.start(t);
    ns.stop(t + 0.510);

    // Bell
    const bell  = ctx.createOscillator();
    const bellG = ctx.createGain();
    bell.type = "sine";
    bell.frequency.setValueAtTime(880, t + 0.480);
    bell.connect(bellG);
    bellG.connect(sfxBus);
    _env(bellG, t + 0.480, 0.005, 0.35, 0.250);
    bell.start(t + 0.480);
    bell.stop(t + 0.750);
  }

  function _playLost() {
    // Descending two-tone: 600→400 Hz, 2 × 180 ms.
    const t = ctx.currentTime;
    const freqs = [600, 400];
    for (let i = 0; i < 2; i++) {
      const osc = ctx.createOscillator();
      const g   = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freqs[i], t);
      osc.connect(g);
      g.connect(sfxBus);
      const start = t + i * 0.190;
      _env(g, start, 0.005, 0.3, 0.170);
      osc.start(start);
      osc.stop(start + 0.180);
    }
  }

  function _playChime() {
    // Two-note ascending: 880, 1108 Hz, 150 ms each.
    const t     = ctx.currentTime;
    const freqs = [880, 1108];
    for (let i = 0; i < 2; i++) {
      const osc = ctx.createOscillator();
      const g   = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freqs[i], t);
      osc.connect(g);
      g.connect(sfxBus);
      const start = t + i * 0.160;
      _env(g, start, 0.005, 0.28, 0.140);
      osc.start(start);
      osc.stop(start + 0.150);
    }
  }

  const _TONES = {
    alertSafety:   _playAlertSafety,
    alertRadio:    _playAlertRadio,
    alertAdvisory: _playAlertAdvisory,
    tick:          _playTick,
    lockSweep:     _playLockSweep,
    banish:        _playBanish,
    lost:          _playLost,
    chime:         _playChime,
  };

  // -------------------------------------------------------------------------
  // Alert subscription
  // -------------------------------------------------------------------------

  function _handleAlertPayload(payload) {
    // payload = { active, chips, all } — each entry has .key and .tier
    const currentKeys = new Set(payload.all.map((a) => a.key));

    // Prune seen keys that left the active set.
    for (const k of _seenAlerts) {
      if (!currentKeys.has(k)) _seenAlerts.delete(k);
    }

    // Fire a tone for each NEW key.
    for (const alert of payload.all) {
      if (!_seenAlerts.has(alert.key)) {
        _seenAlerts.add(alert.key);
        const tone = _toneForTier(alert.tier);
        if (tone) _audio.play(tone);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Public API object
  // -------------------------------------------------------------------------

  const _audio = {
    // Debug fields — mutable, read by console / tests.
    _lastPlayed: null,
    _lastSay:    null,

    /**
     * unlock() — create the AudioContext (lazy) and attempt ctx.resume().
     * Idempotent: safe to call many times.
     * Also installs capture-phase pointerdown/keydown listeners that remove
     * themselves once the context is running.
     */
    unlock() {
      if (!ctx) _createContext();

      if (ctx.state !== "running") {
        ctx.resume().catch(() => {});
      }

      if (!_unlocked) {
        _unlocked = true;

        // Subscribe to alert queue now that we're wired up.
        _alertUnsub = alerts.subscribe(_handleAlertPayload);

        // Install capture-phase listeners; they remove themselves once running.
        _pdListener = () => {
          if (ctx.state !== "running") ctx.resume().catch(() => {});
          if (ctx.state === "running") _removeUnlockListeners();
        };
        _kdListener = _pdListener;
        document.addEventListener("pointerdown", _pdListener, { capture: true, passive: true });
        document.addEventListener("keydown",     _kdListener, { capture: true, passive: true });

        // visibilitychange: suspend when hidden, resume when visible.
        document.addEventListener("visibilitychange", () => {
          if (!ctx) return;
          if (document.hidden) {
            ctx.suspend().catch(() => {});
          } else {
            ctx.resume().catch(() => {});
          }
        });
      }
    },

    /**
     * play(name) — fire a procedural one-shot tone by name.
     * Silent no-op if the context is not yet created.
     */
    play(name) {
      this._lastPlayed = name;
      if (!ctx || ctx.state === "closed") return;
      const fn = _TONES[name];
      if (fn) fn();
    },

    /**
     * say(text) — STUB (B8.T3 implements speech synthesis).
     */
    say(text) {
      this._lastSay = text;
      // B8.T3 will implement SpeechSynthesis here.
    },

    /**
     * update(dt, droneState) — per-frame call.
     * This task: only ramps masterGain toward the target value (80 ms ramp).
     * B8.T2 will add engine AudioParam updates here.
     */
    update(_dt, _droneState) {
      if (!ctx || !masterGain) return;
      const target = _settings.muted ? 0 : _settings.volume;
      const now    = ctx.currentTime;
      // Only reschedule if the target changed (avoid flooding the param queue).
      const current = masterGain.gain.value;
      if (Math.abs(current - target) > 0.001) {
        masterGain.gain.cancelScheduledValues(now);
        masterGain.gain.setValueAtTime(current, now);
        masterGain.gain.linearRampToValueAtTime(target, now + 0.080);
        _targetMasterGain = target;
      }
    },

    setVolume(v) {
      _settings.volume = Math.max(0, Math.min(1, v));
      setAudioSettings({ volume: _settings.volume });
    },

    setMuted(b) {
      _settings.muted = !!b;
      setAudioSettings({ muted: _settings.muted });
    },

    setVoiceEnabled(b) {
      _settings.voice = !!b;
      setAudioSettings({ voice: _settings.voice });
    },

    /** Read-only snapshot of current settings (for UI restore). */
    getSettings() {
      return { ..._settings };
    },

    dispose() {
      _removeUnlockListeners();
      if (_alertUnsub) { _alertUnsub(); _alertUnsub = null; }
      if (ctx) { ctx.close().catch(() => {}); ctx = null; }
      masterGain = engineBus = sfxBus = _noiseBuffer = null;
    },
  };

  function _removeUnlockListeners() {
    if (_pdListener) {
      document.removeEventListener("pointerdown", _pdListener, { capture: true });
      _pdListener = null;
    }
    if (_kdListener) {
      document.removeEventListener("keydown", _kdListener, { capture: true });
      _kdListener = null;
    }
  }

  return _audio;
}
