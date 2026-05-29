// ui.js — HUD, minimap, educational panel, display options.
import {
  worldToGeo, formatLatLon, bearingToCompass, M_TO_FT, FT_TO_M, ORIGIN,
  lonToTileX, latToTileY, tileXToLon, tileYToLat, geoToWorld,
} from "./coords.js";
import { isMilitaryAirspace } from "./airspace.js";
import { elevationAt, isLoaded as terrainLoaded } from "./terrain.js";
import { SPEED_PRESETS } from "./drone.js";
import { FlightMode, EasyMode } from "./modes.js";
import { lookupAdmin } from "./geocode.js";
import { simState } from "./simState.js";
import { alerts, AlertTier } from "./alerts.js";
import { AltitudeAdvisor } from "./altitudeAdvisor.js";
import { MinimapTileCache } from "./ground.js";
import { getInputSettings, setInputSettings, DEFAULT_INPUT_SETTINGS } from "./input.js";

const CAT_DESCR = {
  CTR: "Control Zone — controlled airspace surrounding an airport from the ground up. ATC clearance required.",
  TMA: "Terminal Manoeuvring Area — controlled airspace where arrivals and departures sequence.",
  "Class D": "Class D — controlled, both VFR and IFR with clearance, two-way radio.",
  Prohibited: "Prohibited (P) — flight is forbidden. Special permission only.",
  Restricted: "Restricted (R) — flight is restricted; requires authorisation/conditions.",
  Danger: "Danger (D) — activities hazardous to aircraft may exist (often military training).",
};

const DRONE_RULES_HTML = `
  <p><strong>Thailand drone rules — the short version:</strong></p>
  <ul>
    <li>Register every drone &gt;250 g with <strong>CAAT</strong> and NBTC before flying.</li>
    <li>Recreational ceiling is <strong>90 m AGL (≈295 ft)</strong>.</li>
    <li>Stay <strong>≥9 km</strong> away from any airport (and out of CTR/TMA entirely).</li>
    <li>Daylight, VLOS, no flying over crowds or government buildings.</li>
    <li>Heavy fines/jail for violations — and yes, the AIP rules above still apply.</li>
  </ul>
  <p style="opacity:0.7;font-size:11px">Always confirm against current CAAT guidance.</p>`;

const COMPASS_TAU = 0.14;

export class UI {
  constructor({ drone, camera, airspaceLayer, tourGuide, onFlyTo, onUndo, onRedo, onReset }) {
    this.drone = drone;
    this.camera = camera;
    this.layer = airspaceLayer;
    this.tourGuide = tourGuide;
    this.onFlyTo = onFlyTo;
    this.onUndo = onUndo;
    this.onRedo = onRedo;
    this.onReset = onReset;

    this.hud = document.getElementById("hud");
    this.minimap = document.getElementById("minimap");
    this.minimapCtx = this.minimap.getContext("2d");
    this.panel = document.getElementById("panel");
    this.panelTitle = document.getElementById("panelTitle");
    this.panelToggle = document.getElementById("panelToggle");
    this.controlsHint = document.getElementById("controlsHint");
    this.controlsToggle = document.getElementById("controlsToggle");
    this.airspaceList = document.getElementById("airspaceList");
    this.resetBtn = document.getElementById("resetBtn");
    this.currentInside = document.getElementById("currentInside");
    this.speedControls = document.getElementById("speedControls");
    this.modeChip = document.getElementById("modeChip");
    this.easyModeIntro = document.getElementById("easyModeIntro");
    this.easyModeIntroClose = document.getElementById("easyModeIntroClose");
    this.undoBtn = document.getElementById("undoBtn");
    this.redoBtn = document.getElementById("redoBtn");
    this.historyLabel = document.getElementById("historyLabel");
    this.airspaceFilter = document.getElementById("airspaceFilter");
    this.crosshairs = document.getElementById("crosshairs");
    this.crosshairInfo = document.getElementById("crosshairInfo");
    this.viewModeBadge = document.getElementById("viewModeBadge");
    this.minimapLabel = document.getElementById("minimapLabel");
    this.hdgCompass = document.getElementById("hdgCompass");
    this.headingDigital = document.getElementById("heading");
    this.identifyPanel = document.getElementById("identifyPanel");
    this.placeLabel = document.getElementById("placeLabel");
    this.altTape = document.getElementById("altTape");
    this.altTapeCtx = this.altTape?.getContext("2d") ?? null;
    this.attitudeCanvas = document.getElementById("attitudeIndicator");
    this.attitudeCtx = this.attitudeCanvas?.getContext("2d") ?? null;
    this.toggleAltBtn = document.getElementById("toggleAltTape");
    this.toggleAttitudeBtn = document.getElementById("toggleAttitude");
    this.togglePauseBtn = document.getElementById("togglePause");
    this.toggleStrictCaatBtn = document.getElementById("toggleStrictCaat");

    // Betterment-2 P2.T3/T4: altitude advisor + single-banner alert queue.
    // All warnings (geofence, RTH, altitude) funnel through `alerts`; one
    // banner shows the top-priority alert, the rest become chips.
    this.altitudeAdvisor = new AltitudeAdvisor(alerts);
    this.alertBanner = document.getElementById("alertBanner");
    this.alertChips = document.getElementById("alertChips");
    alerts.subscribe((payload) => this._renderAlerts(payload));

    // Cached HUD element refs (avoid per-frame querySelector in updateHUD)
    this._el = {
      latlon: this.hud?.querySelector("#latlon") ?? null,
      alt: this.hud?.querySelector("#alt") ?? null,
      speed: this.hud?.querySelector("#speed") ?? null,
      vsi: this.hud?.querySelector("#vsi") ?? null,
      wind: this.hud?.querySelector("#wind") ?? null,
      battery: this.hud?.querySelector("#batteryChip") ?? null,
      signal: this.hud?.querySelector("#signalChip") ?? null,
      signalText: this.hud?.querySelector("#signalText") ?? null,
      nextAirspace: this.hud?.querySelector("#nextAirspaceChip") ?? null,
      nextAirspaceRow: this.hud?.querySelector("#nextAirspaceRow") ?? null,
    };
    this._signalBars = this._el.signal
      ? Array.from(this._el.signal.querySelectorAll(".bar"))
      : [];

    // P3.T7: vertical speed indicator. EMA smoothing on dy/dt with
    // alpha=0.2 (the playbook's spec) — fast enough to feel responsive
    // during pull-ups, slow enough that physicsStep substep boundaries
    // don't make the value flicker.
    this._lastAltM = null;
    this._vsiSmoothMs = 0;

    // P4.T6: world-frame velocity smoother for the predictive chip.
    // (dx/dt, dy/dt, dz/dt) from previous position, EMA-smoothed so the
    // 30 s projection doesn't jitter when the user nudges the sticks.
    this._predPrevPos = null;
    this._predVel = { x: 0, y: 0, z: 0 };
    this._predNextKey = null;

    // Visibility flags
    this.altTapeVisible = true;
    this.attitudeVisible = false;

    this._compassDisplayHeading = 0;
    this._compassHeadingReady = false;
    this._identifyPanelKey = "";

    this.showMapUnderlay = true;
    this.showFov = true;
    this.radarCenterAircraft = true;
    this._minimapTiles = new MinimapTileCache(7);
    this._hudCache = {};
    this._adminCache = null;
    this._lastGeoKey = "";
    this._flyToTargetId = null;
    this._listFilter = "";
    this._tourRunning = false;
    this._flyToToast = document.getElementById("flyToToast");
    this._flyToToastT = null;

    this.tourSkipBtn = document.getElementById("tourSkipBtn");
    this.tourEndBtn = document.getElementById("tourEndBtn");

    // Radar pan/zoom — center in world metres, metres per pixel
    this._radarCenter = { x: 0, z: 0 };
    this._radarScale = 300_000 / (260 / 2);
    this._radarDrag = null;
    this._radarActive = false;

    // P5.T4: offscreen bake of the static airspace polygons — blitted per
    // frame instead of re-stroking ~144 rings. (re)created lazily on first
    // drawMinimap and re-baked only when appearance/position/zoom changes.
    this._minimapBake = null;
    this._bakeCenter = { x: 0, z: 0 };
    this._bakeSig = null;

    // U-toggle: 'metric' shows m/km/h; 'aero' shows ft/kt/NM
    this.unitSystem = "metric";
    // M-toggle: when true, orthographic map fills viewport and the 3D scene
    // becomes a small bottom-right inset. Default false (3D primary).
    this.mapPrimary = false;
    // Notification callback for main.js to resize the WebGL renderer
    this.onMapPrimaryChange = null;

    this._buildPanel();
    this._buildTourSection();
    this._buildSpeedControls();
    this._buildDisplayOptions();
    this._buildInputOptions();
    this._bindRadar();
    this._bind();
    this._scheduleHintCollapse();
    this._initEasyModeIntro();
  }

  setTourRunning(on) {
    this._tourRunning = on;
    if (this.tourShortBtn) this.tourShortBtn.disabled = on;
    if (this.tourFullBtn) this.tourFullBtn.disabled = on;
    if (this.tourSkipBtn) this.tourSkipBtn.disabled = !on;
    if (this.tourEndBtn) this.tourEndBtn.disabled = !on;
    if (this.panelTitle && on) {
      this.panelTitle.textContent = "Airspace Tour · In flight";
    }
  }

  _buildTourSection() {
    const el = document.getElementById("tourGuideSection");
    if (!el || !this.tourGuide?.data) return;
    const meta = this.tourGuide.data.meta ?? {};
    const short = this.tourGuide.variants.short;
    const full = this.tourGuide.variants.full;
    el.innerHTML = `
      <p class="tour-intro">${meta.tagline ?? "Guided flight from Bangkok through the volumes that matter."}</p>
      <div class="tour-actions">
        <button type="button" id="tourShortBtn" class="primary">${short?.label ?? "Express tour"}</button>
        <button type="button" id="tourFullBtn">${full?.label ?? "Full tour"}</button>
      </div>
      <p class="tour-hint">Takeoff → smooth warp to each stop → Welcome to Explore. Skip anytime.</p>`;
    this.tourShortBtn = document.getElementById("tourShortBtn");
    this.tourFullBtn = document.getElementById("tourFullBtn");
    this._bindTour();
  }

  _bindTour() {
    if (this._tourBound) return;
    this._tourBound = true;
    const start = (id) => {
      if (!this.tourGuide || this._tourRunning) return;
      const ok = this.tourGuide.start(id);
      if (ok) {
        this.setTourRunning(true);
        this._flyToTargetId = null;
        this.panel?.classList.remove("collapsed");
      }
    };
    this.tourShortBtn?.addEventListener("click", () => start("short"));
    this.tourFullBtn?.addEventListener("click", () => start("full"));
    this.tourSkipBtn?.addEventListener("click", () => this.tourGuide?.skipToNext());
    this.tourEndBtn?.addEventListener("click", () => this.tourGuide?.stop());
  }

  _buildSpeedControls() {
    if (!this.speedControls) return;
    this.speedControls.innerHTML = SPEED_PRESETS.map((p) =>
      `<button type="button" class="speed-btn${p.id === "100x" ? " active" : ""}" data-preset="${p.id}" title="${p.kmh} km/h">${p.label}</button>`
    ).join("");
    this.speedControls.querySelectorAll(".speed-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.drone.setSpeedPreset(btn.dataset.preset);
        this.syncSpeedButtons();
        this._hudCache.speedLine = null;
        this._updateModeChip();
      });
    });
  }

  syncSpeedButtons() {
    if (!this.speedControls) return;
    const id = this.drone.speedPresetId;
    this.speedControls.querySelectorAll(".speed-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.preset === id);
    });
  }

  setRadarMapDefault(on) {
    this.showMapUnderlay = on;
    const radarMapHud = document.getElementById("optRadarMapHud");
    if (radarMapHud) radarMapHud.checked = on;
  }

  setRadarCenterDefault(on) {
    this.radarCenterAircraft = on;
    const centerCb = document.getElementById("optRadarCenter");
    if (centerCb) centerCb.checked = on;
    if (on) {
      this._radarCenter.x = this.drone.position.x;
      this._radarCenter.z = this.drone.position.z;
    }
    this._updateRadarLabel();
  }

  updateHistoryButtons({ canUndo, canRedo, index, total, label }) {
    if (this.undoBtn) this.undoBtn.disabled = !canUndo;
    if (this.redoBtn) this.redoBtn.disabled = !canRedo;
    if (this.historyLabel) {
      this.historyLabel.textContent = total
        ? `${index + 1}/${total}${label ? " · " + label : ""}`
        : "—";
    }
  }

  _buildDisplayOptions() {
    const el = document.getElementById("displayOptions");
    if (!el) return;
    el.innerHTML = `
      <label class="opt"><input type="checkbox" id="optMilitary" checked /> Show military airspaces (RTAF/RTN)</label>
      <label class="opt"><input type="checkbox" id="optLabels" /> 3D airspace labels</label>
      <label class="opt"><input type="checkbox" id="optHeights" checked /> Label floor &amp; ceiling (ft)</label>
      <label class="opt">
        Ground detail
        <select id="optGroundQuality" class="opt-select">
          <option value="low">Low (z10)</option>
          <option value="med" selected>Medium (z11)</option>
          <option value="high">High (z12)</option>
          <option value="ultra">Ultra (z13)</option>
          <option value="auto">Auto (alt-adaptive)</option>
        </select>
      </label>
    `;
    const military = el.querySelector("#optMilitary");
    const labels = el.querySelector("#optLabels");
    const heights = el.querySelector("#optHeights");
    const groundQ = el.querySelector("#optGroundQuality");

    groundQ?.addEventListener("change", () => {
      this.onGroundQualityChange?.(groundQ.value);
    });

    military.addEventListener("change", () => {
      this.layer.setMilitaryVisible(military.checked);
      if (!military.checked && this._flyToTargetId) {
        const target = this.layer.airspaces.find((a) => a.id === this._flyToTargetId);
        if (target && isMilitaryAirspace(target)) {
          this._flyToTargetId = null;
        }
      }
      this._refreshAirspaceList();
    });

    labels.addEventListener("change", () => {
      this.layer.setLabelsVisible(labels.checked);
    });
    heights.addEventListener("change", () => {
      this.layer.setShowHeights(heights.checked);
    });

    const radarMapHud = document.getElementById("optRadarMapHud");
    const fovHud = document.getElementById("optFovHud");
    if (radarMapHud) {
      radarMapHud.checked = this.showMapUnderlay;
      radarMapHud.addEventListener("change", () => {
        this.showMapUnderlay = radarMapHud.checked;
      });
    }
    if (fovHud) {
      fovHud.checked = this.showFov;
      fovHud.addEventListener("change", () => {
        this.showFov = fovHud.checked;
      });
    }
  }

  /**
   * P3.T6 follow-up: settings panel exposing mouse sensitivity + gamepad
   * shaping (deadzone, expo, stickMode, invertY). Writes through
   * setInputSettings() (localStorage-backed) and calls
   * drone.reloadInputSettings() so changes take effect on the next
   * physicsStep without a page reload.
   *
   * Collapsible — kept tucked behind the "Controls" header so it doesn't
   * crowd the panel for users on keyboard only.
   */
  _buildInputOptions() {
    const el = document.getElementById("inputOptions");
    if (!el) return;
    const s = getInputSettings();

    // Mouse-sensitivity slider runs in milliradians-per-pixel for
    // readability. The underlying input.js setting is rad/px.
    const mouseMilli = (s.mouseSensitivity * 1000).toFixed(2);
    const mouseDefMilli = (DEFAULT_INPUT_SETTINGS.mouseSensitivity * 1000).toFixed(2);

    el.innerHTML = `
      <label class="opt">
        Mouse sensitivity
        <input type="range" id="inpMouseSens" min="0.5" max="6" step="0.05" value="${mouseMilli}" />
        <output id="inpMouseSensOut">${mouseMilli} mrad/px</output>
      </label>
      <label class="opt">
        Gamepad deadzone
        <input type="range" id="inpDeadzone" min="0" max="0.40" step="0.01" value="${s.deadzone}" />
        <output id="inpDeadzoneOut">${(s.deadzone * 100).toFixed(0)}%</output>
      </label>
      <label class="opt">
        Gamepad expo
        <input type="range" id="inpExpo" min="0" max="0.90" step="0.05" value="${s.expo}" />
        <output id="inpExpoOut">${(s.expo * 100).toFixed(0)}%</output>
      </label>
      <label class="opt">
        Gamepad stick mode
        <select id="inpStickMode" class="opt-select">
          <option value="2" ${s.stickMode === 2 ? "selected" : ""}>Mode 2 (throttle left)</option>
          <option value="1" ${s.stickMode === 1 ? "selected" : ""}>Mode 1 (throttle right)</option>
        </select>
      </label>
      <label class="opt"><input type="checkbox" id="inpInvertY" ${s.invertY ? "checked" : ""} /> Invert gamepad pitch (Y)</label>
      <button type="button" id="inpResetDefaults" class="opt-reset">Reset to defaults (${mouseDefMilli} mrad/px)</button>
    `;

    const apply = (patch) => {
      setInputSettings(patch);
      this.drone?.reloadInputSettings?.();
    };

    const mouseSens = el.querySelector("#inpMouseSens");
    const mouseSensOut = el.querySelector("#inpMouseSensOut");
    mouseSens.addEventListener("input", () => {
      const milli = parseFloat(mouseSens.value);
      mouseSensOut.textContent = `${milli.toFixed(2)} mrad/px`;
      apply({ mouseSensitivity: milli / 1000 });
    });

    const dz = el.querySelector("#inpDeadzone");
    const dzOut = el.querySelector("#inpDeadzoneOut");
    dz.addEventListener("input", () => {
      const v = parseFloat(dz.value);
      dzOut.textContent = `${(v * 100).toFixed(0)}%`;
      apply({ deadzone: v });
    });

    const expo = el.querySelector("#inpExpo");
    const expoOut = el.querySelector("#inpExpoOut");
    expo.addEventListener("input", () => {
      const v = parseFloat(expo.value);
      expoOut.textContent = `${(v * 100).toFixed(0)}%`;
      apply({ expo: v });
    });

    const stick = el.querySelector("#inpStickMode");
    stick.addEventListener("change", () => {
      apply({ stickMode: parseInt(stick.value, 10) === 1 ? 1 : 2 });
    });

    const invY = el.querySelector("#inpInvertY");
    invY.addEventListener("change", () => {
      apply({ invertY: invY.checked });
    });

    el.querySelector("#inpResetDefaults").addEventListener("click", () => {
      setInputSettings({ ...DEFAULT_INPUT_SETTINGS });
      this.drone?.reloadInputSettings?.();
      // Re-render so the controls reflect the reset.
      this._buildInputOptions();
    });

    // Collapsible header wiring (matches drone-rules pattern).
    const toggle = document.getElementById("inputOptionsToggle");
    if (toggle && !toggle._bound) {
      toggle.addEventListener("click", () => {
        const collapsed = el.classList.toggle("collapsed");
        toggle.classList.toggle("expanded", !collapsed);
      });
      toggle._bound = true;
    }
  }

  _bind() {
    this.panelToggle.addEventListener("click", () => {
      this.panel.classList.toggle("collapsed");
    });
    this.controlsToggle.addEventListener("click", () => {
      this.controlsHint.classList.toggle("collapsed");
    });
    this.resetBtn.addEventListener("click", () => {
      if (this._tourRunning) this.tourGuide?.stop({ silent: true });
      this._flyToTargetId = null;
      this.onReset();
      this._refreshAirspaceList();
    });
    this.undoBtn?.addEventListener("click", () => this.onUndo?.());
    this.redoBtn?.addEventListener("click", () => this.onRedo?.());
    this.airspaceFilter?.addEventListener("input", () => {
      this._listFilter = this.airspaceFilter.value.trim().toLowerCase();
      this._refreshAirspaceList();
    });

    // Telemetry-pane toggles
    this.toggleAltBtn?.addEventListener("click", () => this.toggleAltTape());
    this.toggleAttitudeBtn?.addEventListener("click", () => this.toggleAttitude());
    this.togglePauseBtn?.addEventListener("click", () => this._togglePauseFromButton());
    this.toggleStrictCaatBtn?.addEventListener("click", () => this._toggleStrictCaat());
    this._syncStrictCaatButton();   // reflect persisted state on load

    // Global keyboard: U units / M map-primary / + - zoom map
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      // Ignore when typing into the filter input (or any text-like field)
      const tag = (e.target?.tagName || "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const k = e.key.toLowerCase();
      if (k === "u") {
        this.toggleUnits();
        e.preventDefault();
      } else if (k === "m") {
        this.toggleMapPrimary();
        e.preventDefault();
      } else if (k === "+" || k === "=") {
        this.zoomRadar(1 / 1.25);   // smaller scale → tighter view (zoom in)
        e.preventDefault();
      } else if (k === "-" || k === "_") {
        this.zoomRadar(1.25);
        e.preventDefault();
      } else if (k === "j") {
        this.toggleAltTape();
        e.preventDefault();
      } else if (k === "h") {
        this.toggleAttitude();
        e.preventDefault();
      }
      // 'P' is handled inside Drone — it owns `paused`. We just listen via
      // drone.onPauseChange to keep the button label/active state in sync.
      // 1..5 → preset switch is also owned by Drone; we just resync speed
      // buttons via drone.onPresetKeySwitch.
    });

    if (this.drone) {
      const prev = this.drone.onPauseChange;
      this.drone.onPauseChange = (on) => {
        prev?.(on);
        this._reflectPauseUI(on);
      };
      const prevPK = this.drone.onPresetKeySwitch;
      this.drone.onPresetKeySwitch = (id) => {
        prevPK?.(id);
        this.syncSpeedButtons();
        this._hudCache.speedLine = null;
        this._updateModeChip();
      };
      const prevFM = this.drone.onFlightModeChange;
      this.drone.onFlightModeChange = (mode) => {
        prevFM?.(mode);
        this._updateModeChip();
      };
      this._updateModeChip();
    }
  }

  _updateModeChip() {
    if (!this.modeChip) return;
    const mode = this.drone?.flightMode ?? FlightMode.HOVERCRAFT;
    const easy = EasyMode.enabled;
    let label;
    switch (mode) {
      case FlightMode.HOVERCRAFT: label = easy ? "[H] HOVERCRAFT · EASY MODE" : "[H] HOVERCRAFT"; break;
      case FlightMode.AIRPLANE:   label = "[A] AIRPLANE"; break;
      case FlightMode.DRONE:      label = "[D] DRONE"; break;
      case FlightMode.UFO:        label = "[U] UFO"; break;
      default:                    label = "[?] " + String(mode).toUpperCase();
    }
    if (this._hudCache.modeChip !== label) {
      this._hudCache.modeChip = label;
      this.modeChip.textContent = label;
    }
    this.modeChip.classList.toggle("easy", easy);
  }

  _reflectPauseUI(on) {
    if (this.togglePauseBtn) {
      this.togglePauseBtn.textContent = on ? "▶ Resume [P]" : "Pause [P]";
      this.togglePauseBtn.classList.toggle("active", on);
    }
  }

  // ---------------- Telemetry toggles ----------------
  toggleAltTape() {
    this.altTapeVisible = !this.altTapeVisible;
    this.altTape?.classList.toggle("hidden", !this.altTapeVisible);
    this.toggleAltBtn?.classList.toggle("active", this.altTapeVisible);
  }

  toggleAttitude() {
    this.attitudeVisible = !this.attitudeVisible;
    this.attitudeCanvas?.classList.toggle("visible", this.attitudeVisible);
    this.toggleAttitudeBtn?.classList.toggle("active", this.attitudeVisible);
  }

  _togglePauseFromButton() {
    if (!this.drone) return;
    this.drone.paused = !this.drone.paused;
    this.drone.onPauseChange?.(this.drone.paused);
  }

  // Betterment-2 P1.T4: Strict-CAAT policy toggle. Flips enforcement on/off
  // (drone clamp + no-fly snapback). Warnings are unaffected — they always
  // show. State persists via simState → localStorage.
  _toggleStrictCaat() {
    simState.setStrictCaat(!simState.isStrictCaat());
    this._syncStrictCaatButton();
  }

  _syncStrictCaatButton() {
    const on = simState.isStrictCaat();
    if (!this.toggleStrictCaatBtn) return;
    this.toggleStrictCaatBtn.textContent = on ? "CAAT: ON" : "CAAT: OFF";
    this.toggleStrictCaatBtn.classList.toggle("on", on);
  }

  // Betterment-2 P2.T4: render the alert queue → one banner + chips.
  _renderAlerts({ active, chips }) {
    if (this.alertBanner) {
      if (active) {
        this.alertBanner.textContent = active.message;
        this.alertBanner.className = `tier-${active.tier.cls}`;
        this.alertBanner.hidden = false;
      } else {
        this.alertBanner.hidden = true;
      }
    }
    if (this.alertChips) {
      if (chips.length) {
        this.alertChips.innerHTML = chips
          .map((c) => `<span class="alert-chip tier-${c.tier.cls}">${c.message}</span>`)
          .join("");
        this.alertChips.hidden = false;
      } else {
        this.alertChips.hidden = true;
        this.alertChips.innerHTML = "";
      }
    }
  }

  // ---------------- Unit system ----------------

  toggleUnits() {
    this.unitSystem = this.unitSystem === "metric" ? "aero" : "metric";
    this._hudCache = {};            // force HUD repaint
    this._identifyPanelKey = "";    // force identify-panel repaint
    this._updateRadarLabel();
  }

  /** Altitude string, single line, units depend on this.unitSystem. */
  fmtAlt(metres) {
    const ft = metres * M_TO_FT;
    if (this.unitSystem === "aero") return `${ft.toFixed(0)} ft AMSL`;
    return `${metres.toFixed(0)} m  /  ${ft.toFixed(0)} ft AMSL`;
  }

  /** Speed string for the HUD speed row. */
  fmtSpeed(mps, presetLabel, presetKmh) {
    const kmh = mps * 3.6;
    const kt = mps * 1.94384;
    if (this.unitSystem === "aero") {
      const presetKt = (presetKmh / 1.852).toFixed(0);
      return `${kt.toFixed(0)} kt · ${kmh.toFixed(0)} km/h · ${presetLabel} (${presetKt} kt)`;
    }
    return `${mps.toFixed(0)} m/s · ${kmh.toFixed(0)} km/h · ${presetLabel} (${presetKmh} km/h)`;
  }

  /**
   * P3.T9: wind chip string for the HUD. Direction is meteorological
   * (the direction the wind is FROM), printed as a zero-padded compass
   * bearing. Magnitude is knots in aero, m/s in metric. Below ~0.1 m/s
   * the chip reads "Calm" instead of a noisy direction.
   */
  fmtWind(dirDeg, speedMs) {
    if (!isFinite(speedMs) || speedMs < 0.1) return "Calm";
    const dir = String(Math.round(dirDeg) % 360).padStart(3, "0");
    if (this.unitSystem === "aero") {
      const kt = speedMs * 1.94384;
      return `${dir}° / ${kt.toFixed(0)} kt`;
    }
    return `${dir}° / ${speedMs.toFixed(1)} m/s`;
  }

  /**
   * P3.T7: vertical-speed string for the HUD VS row. Aero = ft/min with
   * a sign prefix (matches FAA VSI convention); metric = m/s. A dead
   * band of ±0.05 m/s reads as "level" so noise around hover doesn't
   * flip the sign every frame.
   */
  fmtVsi(mps) {
    if (!isFinite(mps)) return "—";
    if (Math.abs(mps) < 0.05) return this.unitSystem === "aero" ? "0 ft/min" : "0.0 m/s";
    const sign = mps > 0 ? "+" : "−";
    const a = Math.abs(mps);
    if (this.unitSystem === "aero") {
      const fpm = a * M_TO_FT * 60;
      return `${sign}${fpm.toFixed(0)} ft/min`;
    }
    return `${sign}${a.toFixed(1)} m/s`;
  }

  /** Lateral distance (e.g. nearest-point in identify panel). */
  fmtDist(metres) {
    if (metres == null) return "—";
    if (this.unitSystem === "aero") {
      const nm = metres / 1852;
      return nm < 1 ? `${(metres * 3.28084).toFixed(0)} ft` : `${nm.toFixed(1)} NM`;
    }
    return metres < 1000 ? `${metres.toFixed(0)} m` : `${(metres / 1000).toFixed(1)} km`;
  }

  /** Vertical extent in identify card. */
  fmtFloorCeiling(lowerFt, upperFt) {
    if (this.unitSystem === "metric") {
      const lo = (lowerFt * FT_TO_M).toFixed(0);
      const hi = (upperFt * FT_TO_M).toFixed(0);
      return `${lo}–${hi} m  (${lowerFt.toLocaleString()}–${upperFt.toLocaleString()} ft)`;
    }
    return `${lowerFt.toLocaleString()}–${upperFt.toLocaleString()} ft AMSL`;
  }

  // ---------------- Map-primary swap ----------------

  toggleMapPrimary() {
    this.mapPrimary = !this.mapPrimary;
    document.body.classList.toggle("map-primary", this.mapPrimary);
    if (this.mapPrimary) {
      this.minimap.width = window.innerWidth;
      this.minimap.height = window.innerHeight;
    } else {
      this.minimap.width = 260;
      this.minimap.height = 260;
    }
    this._updateRadarLabel();
    this.onMapPrimaryChange?.(this.mapPrimary);
  }

  // ---------------- Map zoom keys ----------------

  zoomRadar(factor) {
    this._radarScale = Math.min(8000, Math.max(400, this._radarScale * factor));
    this._updateRadarLabel();
  }

  _bindRadar() {
    const canvas = this.minimap;
    const centerCb = document.getElementById("optRadarCenter");
    if (centerCb) {
      centerCb.checked = this.radarCenterAircraft;
      centerCb.addEventListener("change", () => {
        this.radarCenterAircraft = centerCb.checked;
        if (this.radarCenterAircraft) {
          this._radarCenter.x = this.drone.position.x;
          this._radarCenter.z = this.drone.position.z;
        }
      });
    }

    canvas.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || this.radarCenterAircraft) return;
      this._radarActive = true;
      canvas.classList.add("active");
      this._radarDrag = { x: e.clientX, y: e.clientY, cx: this._radarCenter.x, cz: this._radarCenter.z };
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!this._radarDrag) return;
      const dx = e.clientX - this._radarDrag.x;
      const dy = e.clientY - this._radarDrag.y;
      this._radarCenter.x = this._radarDrag.cx - dx * this._radarScale;
      this._radarCenter.z = this._radarDrag.cz - dy * this._radarScale;
    });
    window.addEventListener("mouseup", () => {
      this._radarDrag = null;
    });
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
      this._radarScale = Math.min(8000, Math.max(400, this._radarScale * factor));
      this._updateRadarLabel();
    }, { passive: false });
    canvas.addEventListener("dblclick", () => {
      if (this.radarCenterAircraft) return;
      this._radarCenter.x = this.drone.position.x;
      this._radarCenter.z = this.drone.position.z;
    });
  }

  _updateRadarLabel() {
    if (!this.minimapLabel) return;
    const radiusM = (this.minimap.width / 2) * this._radarScale;
    const radiusLabel = this.unitSystem === "aero"
      ? `${(radiusM / 1852).toFixed(0)} NM radius`
      : `${(radiusM / 1000).toFixed(0)} km radius`;
    const follow = this.radarCenterAircraft ? " · centered on aircraft" : " · drag pan";
    const mode = this.mapPrimary ? "Map (primary) · " : "Radar · ";
    this.minimapLabel.textContent = `${mode}${radiusLabel} · scroll/+ - zoom${follow}`;
  }

  setIdentifyActive(on) {
    if (this.drone.cameraMode === "down") return;
    this.crosshairs?.classList.toggle("visible", on);
    if (!on) this.updateIdentifyPanel([]);
  }

  updateIdentifyPanel(entries) {
    const panel = this.identifyPanel;
    if (!panel) return;
    if (!entries?.length) {
      panel.classList.remove("visible");
      panel.innerHTML = "";
      this._identifyPanelKey = "";
      return;
    }
    // Entries arrive pre-sorted by nearest first (see airspace.identifyInfoForIds).
    // Include unit-system + distance bucket in the cache key so a unit toggle or
    // a meaningful distance change repaints, but per-frame jitter doesn't.
    const key = entries
      .map((e) => `${e.id}:${Math.round((e.distanceM ?? -1) / 50)}`)
      .join("|") + `|${this.unitSystem}`;
    if (key === this._identifyPanelKey) return;
    this._identifyPanelKey = key;
    panel.innerHTML = entries.map((e) => {
      const cls = `cat-${e.categoryKey.replace(/\s/g, "")}`;
      const distLabel = e.distanceM == null ? ""
        : e.distanceM < 1 ? "INSIDE"
        : this.fmtDist(e.distanceM);
      const distRow = e.distanceM == null ? "" : `
          <div class="ic-row"><span class="ic-label">Nearest</span><span class="ic-dist">${distLabel}</span></div>`;
      return `
        <div class="identify-card ${cls}">
          <div class="ic-title">${e.name}<span class="ic-cat">${e.categoryKey}</span></div>${distRow}
          <div class="ic-row"><span class="ic-label">Radius</span>${e.radiusLabel}</div>
          <div class="ic-row"><span class="ic-label">Base / Ceiling</span>${this.fmtFloorCeiling(e.lowerFt, e.upperFt)}</div>
        </div>`;
    }).join("");
    panel.classList.add("visible");
  }

  _smoothCompassHeading(targetDeg, dt) {
    if (!this._compassHeadingReady) {
      this._compassDisplayHeading = targetDeg;
      this._compassHeadingReady = true;
      return this._compassDisplayHeading;
    }
    let delta = targetDeg - this._compassDisplayHeading;
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;
    const alpha = 1 - Math.exp(-dt / COMPASS_TAU);
    this._compassDisplayHeading += delta * alpha;
    this._compassDisplayHeading = ((this._compassDisplayHeading % 360) + 360) % 360;
    return this._compassDisplayHeading;
  }

  setCameraMode(mode) {
    const showCross = mode === "down" || this.drone.identifyMode;
    this.crosshairs?.classList.toggle("visible", showCross);
    this.crosshairInfo?.classList.toggle("visible", mode === "down");
    if (this.viewModeBadge) {
      const hints = {
        down: "Down view · press ↓ again for front view",
        left: "Left view · press ← again for front view",
        right: "Right view · press → again for front view",
      };
      if (mode && hints[mode]) {
        this.viewModeBadge.textContent = hints[mode];
        this.viewModeBadge.classList.add("visible");
      } else {
        this.viewModeBadge.classList.remove("visible");
      }
    }
  }

  _drawHeadingCompass(headingDeg) {
    const canvas = this.hdgCompass;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const lubberBase = h - 2;
    const lubberApex = h - 10;
    const baseline = h - 12;
    const tapeTop = 4;
    const ppd = 1.65;
    const halfSpan = 54;
    const hdg = ((headingDeg % 360) + 360) % 360;
    const cardinals = { 0: "N", 90: "E", 180: "S", 270: "W" };

    const headingKey = `${w}x${h}`;
    if (!this._gradHeadingHousing || this._gradHeadingKey !== headingKey) {
      this._gradHeadingHousing = ctx.createLinearGradient(0, 0, 0, h);
      this._gradHeadingHousing.addColorStop(0, "rgba(12, 18, 28, 0.95)");
      this._gradHeadingHousing.addColorStop(1, "rgba(6, 10, 18, 0.98)");

      this._gradHeadingTape = ctx.createLinearGradient(0, tapeTop, 0, baseline);
      this._gradHeadingTape.addColorStop(0, "rgba(20, 32, 48, 0.9)");
      this._gradHeadingTape.addColorStop(1, "rgba(8, 14, 24, 0.95)");

      this._gradHeadingVignette = ctx.createLinearGradient(0, 0, w, 0);
      this._gradHeadingVignette.addColorStop(0, "rgba(0,0,0,0.55)");
      this._gradHeadingVignette.addColorStop(0.12, "rgba(0,0,0,0)");
      this._gradHeadingVignette.addColorStop(0.88, "rgba(0,0,0,0)");
      this._gradHeadingVignette.addColorStop(1, "rgba(0,0,0,0.55)");

      this._gradHeadingKey = headingKey;
    }
    ctx.fillStyle = this._gradHeadingHousing;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(102, 255, 204, 0.22)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

    ctx.save();
    ctx.beginPath();
    ctx.rect(4, tapeTop, w - 8, baseline - tapeTop);
    ctx.clip();

    ctx.fillStyle = this._gradHeadingTape;
    ctx.fillRect(4, tapeTop, w - 8, baseline - tapeTop);

    ctx.fillStyle = this._gradHeadingVignette;
    ctx.fillRect(4, tapeTop, w - 8, baseline - tapeTop);

    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(4, baseline);
    ctx.lineTo(w - 4, baseline);
    ctx.stroke();

    for (let offset = -halfSpan; offset <= halfSpan; offset += 5) {
      const x = cx + offset * ppd;
      if (x < 2 || x > w - 2) continue;

      const bearing = ((hdg + offset) % 360 + 360) % 360;
      const bearingSnap = Math.round(bearing / 5) * 5 % 360;
      const isCardinal = bearingSnap % 90 === 0;
      const isMajor = bearingSnap % 30 === 0;
      const tickH = isCardinal ? 10 : isMajor ? 8 : 5;
      const edgeFade = 1 - Math.min(1, Math.abs(offset) / halfSpan);
      const alpha = (isCardinal ? 0.95 : isMajor ? 0.55 : 0.32) * (0.35 + 0.65 * edgeFade);

      ctx.strokeStyle = isCardinal
        ? `rgba(102, 255, 204, ${alpha})`
        : `rgba(255, 255, 255, ${alpha})`;
      ctx.lineWidth = isCardinal ? 1.6 : isMajor ? 1 : 0.7;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, baseline - tickH);
      ctx.lineTo(x + 0.5, baseline);
      ctx.stroke();

      if (isCardinal && cardinals[bearingSnap]) {
        ctx.fillStyle = `rgba(102, 255, 204, ${0.88 + 0.12 * edgeFade})`;
        ctx.font = "bold 15px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(cardinals[bearingSnap], x, tapeTop + 10);
      } else if (isMajor && !isCardinal) {
        ctx.fillStyle = `rgba(138, 150, 167, ${0.45 + 0.45 * edgeFade})`;
        ctx.font = "8px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(String(bearingSnap), x, baseline - tickH - 1);
      }
    }

    ctx.restore();

    ctx.shadowColor = "rgba(102, 255, 204, 0.65)";
    ctx.shadowBlur = 6;
    ctx.fillStyle = "#66ffcc";
    ctx.beginPath();
    ctx.moveTo(cx, lubberApex);
    ctx.lineTo(cx - 5, lubberBase);
    ctx.lineTo(cx + 5, lubberBase);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // ---------------- Altitude tape ----------------
  /**
   * Vertical altitude reference graph next to the telemetry HUD.
   * Auto-zooms around the current altitude (so a 50 m drone reads 0–200 m,
   * a 5 000 m airliner reads 0–20 000 m, etc.). Overlays:
   *   - Red line at 90 m AGL — Thailand drone limit (CAAT recreational).
   *   - Major ticks every 1 000 m (above 500 m) or 100 m (below 500 m).
   *   - Minor ticks every 100 m (above) or 20 m (below).
   *   - Translucent bands + icons for typical operating altitudes per Thai
   *     aviation: drones, helicopters, GA, jet cruise, airliner cruise.
   */
  _drawAltTape(altM, groundM = 0) {
    const ctx = this.altTapeCtx;
    if (!ctx) return;
    const canvas = this.altTape;
    if (!this.altTapeVisible) return;
    // Sync the canvas bitmap to its current CSS box height so it stretches
    // with the HUD. (Width is fixed in CSS to 88 px.)
    const cssW = canvas.clientWidth || 88;
    const cssH = canvas.clientHeight || 360;
    if (canvas.width !== cssW)  canvas.width  = cssW;
    if (canvas.height !== cssH) canvas.height = cssH;
    const W = canvas.width, H = canvas.height;

    // ---- Auto-zoom: pick a top-of-scale that nicely brackets `altM` ----
    // Always include the 90 m drone limit so the red line is visible even
    // when sitting on the deck. Step through human-friendly tops.
    const niceTops = [
      300, 600, 1000, 2000, 5000, 10_000, 20_000, 30_000, 45_000,
    ]; // metres
    const want = Math.max(150, altM * 1.6, 200);
    let topM = niceTops.find((t) => t >= want) ?? niceTops[niceTops.length - 1];
    const botM = 0;
    const range = topM - botM;
    const m2y = (m) => H - 14 - ((m - botM) / range) * (H - 34);
    // (14 px reserved top + bottom for header/footer)

    // ---- Background ----
    ctx.clearRect(0, 0, W, H);
    const altTapeKey = `${W}x${H}`;
    if (!this._gradAltTape || this._gradAltTapeKey !== altTapeKey) {
      this._gradAltTape = ctx.createLinearGradient(0, 0, 0, H);
      this._gradAltTape.addColorStop(0, "rgba(20, 40, 70, 0.55)");      // higher = darker blue
      this._gradAltTape.addColorStop(1, "rgba(34, 80, 50, 0.40)");      // ground = greenish
      this._gradAltTapeKey = altTapeKey;
    }
    ctx.fillStyle = this._gradAltTape;
    ctx.fillRect(0, 0, W, H);

    // ---- Reference bands (Thailand-aviation typical operating heights) ----
    const aero = this.unitSystem === "aero";
    const bands = [
      // {fromFt, toFt, color, label, icon}
      { fromFt: 0,      toFt: 295,    color: "rgba(102,255,204,0.16)", label: "Drone",        icon: "🚁" },
      { fromFt: 500,    toFt: 2000,   color: "rgba(255,184,74,0.14)",  label: "Heli ops",     icon: "🚁" },
      { fromFt: 1000,   toFt: 10000,  color: "rgba(102,179,255,0.10)", label: "GA / VFR",     icon: "✈" },
      { fromFt: 18000,  toFt: 28000,  color: "rgba(160,80,255,0.10)",  label: "Jet climb",    icon: "✈" },
      { fromFt: 30000,  toFt: 42000,  color: "rgba(255,80,140,0.10)",  label: "Airline cr.",  icon: "🛩" },
    ];
    const FT_TO_M_ = 0.3048;
    for (const b of bands) {
      const lo = b.fromFt * FT_TO_M_;
      const hi = b.toFt * FT_TO_M_;
      if (hi < botM || lo > topM) continue;
      const y1 = m2y(Math.min(hi, topM));
      const y2 = m2y(Math.max(lo, botM));
      ctx.fillStyle = b.color;
      ctx.fillRect(0, y1, W, y2 - y1);
    }

    // ---- Ticks ----
    // Major step picked so we get ~5–8 majors visible.
    const targetMajor = range / 6;
    const majorChoices = [50, 100, 200, 500, 1000, 2000, 5000, 10_000];
    const majorStep = majorChoices.find((s) => s >= targetMajor) ?? majorChoices[majorChoices.length - 1];
    const minorStep = majorStep / 5;
    ctx.font = "9px ui-monospace, monospace";
    ctx.textBaseline = "middle";
    for (let m = 0; m <= topM + 0.5; m += minorStep) {
      const y = m2y(m);
      const isMajor = Math.abs(m % majorStep) < 1e-3;
      ctx.strokeStyle = isMajor ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.18)";
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(isMajor ? 14 : 6, y);
      ctx.stroke();
      if (isMajor) {
        const label = aero
          ? `${Math.round((m / FT_TO_M_) / 100) * 100}ft`
          : (m >= 1000 ? `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 1)}km` : `${m.toFixed(0)}m`);
        ctx.fillStyle = "rgba(255,255,255,0.78)";
        ctx.fillText(label, 16, y);
      }
    }

    // ---- Reference band labels (only when the band actually has room) ----
    ctx.font = "8px ui-monospace, monospace";
    for (const b of bands) {
      const lo = b.fromFt * FT_TO_M_;
      const hi = b.toFt * FT_TO_M_;
      if (hi < botM || lo > topM) continue;
      const yMid = m2y((Math.min(hi, topM) + Math.max(lo, botM)) / 2);
      const y1 = m2y(Math.min(hi, topM));
      const y2 = m2y(Math.max(lo, botM));
      if (Math.abs(y2 - y1) < 16) continue;            // band too thin to label
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.textAlign = "right";
      ctx.fillText(`${b.icon} ${b.label}`, W - 4, yMid);
      ctx.textAlign = "start";
    }

    // ---- Red drone-limit line (90 m AGL = 295 ft) ----
    // P4.T4: the line is AGL — anchored to the SRTM-baked terrain under
    // the drone. Over flat ground (groundM ≈ 0, e.g. Bangkok delta) this
    // collapses to 90 m AMSL, matching the pre-T4 behaviour. Over Doi
    // Inthanon (groundM ≈ 2540 m) the line lifts to ~2630 m AMSL — the
    // pedagogically correct "stay within 90 m of the surface" cue.
    const yLimit = m2y(groundM + 90);
    if (yLimit > 16 && yLimit < H - 16) {
      ctx.strokeStyle = "rgba(255, 64, 64, 0.95)";
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, yLimit);
      ctx.lineTo(W, yLimit);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
      ctx.fillStyle = "rgba(255, 64, 64, 0.95)";
      ctx.font = "bold 9px ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.fillText("90 m AGL", 2, yLimit - 5);
    }

    // P4.T4: faint brown ground reference line, only when the terrain
    // grid puts ground above sea level. Anchors the AGL band visually so
    // users can read both the absolute altitude and the AGL margin.
    if (groundM > 5) {
      const yGround = m2y(groundM);
      if (yGround > 16 && yGround < H - 6) {
        ctx.strokeStyle = "rgba(160, 110, 60, 0.85)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, yGround);
        ctx.lineTo(W, yGround);
        ctx.stroke();
        ctx.fillStyle = "rgba(200, 150, 90, 0.95)";
        ctx.font = "8px ui-monospace, monospace";
        ctx.textAlign = "left";
        ctx.fillText(`GND ${groundM.toFixed(0)}m`, 2, yGround + 9);
      }
    }

    // ---- Aircraft marker (always clamped onto the visible scale) ----
    const yAc = Math.max(8, Math.min(H - 8, m2y(altM)));
    ctx.fillStyle = "rgba(102,255,204,0.95)";
    ctx.beginPath();
    ctx.moveTo(W - 4, yAc);
    ctx.lineTo(W - 14, yAc - 6);
    ctx.lineTo(W - 14, yAc + 6);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Current altitude readout, top-right corner
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = "bold 10px ui-monospace, monospace";
    ctx.textAlign = "right";
    const cur = aero
      ? `${(altM * 3.28084).toFixed(0)} ft`
      : (altM >= 1000 ? `${(altM / 1000).toFixed(1)} km` : `${altM.toFixed(0)} m`);
    ctx.fillText(cur, W - 4, 10);

    // Scale-top label, bottom-left
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.font = "8px ui-monospace, monospace";
    ctx.textAlign = "left";
    const topLabel = aero
      ? `Top ${(topM / FT_TO_M_ / 1000).toFixed(topM / FT_TO_M_ >= 10000 ? 0 : 1)}k ft`
      : (topM >= 1000 ? `Top ${(topM / 1000).toFixed(0)} km` : `Top ${topM.toFixed(0)} m`);
    ctx.fillText(topLabel, 4, H - 4);
  }

  // ---------------- Attitude indicator (artificial horizon) ----------------
  /**
   * Transparent artificial horizon: pitch ladder + bank scale + aircraft
   * symbol overlay, with **no sky / earth fills** so the 3D scene shows
   * through. The horizon line, ticks, and aircraft bars are drawn in white /
   * yellow with thin contrast strokes so they remain visible against any
   * background.
   */
  _drawAttitudeIndicator(pitchRad, rollRad) {
    if (!this.attitudeVisible) return;
    const ctx = this.attitudeCtx;
    if (!ctx) return;
    const canvas = this.attitudeCanvas;
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H / 2;
    const r = Math.min(W, H) / 2 - 4;

    ctx.clearRect(0, 0, W, H);

    // Circular clip — instrument bezel (still used so the ladder doesn't
    // bleed past the bezel ring, but no opaque background is drawn).
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    // P6.T7: faint 10% black wash inside the bezel. The indicator is
    // otherwise transparent (sky/earth fills were removed) so the white
    // ladder + horizon can wash out against a bright daytime sky; this
    // gives just enough contrast without reintroducing an opaque face.
    ctx.fillStyle = "rgba(0, 0, 0, 0.10)";
    ctx.fillRect(0, 0, W, H);

    // Rotate by bank, slide by pitch (10° = `pxPerDeg` px).
    const pxPerDeg = r / 30;     // ±30° of pitch visible inside the bezel
    const pitchDeg = (pitchRad * 180) / Math.PI;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-rollRad);
    ctx.translate(0, pitchDeg * pxPerDeg);

    // Horizon line — bright cyan-white double stroke for contrast on any bg.
    ctx.strokeStyle = "rgba(0, 0, 0, 0.65)";
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(-r * 3, 0);
    ctx.lineTo(r * 3, 0);
    ctx.stroke();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-r * 3, 0);
    ctx.lineTo(r * 3, 0);
    ctx.stroke();

    // Pitch ladder (every 5° with 10° major). Each tick is drawn twice — once
    // in dark shadow, once in white — so it stays legible against the live
    // 3D scene underneath.
    ctx.font = "bold 10px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let p = -90; p <= 90; p += 5) {
      if (p === 0) continue;
      const y = -p * pxPerDeg;
      if (Math.abs(y) > r * 1.4) continue;
      const major = (p % 10 === 0);
      const w = major ? 36 : 18;
      // shadow
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-w, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      // primary
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-w, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillText(`${Math.abs(p)}`, -w - 12 + 1, y + 1);
        ctx.fillText(`${Math.abs(p)}`,  w + 12 + 1, y + 1);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(`${Math.abs(p)}`, -w - 12, y);
        ctx.fillText(`${Math.abs(p)}`,  w + 12, y);
      }
    }
    ctx.restore();

    // Bank-angle scale on the bezel (top arc, 0/±10/±20/±30/±45/±60)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.fillStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.font = "9px ui-monospace, monospace";
    const banks = [
      [0, 6, true], [10, 4, false], [20, 4, false],
      [30, 7, true], [45, 5, false], [60, 7, true],
    ];
    for (const [deg, len, label] of banks) {
      for (const s of [-1, 1]) {
        const a = (s * deg * Math.PI) / 180 - Math.PI / 2;
        const x1 = Math.cos(a) * (r - 2);
        const y1 = Math.sin(a) * (r - 2);
        const x2 = Math.cos(a) * (r - 2 - len);
        const y2 = Math.sin(a) * (r - 2 - len);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        if (label && deg !== 0) {
          const xl = Math.cos(a) * (r - 16);
          const yl = Math.sin(a) * (r - 16);
          ctx.fillText(`${deg}`, xl, yl);
        }
        if (deg === 0) break;
      }
    }

    // Yellow bank triangle pointer (fixed to bezel — currently at 0 since we
    // already rotated the inside).
    ctx.fillStyle = "#ffd24a";
    ctx.beginPath();
    ctx.moveTo(0, -r + 2);
    ctx.lineTo(-6, -r + 12);
    ctx.lineTo(6, -r + 12);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.restore();     // end circular clip

    // Aircraft symbol (fixed yellow bars + center dot)
    ctx.strokeStyle = "#ffd24a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 40, cy);
    ctx.lineTo(cx - 10, cy);
    ctx.moveTo(cx + 10, cy);
    ctx.lineTo(cx + 40, cy);
    ctx.stroke();
    // Wings tips drop
    ctx.beginPath();
    ctx.moveTo(cx - 40, cy);
    ctx.lineTo(cx - 40, cy + 4);
    ctx.moveTo(cx + 40, cy);
    ctx.lineTo(cx + 40, cy + 4);
    ctx.stroke();
    // Centre dot
    ctx.fillStyle = "#ffd24a";
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();

    // Bezel ring
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  saveFlightBeforeFlyTo() { /* removed — flight history handles navigation */ }

  markFlyToTarget(id) {
    this._flyToTargetId = id;
    this._refreshAirspaceList();
  }

  clearFlyToTarget() {
    this._flyToTargetId = null;
    this._refreshAirspaceList();
  }

  _refreshAirspaceList() {
    const q = this._listFilter;
    const items = this.layer.airspaces.filter((a) => {
      if (isMilitaryAirspace(a) && !this.layer.showMilitary) return false;
      if (!q) return true;
      const hay = `${a.id} ${a.shortName} ${a.name} ${a.category} ${a.description}`.toLowerCase();
      return hay.includes(q);
    });

    if (items.length === 0) {
      this.airspaceList.innerHTML = `<li class="empty-list">No airspaces match filter.</li>`;
      return;
    }

    // 8-way compass-rose buttons per card: clicking N puts the aircraft north
    // of the airspace looking south, etc. Default (clicking the card body)
    // keeps the historical "from the south" view.
    //
    // 3×3 grid layout — the centre slot is intentionally empty so the
    // bearings sit at their geographic positions:
    //   NW | N  | NE
    //   W  | ·  | E
    //   SW | S  | SE
    const ROSE_CELLS = [
      { dir: "NW", glyph: "↖" }, { dir: "N",  glyph: "↑" }, { dir: "NE", glyph: "↗" },
      { dir: "W",  glyph: "←" }, { dir: null,             }, { dir: "E",  glyph: "→" },
      { dir: "SW", glyph: "↙" }, { dir: "S",  glyph: "↓" }, { dir: "SE", glyph: "↘" },
    ];
    const compassRose = (id) => `
      <div class="compass-rose" role="group" aria-label="View this airspace from a compass direction">
        ${ROSE_CELLS.map((c) =>
          c.dir
            ? `<button class="dir-btn" data-id="${id}" data-dir="${c.dir}" title="View from ${c.dir}">${c.glyph}</button>`
            : `<span class="dir-empty" aria-hidden="true"></span>`
        ).join("")}
      </div>`;

    this.airspaceList.innerHTML = items.map((a) => {
      const active = a.id === this._flyToTargetId;
      const tag = a.approximate
        ? '<span class="badge approx" title="Boundaries approximated">approx</span>'
        : '<span class="badge auth" title="Sourced from AIP Thailand">AIP</span>';
      const v = `${a.lowerFt.toLocaleString()}–${a.upperFt.toLocaleString()} ft`;
      const cls = `teleport${active ? " active-target" : ""}`;
      return `
        <li>
          <button data-id="${a.id}" class="${cls}">
            <div class="row1">${a.shortName} ${tag}</div>
            <div class="row2"><span class="cat cat-${a.category.replace(/\s/g, "")}">${a.category}</span> ${v}</div>
            <div class="row3">${a.description}</div>
          </button>
          ${compassRose(a.id)}
        </li>`;
    }).join("");

    this.airspaceList.querySelectorAll("button.teleport").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this._requestFlyTo(btn.dataset.id);   // default direction = S (historic)
      });
    });
    this.airspaceList.querySelectorAll("button.dir-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this._requestFlyTo(btn.dataset.id, { direction: btn.dataset.dir });
      });
    });
  }

  // Betterment-2 P1.T2: single user-click entry point for catalog fly-to.
  // Never silently no-ops — a refused click always surfaces a toast naming
  // the reason. See doc/flyto_state_machine.md §5 for the contract.
  _requestFlyTo(id, opts = {}) {
    if (this._tourRunning) {
      this._showFlyToToast("Tour in progress — end the tour to fly to a volume.");
      return;
    }
    const result = this.onFlyTo?.(id, opts);
    if (result && result.ok === false) {
      this._showFlyToToast(result.reason ?? "Could not fly to that volume.");
    }
  }

  _showFlyToToast(message) {
    const el = this._flyToToast;
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    el.classList.remove("fade");
    clearTimeout(this._flyToToastT);
    this._flyToToastT = setTimeout(() => {
      el.classList.add("fade");
      setTimeout(() => { el.hidden = true; }, 400);
    }, 2600);
  }

  _scheduleHintCollapse() {
    setTimeout(() => this.controlsHint.classList.add("collapsed"), 5000);
  }

  _initEasyModeIntro() {
    if (!this.easyModeIntro) return;
    const key = "kuson_easy_mode_intro_v1";
    let dismissed = false;
    try { dismissed = localStorage.getItem(key) === "1"; } catch { /* private mode */ }
    if (dismissed) return;
    const dismiss = () => {
      this.easyModeIntro.classList.remove("visible");
      try { localStorage.setItem(key, "1"); } catch { /* private mode */ }
    };
    this.easyModeIntroClose?.addEventListener("click", dismiss);
    this.easyModeIntro.classList.add("visible");
    setTimeout(dismiss, 15000);  // auto-dismiss after 15s if user ignores
  }

  _buildPanel() {
    const legend = document.getElementById("legend");
    const categories = ["CTR", "TMA", "Class D", "Prohibited", "Restricted", "Danger"];
    const colorFor = {
      CTR: "#ff3344", TMA: "#ff9933", "Class D": "#ffe14a",
      Prohibited: "#ff0000", Restricted: "#a050ff", Danger: "#ff6a1f",
    };
    legend.innerHTML = categories.map(cat => `
      <div class="legend-row">
        <span class="swatch" style="background:${colorFor[cat]}"></span>
        <div>
          <div class="legend-label">${cat}</div>
          <div class="legend-desc">${CAT_DESCR[cat]}</div>
        </div>
      </div>
    `).join("");

    document.getElementById("droneRules").innerHTML = DRONE_RULES_HTML;
    const rulesToggle = document.getElementById("droneRulesToggle");
    const rulesBody = document.getElementById("droneRules");
    if (rulesToggle && rulesBody) {
      rulesToggle.addEventListener("click", () => {
        const collapsed = rulesBody.classList.toggle("collapsed");
        rulesToggle.classList.toggle("expanded", !collapsed);
      });
    }
    this._refreshAirspaceList();
    this._updateRadarLabel();
  }

  _updateAdmin(geo) {
    const key = `${geo.lat.toFixed(3)},${geo.lon.toFixed(3)}`;
    if (key === this._lastGeoKey) return;
    this._lastGeoKey = key;

    const cached = lookupAdmin(geo.lat, geo.lon, (result) => {
      this._adminCache = result;
      this._hudCache.admin = null;
    });
    if (cached) this._adminCache = cached;
  }

  updateHUD(dt = 0.016) {
    const p = this.drone.position;
    const geo = worldToGeo(p.x, p.z);
    const altM = p.y;
    const altFt = altM * M_TO_FT;
    const headingDeg = this.drone.headingDeg();
    const compass = bearingToCompass(headingDeg);
    const hov = this.drone.hover ? " · HOVER" : "";

    this._updateAdmin(geo);

    const latlonText = formatLatLon(geo.lat, geo.lon);
    if (this._hudCache.latlon !== latlonText) {
      this._hudCache.latlon = latlonText;
      if (this._el.latlon) this._el.latlon.textContent = latlonText;
    }

    const adminText = this._adminCache?.label ?? "…";
    if (this._hudCache.admin !== adminText) {
      this._hudCache.admin = adminText;
      if (this.placeLabel) this.placeLabel.textContent = adminText;
    }

    // P4.T4: ground elevation from the SRTM-baked grid. Returns 0 until
    // loadTerrain resolves at startup, so the alt chip just shows AMSL
    // for the first few frames — graceful, no flicker.
    const groundM = terrainLoaded() ? elevationAt(geo.lat, geo.lon) : 0;
    const aglM = Math.max(0, altM - groundM);
    const altText = this.fmtAlt(altM);
    // Append AGL only when we have real ground above MSL — over the gulf
    // / Bangkok delta (groundM ≈ 0) AMSL and AGL coincide and the extra
    // chip would just be noise.
    const aglChip = groundM > 5
      ? ` · AGL ${this.unitSystem === "aero"
          ? `${(aglM * 3.28084).toFixed(0)} ft`
          : `${aglM.toFixed(0)} m`}`
      : "";
    const altLine = altText + aglChip;
    if (this._hudCache.alt !== altLine) {
      this._hudCache.alt = altLine;
      if (this._el.alt) this._el.alt.textContent = altLine;
    }

    // P3.T7: vertical speed indicator. dy/dt smoothed with EMA alpha=0.2.
    // First frame primes _lastAltM and reports 0 — avoids a spurious huge
    // VS spike from a position-uninitialised previous frame.
    if (dt > 1e-4) {
      if (this._lastAltM == null) {
        this._lastAltM = altM;
      } else {
        const inst = (altM - this._lastAltM) / dt;
        this._lastAltM = altM;
        const ALPHA = 0.2;
        this._vsiSmoothMs = ALPHA * inst + (1 - ALPHA) * this._vsiSmoothMs;
      }
    }
    const vsiText = this.fmtVsi(this._vsiSmoothMs);
    if (this._hudCache.vsi !== vsiText) {
      this._hudCache.vsi = vsiText;
      if (this._el.vsi) this._el.vsi.textContent = vsiText;
    }

    // P3.T9: wind chip. Drone.physicsStep publishes the latest sample on
    // _lastWind; in Easy Mode / UFO the sample is zeros and we print "Calm".
    const w = this.drone._lastWind ?? { dirDeg: 0, speedMs: 0 };
    const windText = this.fmtWind(w.dirDeg, w.speedMs);
    if (this._hudCache.wind !== windText) {
      this._hudCache.wind = windText;
      if (this._el.wind) this._el.wind.textContent = windText;
    }

    // P4.T1: battery chip. Color band follows BatterySystem.state, dimmed
    // when not in DRONE mode (other modes leave the cell idle at 100%).
    const bat = this.drone.battery;
    if (bat && this._el.battery) {
      const text = `${Math.round(bat.pct)}%`;
      const cls = bat.active ? `bat-${bat.state}` : "bat-idle";
      const key = `${text}|${cls}`;
      if (this._hudCache.battery !== key) {
        this._hudCache.battery = key;
        this._el.battery.textContent = text;
        this._el.battery.className = cls;
      }
    }

    // P4.T3: radio link signal chip. Five bars, color by quality:
    //   green q ≥ 0.66, yellow 0.33–0.66, red < 0.33. A dropout adds a
    //   blink animation via the .dropout class so the user sees the freeze.
    const radio = this.drone.radio;
    if (radio && this._el.signal && this._signalBars.length === 5) {
      const cls = radio.quality >= 0.66 ? "q-high"
                : radio.quality >= 0.33 ? "q-mid" : "q-low";
      const key = `${radio.bars}|${cls}|${radio.inDropout ? 1 : 0}`;
      if (this._hudCache.signal !== key) {
        this._hudCache.signal = key;
        for (let i = 0; i < 5; i++) {
          this._signalBars[i].classList.toggle("on", i < radio.bars);
        }
        const chip = this._el.signal;
        chip.classList.remove("q-high", "q-mid", "q-low");
        chip.classList.add(cls);
        chip.classList.toggle("dropout", radio.inDropout);
        if (this._el.signalText) {
          this._el.signalText.textContent = radio.inDropout
            ? "LOST"
            : `${radio.bars}/5`;
        }
      }
    }

    // P4.T6: predictive next-airspace chip. EMA the velocity so the
    // projection stays stable when sticks are wiggling, then ask the
    // layer to project forward 30 s and surface the first volume the
    // drone will enter (excluding ones it's already inside).
    if (this._predPrevPos && dt > 1e-3) {
      const ax = (p.x - this._predPrevPos.x) / dt;
      const ay = (p.y - this._predPrevPos.y) / dt;
      const az = (p.z - this._predPrevPos.z) / dt;
      const a = 0.2;            // EMA gain; ~5-frame settle
      this._predVel.x = this._predVel.x * (1 - a) + ax * a;
      this._predVel.y = this._predVel.y * (1 - a) + ay * a;
      this._predVel.z = this._predVel.z * (1 - a) + az * a;
    }
    this._predPrevPos = { x: p.x, y: p.y, z: p.z };

    const nextHit = this.layer.predictNextEntry
      ? this.layer.predictNextEntry(p, this._predVel, 30, 0.5)
      : null;
    if (this._el.nextAirspaceRow && this._el.nextAirspace) {
      if (nextHit) {
        const a = nextHit.airspace;
        const eta = Math.max(1, Math.round(nextHit.etaS));
        const text =
          `→ ${a.shortName} in ${eta}s · floor ${a.lowerFt.toLocaleString()} ` +
          `ceil ${a.upperFt.toLocaleString()}ft`;
        const key = `${a.id}|${eta}|${a.lowerFt}|${a.upperFt}`;
        if (this._predNextKey !== key) {
          this._predNextKey = key;
          this._el.nextAirspace.textContent = text;
          this._el.nextAirspace.className = `val cat-${a.category.replace(/\s/g, "")}`;
          this._el.nextAirspaceRow.hidden = false;
        }
      } else if (this._predNextKey !== null) {
        this._predNextKey = null;
        this._el.nextAirspaceRow.hidden = true;
      }
    }

    // Betterment-2 P2.T3/T4: all warnings funnel through the alert queue so
    // exactly one banner shows (highest priority), the rest become chips.
    // Replaces the betterment-1 stacked #geofenceRibbon + #rthRibbon +
    // one-shot no-fly toast (external audit P0 #1: three banners at once).

    // (1) Altitude advisor — publishes ALT_* by comparing altitude to the
    // active preset's ceilings.
    const presetId = this.drone.activePreset?.()?.id ?? null;
    if (presetId) {
      this.altitudeAdvisor.tick(presetId, altM, Math.max(0, altM - groundM), this.unitSystem);
    }

    // (2) Geofence — its own tier (advisory/authorisation/noFly) is already
    // resolved in gf.ribbon. Map to a queue tier.
    const gf = this.drone.geofence;
    if (gf) {
      const r = gf.ribbon;
      if (r) {
        const tier = r.kind === "noFly" ? AlertTier.NO_FLY
          : r.kind === "authorisation" ? AlertTier.AUTH_CLAMP
          : AlertTier.ADVISORY;
        alerts.publish({ key: "geofence", tier, message: r.text });
      } else {
        alerts.retract("geofence");
      }
    }

    // (3) RTH — active state. Reason is read live each frame (P2.T5).
    const rth = this.drone.rth;
    if (rth && rth.active) {
      const reasonText = rth.reason === "battery" ? "low battery"
        : rth.reason === "signal" ? "signal lost"
        : "manual";
      alerts.publish({
        key: "rth",
        tier: AlertTier.RTH_ACTIVE,
        message: `RTH ENGAGED (${reasonText}) — ${rth.state}`,
      });
    } else {
      alerts.retract("rth");
    }

    // (4) Emit to the banner/chips only if the active set changed.
    alerts.flush();

    this._drawAltTape(altM, groundM);
    this._drawAttitudeIndicator(this.drone.bodyPitch ?? 0, this.drone.bodyRoll ?? 0);

    const displayHdg = this._smoothCompassHeading(headingDeg, dt);
    const hdgMoving = Math.abs(((headingDeg - displayHdg + 540) % 360) - 180) > 0.05;
    const hdgKey = `${headingDeg.toFixed(1)}${hov}`;
    if (this._hudCache.hdgKey !== hdgKey) {
      this._hudCache.hdgKey = hdgKey;
      if (this.headingDigital) {
        this.headingDigital.textContent = `${headingDeg.toFixed(0)}° ${compass}${hov}`;
      }
    }
    // P6.T6: decide redraw with a wrap-safe numeric delta, not a
    // toFixed(2) string compare. The string form makes 359.99° and 0.01°
    // look maximally different (a 359.98 "change") so the compass needle
    // stutters every frame across the 360°→0° seam; the shortest-angle
    // diff treats them as 0.02° apart.
    const lastDrawn = this._hudCache.lastCompassDrawNum;
    const drawDelta = lastDrawn == null
      ? Infinity
      : Math.abs(((displayHdg - lastDrawn + 540) % 360) - 180);
    if (hdgMoving || drawDelta > 0.01) {
      this._hudCache.lastCompassDrawNum = displayHdg;
      this._drawHeadingCompass(displayHdg);
    }

    const spdEl = this._el.speed;
    if (spdEl) {
      const spd = this.drone.currentSpeed || 0;
      const preset = this.drone.activePreset();
      const speedLine = this.fmtSpeed(spd, preset.label, preset.kmh);
      if (this._hudCache.speedLine !== speedLine) {
        this._hudCache.speedLine = speedLine;
        spdEl.textContent = speedLine;
      }
    }

    if (this.drone.cameraMode === "down" && this.crosshairInfo) {
      const nadir = worldToGeo(p.x, p.z);
      const nadirText = `Nadir · ${formatLatLon(nadir.lat, nadir.lon)}`;
      if (this._hudCache.nadir !== nadirText) {
        this._hudCache.nadir = nadirText;
        this.crosshairInfo.textContent = nadirText;
      }
    }

    const inside = this.layer.airspacesAt(p.x, p.y, p.z);
    const insideKey = inside.map((a) => a.id).sort().join("|");
    if (this._hudCache.insideKey !== insideKey) {
      this._hudCache.insideKey = insideKey;
      if (inside.length === 0) {
        this.currentInside.innerHTML = `<span class="ok">Clear — not inside any cataloged airspace.</span>`;
      } else {
        this.currentInside.innerHTML = inside.map(a => {
          const cls = `cat-${a.category.replace(/\s/g,'')}`;
          return `<span class="chip ${cls}" title="${a.description}">⚠ ${a.shortName}</span>`;
        }).join(" ");
      }
      if (this.panelTitle && !this._tourRunning) {
        if (inside.length === 0) {
          this.panelTitle.textContent = "Thai Airspace · Clear";
        } else if (inside.length === 1) {
          const a = inside[0];
          this.panelTitle.textContent = `${a.shortName} · ${a.lowerFt.toLocaleString()}–${a.upperFt.toLocaleString()} ft`;
        } else {
          this.panelTitle.textContent = inside.map((a) => a.shortName).join(" · ");
        }
      }
    }
  }

  _drawMapUnderlay(ctx, w, h, SCALE, cx, cy, wx, wz) {
    const z = 8;
    this._minimapTiles.zoom = z;
    const centerGeo = worldToGeo(wx, wz);
    const centerTx = lonToTileX(centerGeo.lon, z);
    const centerTy = latToTileY(centerGeo.lat, z);
    const tileRadius = 5;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, w / 2 - 1, 0, Math.PI * 2);
    ctx.clip();

    for (let ty = centerTy - tileRadius; ty <= centerTy + tileRadius; ty++) {
      for (let tx = centerTx - tileRadius; tx <= centerTx + tileRadius; tx++) {
        const img = this._minimapTiles.getTile(tx, ty);
        if (!img || !img.complete || !img.naturalWidth) continue;
        const lonW = tileXToLon(tx, z);
        const lonE = tileXToLon(tx + 1, z);
        const latN = tileYToLat(ty, z);
        const latS = tileYToLat(ty + 1, z);
        const nw = geoToWorld(latN, lonW);
        const se = geoToWorld(latS, lonE);
        const px = cx + (nw.x - wx) / SCALE;
        const py = cy + (nw.z - wz) / SCALE;
        const pw = (se.x - nw.x) / SCALE;
        const ph = (se.z - nw.z) / SCALE;
        ctx.drawImage(img, px, py, pw, ph);
      }
    }
    ctx.restore();
  }

  _drawFov(ctx, cx, cy, dx, dy, SCALE, wx, wz) {
    const halfFov = ((this.camera.fov * Math.PI) / 180) / 2;
    const heading = this.drone.bodyYaw;
    const reachM = 80_000;
    const len = reachM / SCALE;

    const leftA = -heading + halfFov;
    const rightA = -heading - halfFov;

    const lx = dx + len * Math.sin(leftA);
    const ly = dy - len * Math.cos(leftA);
    const rx = dx + len * Math.sin(rightA);
    const ry = dy - len * Math.cos(rightA);

    ctx.beginPath();
    ctx.moveTo(dx, dy);
    ctx.lineTo(lx, ly);
    ctx.lineTo(rx, ry);
    ctx.closePath();
    ctx.fillStyle = "rgba(102, 255, 204, 0.12)";
    ctx.fill();
    ctx.strokeStyle = "rgba(102, 255, 204, 0.55)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(dx, dy);
    ctx.lineTo(lx, ly);
    ctx.moveTo(dx, dy);
    ctx.lineTo(rx, ry);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // P5.T4: re-bake only when the polygons' appearance, position, or zoom
  // drifts — military filter flip, highlight-set change, pan > 50 km from
  // the bake center, or radar-scale change. Including scale keeps stroke
  // widths pixel-exact (they're pre-divided by the bake-time blit scale).
  _ensureMinimapBake(wx, wz) {
    const compiled = this.layer.compiled;
    if (!compiled || compiled.length === 0) return;
    const ids = [...this.layer.highlightedIds].sort();
    const sig = (this.layer.showMilitary ? "1" : "0") + "|" +
      this._radarScale.toFixed(2) + "|" + ids.join(",");
    const drifted = !this._minimapBake ||
      Math.hypot(wx - this._bakeCenter.x, wz - this._bakeCenter.z) > 50_000;
    if (this._minimapBake && sig === this._bakeSig && !drifted) return;
    this._bakeSig = sig;
    this._bakeCenter.x = wx;
    this._bakeCenter.z = wz;
    this._bakeMinimapPolygons(wx, wz);
  }

  // P6.T2: colorblind-safe category texture for the radar fills. Red and
  // purple/orange airspaces are hard to tell apart by hue alone, so the
  // two "you-may-not-just-fly-here" categories get a non-colour cue:
  // diagonal hatch on Prohibited, a dot grid on Restricted. (The 3-D walls
  // were left untextured — ExtrudeGeometry's world-scale UVs make a tiled
  // diffuse map render as fine noise; the top-down radar is where pattern
  // distinction is legible.) Patterns are cached by kind+colour+tile.
  _categoryMinimapPattern(ctx, category, cssColor, tilePx) {
    const kind = category === "Prohibited" ? "hatch"
               : category === "Restricted" ? "dots" : null;
    if (!kind) return null;
    this._patternCache ??= new Map();
    const key = `${kind}|${cssColor}|${tilePx}`;
    const cached = this._patternCache.get(key);
    if (cached) return cached;
    const t = tilePx;
    const pc = document.createElement("canvas");
    pc.width = t; pc.height = t;
    const p = pc.getContext("2d");
    p.strokeStyle = cssColor;
    p.fillStyle = cssColor;
    if (kind === "hatch") {
      p.lineWidth = Math.max(1, t / 6);
      p.beginPath();
      p.moveTo(0, t); p.lineTo(t, 0);
      p.moveTo(-t, t); p.lineTo(t, -t);
      p.moveTo(0, 2 * t); p.lineTo(2 * t, 0);
      p.stroke();
    } else {
      p.beginPath();
      p.arc(t / 2, t / 2, Math.max(1, t / 5), 0, Math.PI * 2);
      p.fill();
    }
    const pat = ctx.createPattern(pc, "repeat");
    this._patternCache.set(key, pat);
    return pat;
  }

  _bakeMinimapPolygons(bx, bz) {
    const SIZE = 2048;
    const BAKE_WORLD_M = 700_000;       // 700 km span → ~342 m/px
    const mPerPx = BAKE_WORLD_M / SIZE;
    let b = this._minimapBake;
    if (!b) {
      const canvas = document.createElement("canvas");
      canvas.width = SIZE;
      canvas.height = SIZE;
      b = this._minimapBake = { canvas, ctx: canvas.getContext("2d"), size: SIZE, mPerPx };
    }
    b.bx = bx;
    b.bz = bz;
    // Strokes are authored in minimap px but the blit scales the offscreen by
    // a = mPerPx/SCALE, so pre-divide widths by a to land at the intended
    // on-screen width. Since _ensureMinimapBake re-bakes on scale change, a
    // here always matches the blit-time a → stroke widths are pixel-exact.
    const a = mPerPx / this._radarScale;
    const sw = (px) => px / a;
    const ctx = b.ctx;
    ctx.clearRect(0, 0, SIZE, SIZE);
    const half = SIZE / 2;
    const highlighted = this.layer.highlightedIds;
    for (const c of this.layer.compiled) {
      if (!this.layer.showMilitary && c.military) continue;
      const cssColor = c.cssColor;
      const on = highlighted.has(c.airspace.id);
      ctx.strokeStyle = on ? cssColor : cssColor + "cc";
      ctx.fillStyle = on ? cssColor + "77" : cssColor + "33";
      ctx.lineWidth = sw(on ? 2.5 : 1);
      ctx.beginPath();
      for (let i = 0; i < c.ring.length; i++) {
        const p = c.ring[i];
        const px = half + (p.x - bx) / mPerPx;
        const py = half + (p.z - bz) / mPerPx;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      // P6.T2: overlay the colorblind pattern on Prohibited / Restricted.
      const pat = this._categoryMinimapPattern(
        ctx, c.airspace.category, cssColor, Math.max(6, Math.round(sw(7))));
      if (pat) { ctx.fillStyle = pat; ctx.fill(); }
      ctx.stroke();
      if (on) {
        ctx.strokeStyle = "rgba(102, 255, 204, 0.85)";
        ctx.lineWidth = sw(1.5);
        ctx.setLineDash([sw(4), sw(3)]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  drawMinimap() {
    if (this.radarCenterAircraft) {
      this._radarCenter.x = this.drone.position.x;
      this._radarCenter.z = this.drone.position.z;
    }

    const ctx = this.minimapCtx;
    const w = this.minimap.width, h = this.minimap.height;
    ctx.clearRect(0, 0, w, h);

    const SCALE = this._radarScale;
    const cx = w / 2, cy = h / 2;
    const wx = this._radarCenter.x;
    const wz = this._radarCenter.z;

    if (this.showMapUnderlay) {
      this._drawMapUnderlay(ctx, w, h, SCALE, cx, cy, wx, wz);
    } else {
      ctx.fillStyle = "rgba(20, 26, 36, 0.85)";
      ctx.fillRect(0, 0, w, h);
    }

    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = "9px ui-monospace, monospace";
    // Range rings: metric uses 50/100/200/300 km; aero uses 25/50/100/200 NM.
    const rings = this.unitSystem === "aero"
      ? [{ m: 25 * 1852, lbl: "25NM" }, { m: 50 * 1852, lbl: "50NM" },
         { m: 100 * 1852, lbl: "100NM" }, { m: 200 * 1852, lbl: "200NM" }]
      : [{ m: 50_000, lbl: "50km" }, { m: 100_000, lbl: "100km" },
         { m: 200_000, lbl: "200km" }, { m: 300_000, lbl: "300km" }];
    for (const ring of rings) {
      const rp = ring.m / SCALE;
      ctx.beginPath();
      ctx.arc(cx, cy, rp, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillText(ring.lbl, cx + rp - 30, cy - 2);
    }

    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillText("N", cx - 4, 10);
    ctx.fillText("S", cx - 4, h - 2);
    ctx.fillText("E", w - 10, cy + 4);
    ctx.fillText("W", 2, cy + 4);

    // P5.T4: blit the pre-baked polygon layer instead of re-stroking ~144
    // rings each frame. The transform maps a world point to the same pixel
    // the old loop produced: screen = a·offscreenPx + e, a = mPerPx/SCALE.
    this._ensureMinimapBake(wx, wz);
    if (this._minimapBake) {
      const b = this._minimapBake;
      const a = b.mPerPx / SCALE;
      const ex = cx + (b.bx - wx) / SCALE - (b.size / 2) * a;
      const ey = cy + (b.bz - wz) / SCALE - (b.size / 2) * a;
      ctx.save();
      ctx.translate(ex, ey);
      ctx.scale(a, a);
      ctx.drawImage(b.canvas, 0, 0);
      ctx.restore();
    }

    const p = this.drone.position;
    const dx = cx + (p.x - wx) / SCALE;
    const dy = cy + (p.z - wz) / SCALE;
    const heading = this.drone.bodyYaw;

    if (this.showFov) {
      this._drawFov(ctx, cx, cy, dx, dy, SCALE, wx, wz);
    }

    ctx.save();
    ctx.translate(dx, dy);
    ctx.rotate(-heading);
    ctx.fillStyle = "#66ffcc";
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 5);
    ctx.lineTo(0, 2);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // P3.T9: ground-track vector. In a crosswind the aircraft crabs — its
    // ground velocity (nose direction × airspeed + wind) points a few
    // degrees off the nose. Drawing both vectors here is the "aha" moment
    // the playbook spec asks for. Amber to contrast with the cyan nose.
    const lw = this.drone._lastWind;
    if (lw && lw.speedMs > 0.1) {
      let avx = 0, avz = 0;
      if (this.drone.flightMode === FlightMode.AIRPLANE) {
        const fwd = this.drone.forward();
        const v = this.drone.airspeedMs ?? 0;
        avx = fwd.x * v;
        avz = fwd.z * v;
      } else if (this.drone.flightMode === FlightMode.DRONE) {
        const vh = this.drone._quadrotor?.velocityHoriz;
        if (vh) { avx = vh.x; avz = vh.z; }
      }
      const gx = avx + lw.vec3.x;
      const gz = avz + lw.vec3.z;
      const gMag = Math.hypot(gx, gz);
      if (gMag > 0.5) {
        const ux = gx / gMag, uz = gz / gMag;
        const LEN = 22;
        const tipX = dx + ux * LEN, tipY = dy + uz * LEN;
        ctx.strokeStyle = "rgba(255, 196, 92, 0.9)";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(dx, dy);
        ctx.lineTo(tipX, tipY);
        ctx.stroke();
        // Arrow head — small filled triangle aligned with track.
        const px = -uz, pz = ux;            // perpendicular unit (rotate 90°)
        const HW = 3.5, HB = 5;
        ctx.fillStyle = "rgba(255, 196, 92, 0.95)";
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - ux * HB + px * HW, tipY - uz * HB + pz * HW);
        ctx.lineTo(tipX - ux * HB - px * HW, tipY - uz * HB - pz * HW);
        ctx.closePath();
        ctx.fill();
      }
    }

    if (this.drone.cameraMode === "down") {
      ctx.strokeStyle = "rgba(102, 255, 204, 0.9)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(dx - 12, dy);
      ctx.lineTo(dx + 12, dy);
      ctx.moveTo(dx, dy - 12);
      ctx.lineTo(dx, dy + 12);
      ctx.stroke();
    }
  }
}
