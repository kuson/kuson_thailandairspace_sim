// ui.js — HUD, minimap, educational panel, display options.
import {
  worldToGeo, formatLatLon, bearingToCompass, M_TO_FT, FT_TO_M, ORIGIN,
  lonToTileX, latToTileY, tileXToLon, tileYToLat, geoToWorld,
} from "./coords.js";
import { isMilitaryAirspace } from "./airspace.js";
import { SPEED_PRESETS } from "./drone.js";
import { FlightMode, EasyMode } from "./modes.js";
import { lookupAdmin } from "./geocode.js";
import { MinimapTileCache } from "./ground.js";

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

    // Cached HUD element refs (avoid per-frame querySelector in updateHUD)
    this._el = {
      latlon: this.hud?.querySelector("#latlon") ?? null,
      alt: this.hud?.querySelector("#alt") ?? null,
      speed: this.hud?.querySelector("#speed") ?? null,
    };

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

    this.tourSkipBtn = document.getElementById("tourSkipBtn");
    this.tourEndBtn = document.getElementById("tourEndBtn");

    // Radar pan/zoom — center in world metres, metres per pixel
    this._radarCenter = { x: 0, z: 0 };
    this._radarScale = 300_000 / (260 / 2);
    this._radarDrag = null;
    this._radarActive = false;

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

    const housingGrad = ctx.createLinearGradient(0, 0, 0, h);
    housingGrad.addColorStop(0, "rgba(12, 18, 28, 0.95)");
    housingGrad.addColorStop(1, "rgba(6, 10, 18, 0.98)");
    ctx.fillStyle = housingGrad;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(102, 255, 204, 0.22)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

    ctx.save();
    ctx.beginPath();
    ctx.rect(4, tapeTop, w - 8, baseline - tapeTop);
    ctx.clip();

    const tapeGrad = ctx.createLinearGradient(0, tapeTop, 0, baseline);
    tapeGrad.addColorStop(0, "rgba(20, 32, 48, 0.9)");
    tapeGrad.addColorStop(1, "rgba(8, 14, 24, 0.95)");
    ctx.fillStyle = tapeGrad;
    ctx.fillRect(4, tapeTop, w - 8, baseline - tapeTop);

    const vignette = ctx.createLinearGradient(0, 0, w, 0);
    vignette.addColorStop(0, "rgba(0,0,0,0.55)");
    vignette.addColorStop(0.12, "rgba(0,0,0,0)");
    vignette.addColorStop(0.88, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = vignette;
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
  _drawAltTape(altM) {
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
    const grd = ctx.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, "rgba(20, 40, 70, 0.55)");      // higher = darker blue
    grd.addColorStop(1, "rgba(34, 80, 50, 0.40)");      // ground = greenish
    ctx.fillStyle = grd;
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
    const yLimit = m2y(90);
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
      ctx.fillText("90 m DRONE", 2, yLimit - 5);
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

    if (items.length === 0) {
      this.airspaceList.innerHTML = `<li class="empty-list">No airspaces match filter.</li>`;
    }

    this.airspaceList.querySelectorAll("button.teleport").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this._tourRunning) return;
        this.onFlyTo?.(btn.dataset.id);   // default direction = S (historic)
      });
    });
    this.airspaceList.querySelectorAll("button.dir-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this._tourRunning) return;
        this.onFlyTo?.(btn.dataset.id, { direction: btn.dataset.dir });
      });
    });
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

    const altText = this.fmtAlt(altM);
    if (this._hudCache.alt !== altText) {
      this._hudCache.alt = altText;
      if (this._el.alt) this._el.alt.textContent = altText;
    }

    this._drawAltTape(altM);
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
    if (hdgMoving || this._hudCache.lastCompassDraw !== displayHdg.toFixed(2)) {
      this._hudCache.lastCompassDraw = displayHdg.toFixed(2);
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

    const highlighted = this.layer.highlightedIds;
    for (const c of this.layer.compiled) {
      if (!this.layer.showMilitary && c.military) continue;
      const cssColor = c.cssColor;
      const on = highlighted.has(c.airspace.id);
      ctx.strokeStyle = on ? cssColor : cssColor + "cc";
      ctx.fillStyle = on ? cssColor + "77" : cssColor + "33";
      ctx.lineWidth = on ? 2.5 : 1;
      ctx.beginPath();
      for (let i = 0; i < c.ring.length; i++) {
        const p = c.ring[i];
        const px = cx + (p.x - wx) / SCALE;
        const py = cy + (p.z - wz) / SCALE;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (on) {
        ctx.strokeStyle = "rgba(102, 255, 204, 0.85)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
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
