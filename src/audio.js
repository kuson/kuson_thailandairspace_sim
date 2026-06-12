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
  // B8.T2 — Engine synth state (lazy, rebuilt on mode|presetId change)
  // -------------------------------------------------------------------------

  // Key that identifies the current chain. Format: "<mode>|<presetId>".
  let _engineKey    = null;
  // Nodes that belong to the current chain (stopped + disconnected on rebuild).
  let _engineNodes  = [];   // OscillatorNode / AudioBufferSourceNode instances
  let _engineChainGain = null; // GainNode at the output of the chain → engineBus

  // Prop-specific: primary osc + sub osc.
  let _propOsc      = null;
  let _propSub      = null;

  // Jet-specific: noise source + bandpass + rumble osc.
  let _jetNoise     = null;
  let _jetBP        = null;
  let _jetRumble    = null;

  // Hover-specific: triangle osc + LFO osc + LFO gain mod.
  let _hoverTriOsc  = null;
  let _hoverLfoOsc  = null;
  let _hoverLfoGain = null;

  // Stall horn — built once (on first update with ctx), gate via gainNode.
  let _hornOsc      = null;   // square 800 Hz
  let _hornLfoOsc   = null;   // square 4 Hz duty modulator
  let _hornGain     = null;   // overall horn gate gain
  let _hornActive   = false;
  let _hornBuilt    = false;

  // Debug-readable values (updated per frame).
  let _dbgEngineKind  = "";
  let _dbgEngineFreq  = 0;
  let _dbgEngineGain  = 0;

  // B8.T3 — Speech synthesis / engine duck state.
  // _voiceList: cached voices array; refreshed on voiceschanged (once).
  // _voiceListened: true once the voiceschanged listener has been registered.
  // _ducked: true while an utterance is speaking; drives a per-frame multiplier.
  // _duckMult: current duck multiplier applied to _engineChainGain per-frame.
  //            Ramped toward _duckTarget at _duckRatePerFrame speed in update().
  // _duckTarget: 1.0 (normal) or 0.4 (ducked).
  let _voiceList      = null;
  let _voiceListened  = false;
  let _ducked         = false;
  let _duckMult       = 1.0;
  let _duckTarget     = 1.0;

  /** Classify presetId → engine kind string. */
  function _kindForState(mode, presetId) {
    if (mode === "airplane") {
      if (presetId === "cessna172") return "prop";
      return "jet";   // learjet, b777
    }
    if (mode === "drone") return "prop";   // Mavic — treat like prop
    return "hover";   // UFO / HOVERCRAFT / 100x
  }

  /** Stop all running sources in _engineNodes and clear. */
  function _disposeChain() {
    const now = ctx ? ctx.currentTime : 0;
    for (const n of _engineNodes) {
      try { n.stop(now); } catch (_) { /* already stopped */ }
      try { n.disconnect(); } catch (_) { /* */ }
    }
    _engineNodes = [];
    if (_engineChainGain) {
      try { _engineChainGain.disconnect(); } catch (_) { /* */ }
      _engineChainGain = null;
    }
    _propOsc = _propSub = null;
    _jetNoise = _jetBP = _jetRumble = null;
    _hoverTriOsc = _hoverLfoOsc = _hoverLfoGain = null;
  }

  /** Build the engine chain for the given kind. Chain → engineBus. */
  function _buildChain(kind) {
    _disposeChain();
    const now = ctx.currentTime;
    _engineChainGain = ctx.createGain();
    _engineChainGain.gain.setValueAtTime(0, now);
    _engineChainGain.connect(engineBus);

    if (kind === "prop") {
      // Sawtooth primary + sine sub → lowpass → chainGain.
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(900, now);

      _propOsc = ctx.createOscillator();
      _propOsc.type = "sawtooth";
      _propOsc.frequency.setValueAtTime(55, now);
      _propOsc.connect(lp);
      _engineNodes.push(_propOsc);

      _propSub = ctx.createOscillator();
      _propSub.type = "sine";
      _propSub.frequency.setValueAtTime(27.5, now); // half of 55
      _propSub.connect(lp);
      _engineNodes.push(_propSub);

      lp.connect(_engineChainGain);

      _propOsc.start(now);
      _propSub.start(now);

    } else if (kind === "jet") {
      // Looped noise → bandpass + sine 60 Hz rumble → chainGain.
      _jetNoise = ctx.createBufferSource();
      _jetNoise.buffer = _noiseBuffer;
      _jetNoise.loop = true;
      _engineNodes.push(_jetNoise);

      _jetBP = ctx.createBiquadFilter();
      _jetBP.type = "bandpass";
      _jetBP.frequency.setValueAtTime(600, now);
      _jetBP.Q.setValueAtTime(0.8, now);

      _jetRumble = ctx.createOscillator();
      _jetRumble.type = "sine";
      _jetRumble.frequency.setValueAtTime(60, now);
      _engineNodes.push(_jetRumble);

      _jetNoise.connect(_jetBP);
      _jetBP.connect(_engineChainGain);
      _jetRumble.connect(_engineChainGain);

      _jetNoise.start(now);
      _jetRumble.start(now);

    } else {
      // hover: triangle 140 Hz + 0.5 Hz LFO → lfoGain modulating chainGain.
      _hoverTriOsc = ctx.createOscillator();
      _hoverTriOsc.type = "triangle";
      _hoverTriOsc.frequency.setValueAtTime(140, now);
      _engineNodes.push(_hoverTriOsc);

      _hoverLfoOsc = ctx.createOscillator();
      _hoverLfoOsc.type = "sine";
      _hoverLfoOsc.frequency.setValueAtTime(0.5, now);
      _engineNodes.push(_hoverLfoOsc);

      _hoverLfoGain = ctx.createGain();
      _hoverLfoGain.gain.setValueAtTime(0.1, now); // LFO depth

      _hoverTriOsc.connect(_engineChainGain);
      _hoverLfoOsc.connect(_hoverLfoGain);
      _hoverLfoGain.connect(_engineChainGain.gain);  // LFO modulates chainGain

      _hoverTriOsc.start(now);
      _hoverLfoOsc.start(now);
    }
  }

  /** Build stall horn once (first update after ctx exists). */
  function _buildHorn() {
    if (_hornBuilt || !ctx) return;
    _hornBuilt = true;
    const now = ctx.currentTime;

    _hornOsc = ctx.createOscillator();
    _hornOsc.type = "square";
    _hornOsc.frequency.setValueAtTime(800, now);

    // 4 Hz LFO osc as a duty gate — we use a square LFO to toggle the horn on/off.
    _hornLfoOsc = ctx.createOscillator();
    _hornLfoOsc.type = "square";
    _hornLfoOsc.frequency.setValueAtTime(4, now);

    _hornGain = ctx.createGain();
    _hornGain.gain.setValueAtTime(0, now);

    // The LFO modulates a gain that drives the horn. Connect:
    //   hornOsc → lfoModGain (constant 0.15) → hornGain (gated) → sfxBus
    //   hornLfoOsc → lfoDepthGain (depth 0.5) → lfoModGain.gain (ignored — use direct product)
    // Simpler: hornOsc → hornGain → sfxBus; hornLfoOsc → lfoDepthGain → hornGain.gain
    const lfoDepthGain = ctx.createGain();
    lfoDepthGain.gain.setValueAtTime(0.15, now); // LFO amplitude into gain param
    _hornLfoOsc.connect(lfoDepthGain);
    lfoDepthGain.connect(_hornGain.gain);

    _hornOsc.connect(_hornGain);
    _hornGain.connect(sfxBus);

    _hornOsc.start(now);
    _hornLfoOsc.start(now);
  }

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

  function _playClickBlip() {
    // Short 30 ms click blip (noise burst) — used as radio squelch-off chirp.
    const t   = ctx.currentTime;
    const ns  = ctx.createBufferSource();
    const nsG = ctx.createGain();
    ns.buffer = _noiseBuffer;
    ns.connect(nsG);
    nsG.connect(sfxBus);
    _env(nsG, t, 0.002, 0.18, 0.025);
    ns.start(t);
    ns.stop(t + 0.030);
  }

  // ── B9.T3 weapon tones ────────────────────────────────────────────────────

  function _playFire() {
    // 40 ms filtered noise snap — gun shot.
    const t    = ctx.currentTime;
    const ns   = ctx.createBufferSource();
    const nsG  = ctx.createGain();
    const hp   = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.setValueAtTime(800, t);
    ns.buffer = _noiseBuffer;
    ns.connect(hp);
    hp.connect(nsG);
    nsG.connect(sfxBus);
    _env(nsG, t, 0.001, 0.5, 0.035);
    ns.start(t);
    ns.stop(t + 0.040);
  }

  function _playSpark() {
    // 2.5 kHz ping with fast decay — metallic spark impact.
    const t   = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(2500, t);
    osc.frequency.exponentialRampToValueAtTime(1800, t + 0.080);
    osc.connect(g);
    g.connect(sfxBus);
    _env(g, t, 0.001, 0.22, 0.075);
    osc.start(t);
    osc.stop(t + 0.085);
  }

  function _playShieldPing() {
    // Hollow 1.2 kHz ring — two oscillators slightly detuned for a 'hollow' chorus.
    const t = ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const osc = ctx.createOscillator();
      const g   = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(1200 + i * 8, t); // slight detune
      osc.connect(g);
      g.connect(sfxBus);
      _env(g, t, 0.003, 0.18, 0.200);
      osc.start(t);
      osc.stop(t + 0.210);
    }
  }

  function _playOverheat() {
    // Descending buzz: square wave stepping down 400→200 Hz in three 150 ms chunks.
    const t = ctx.currentTime;
    const freqs = [400, 280, 200];
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const g   = ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(freqs[i], t);
      osc.connect(g);
      g.connect(sfxBus);
      const start = t + i * 0.150;
      _env(g, start, 0.005, 0.2, 0.130);
      osc.start(start);
      osc.stop(start + 0.140);
    }
  }

  function _playExplode() {
    // Noise burst with lowpass sweep 6k→80 Hz over 600 ms + 60 Hz sine thump.
    const t      = ctx.currentTime;
    const ns     = ctx.createBufferSource();
    const lp     = ctx.createBiquadFilter();
    const noiseG = ctx.createGain();
    ns.buffer = _noiseBuffer;
    ns.loop   = true;
    lp.type   = "lowpass";
    lp.frequency.setValueAtTime(6000, t);
    lp.frequency.exponentialRampToValueAtTime(80, t + 0.600);
    ns.connect(lp);
    lp.connect(noiseG);
    noiseG.connect(sfxBus);
    _env(noiseG, t, 0.005, 0.6, 0.580);
    ns.start(t);
    ns.stop(t + 0.620);

    // Low thump
    const thump  = ctx.createOscillator();
    const thumpG = ctx.createGain();
    thump.type = "sine";
    thump.frequency.setValueAtTime(60, t);
    thump.frequency.exponentialRampToValueAtTime(30, t + 0.250);
    thump.connect(thumpG);
    thumpG.connect(sfxBus);
    _env(thumpG, t, 0.003, 0.55, 0.240);
    thump.start(t);
    thump.stop(t + 0.260);
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
    // B9.T3 weapon tones
    fire:          _playFire,
    spark:         _playSpark,
    shieldPing:    _playShieldPing,
    overheat:      _playOverheat,
    explode:       _playExplode,
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
    _speaking:   false,

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
     * say(text) — B8.T3: speak text via SpeechSynthesis with engine ducking.
     * Keeps _lastSay as the verification hook (set unconditionally, first line).
     */
    say(text) {
      this._lastSay = text;

      // Gate 1: voice setting off.
      if (!_settings.voice) return;
      // Gate 2: no SpeechSynthesis API (node / old browsers).
      if (typeof window === "undefined" || !window.speechSynthesis) return;
      // Gate 3: empty text.
      if (!text || !text.trim()) return;

      // Ensure voice list is populated and refreshed on async voiceschanged.
      if (!_voiceListened) {
        _voiceListened = true;
        _voiceList = window.speechSynthesis.getVoices();
        window.speechSynthesis.addEventListener("voiceschanged", () => {
          _voiceList = window.speechSynthesis.getVoices();
        });
      } else if (_voiceList === null) {
        _voiceList = window.speechSynthesis.getVoices();
      }

      // Cancel any ongoing utterance (new call preempts stale chatter).
      window.speechSynthesis.cancel();

      // Pick voice: prefer en-GB, then en-US, then any en.
      let voice = null;
      if (_voiceList && _voiceList.length > 0) {
        voice =
          _voiceList.find((v) => v.lang.startsWith("en-GB")) ??
          _voiceList.find((v) => v.lang.startsWith("en-US")) ??
          _voiceList.find((v) => v.lang.startsWith("en")) ??
          null;
      }

      const utter = new SpeechSynthesisUtterance(text);
      utter.rate   = 1.05;
      utter.pitch  = 0.9;
      // Volume follows master setting; 0 when muted.
      utter.volume = _settings.muted ? 0 : _settings.volume;
      if (voice) utter.voice = voice;

      // Duck engine on speak start.
      const _onStart = () => {
        _audio._speaking = true;
        _ducked      = true;
        _duckTarget  = 0.4;
        // Squelch chirp before speech (only if ctx is unlocked).
        if (ctx && ctx.state === "running") _playAlertRadio();
      };

      // Restore engine and play blip on end/error.
      const _onEnd = () => {
        _audio._speaking = false;
        _ducked     = false;
        _duckTarget = 1.0;
        if (ctx && ctx.state === "running") _playClickBlip();
      };

      utter.addEventListener("start", _onStart);
      utter.addEventListener("end",   _onEnd);
      utter.addEventListener("error", _onEnd);

      window.speechSynthesis.speak(utter);
    },

    /**
     * update(dt, droneState) — per-frame call.
     * Ramps masterGain (80 ms) and drives engine synth + stall horn.
     * droneState: { mode, presetId, throttle, airspeedMs, Vs, stalled, paused }
     */
    update(_dt, droneState) {
      if (!ctx || !masterGain) return;

      // --- masterGain ramp ---
      const target = _settings.muted ? 0 : _settings.volume;
      const now    = ctx.currentTime;
      const current = masterGain.gain.value;
      if (Math.abs(current - target) > 0.001) {
        masterGain.gain.cancelScheduledValues(now);
        masterGain.gain.setValueAtTime(current, now);
        masterGain.gain.linearRampToValueAtTime(target, now + 0.080);
        _targetMasterGain = target;
      }

      // --- engine duck ramp (B8.T3) ---
      // Ramp _duckMult toward _duckTarget at ~4.0 units/s (150 ms full swing).
      // Applied as a multiplier on the chain-gain target below.
      if (_duckMult !== _duckTarget) {
        const step = (_duckTarget > _duckMult ? 1 : -1) * Math.min(_dt, 0.1) * 4.0;
        _duckMult = _duckMult + step;
        // Clamp to [0.4, 1.0] and snap to target when close enough.
        if (Math.abs(_duckMult - _duckTarget) < 0.01) _duckMult = _duckTarget;
        _duckMult = Math.max(0.4, Math.min(1.0, _duckMult));
      }

      // --- engine synth ---
      const state = droneState;
      if (!state || !state.mode) {
        // No state: silence engine.
        if (_engineChainGain) {
          _engineChainGain.gain.setTargetAtTime(0, now, 0.050);
        }
        _dbgEngineGain = 0;
        _dbgEngineKind = "";
        return;
      }

      const { mode, presetId, throttle = 0, airspeedMs = 0, Vs = 0, paused = false } = state;
      const kind = _kindForState(mode, presetId);
      const newKey = `${mode}|${presetId}`;

      // Rebuild chain only when key changes.
      if (newKey !== _engineKey) {
        _engineKey = newKey;
        _buildChain(kind);
      }

      // Build stall horn lazily.
      _buildHorn();

      const RAMP = 0.050; // 50 ms time constant for all AudioParam changes

      // --- Per-frame: freq + gain updates (AudioParam only, zero node creation) ---
      if (_engineChainGain) {
        const gainTarget = ((paused) ? 0 : 0.15 + 0.4 * throttle) * _duckMult;
        _engineChainGain.gain.setTargetAtTime(gainTarget, now, RAMP);
        _dbgEngineGain = gainTarget;

        if (kind === "prop" && _propOsc) {
          const freq = 55 + 55 * throttle;
          _propOsc.frequency.setTargetAtTime(freq, now, RAMP);
          _propSub.frequency.setTargetAtTime(freq * 0.5, now, RAMP);
          _dbgEngineFreq = freq;

        } else if (kind === "jet" && _jetBP) {
          const bpFreq = 600 + 1800 * throttle;
          _jetBP.frequency.setTargetAtTime(bpFreq, now, RAMP);
          _dbgEngineFreq = bpFreq;

        } else if (kind === "hover" && _hoverTriOsc) {
          _dbgEngineFreq = 140;
        }

        _dbgEngineKind = kind;
      }

      // --- Stall horn ---
      if (_hornGain) {
        const hornActive = (mode === "airplane") && !paused && (airspeedMs < 1.1 * Vs) && Vs > 0;
        if (hornActive !== _hornActive) {
          _hornActive = hornActive;
          const hornTarget = hornActive ? 0.25 : 0;
          _hornGain.gain.setTargetAtTime(hornTarget, now, 0.010); // ≤50 ms ramp
        }
      }
    },

    // --- B8.T2 debug getters ---
    get _engineKind() { return _dbgEngineKind; },
    get _engineFreq() { return _dbgEngineFreq; },
    get _engineGain() { return _dbgEngineGain; },
    get _hornActive() { return _hornActive; },

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
      // B8.T3: cancel any in-flight speech and restore duck state.
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      this._speaking = false;
      _ducked = false; _duckTarget = 1.0; _duckMult = 1.0;
      _disposeChain();
      if (_hornOsc)    { try { _hornOsc.stop();    } catch (_) {} }
      if (_hornLfoOsc) { try { _hornLfoOsc.stop(); } catch (_) {} }
      _hornOsc = _hornLfoOsc = _hornGain = null;
      _hornBuilt = false;
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
