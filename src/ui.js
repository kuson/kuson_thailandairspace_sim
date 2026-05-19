// ui.js — HUD, minimap, educational panel, display options.
import {
  worldToGeo, formatLatLon, bearingToCompass, M_TO_FT, ORIGIN,
  lonToTileX, latToTileY, tileXToLon, tileYToLat, geoToWorld,
} from "./coords.js";
import { isMilitaryAirspace } from "./airspace.js";
import { SPEED_PRESETS } from "./drone.js";
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
  constructor({ drone, camera, airspaceLayer, onFlyTo, onUndo, onRedo, onReset }) {
    this.drone = drone;
    this.camera = camera;
    this.layer = airspaceLayer;
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

    // Radar pan/zoom — center in world metres, metres per pixel
    this._radarCenter = { x: 0, z: 0 };
    this._radarScale = 300_000 / (260 / 2);
    this._radarDrag = null;
    this._radarActive = false;

    this._buildPanel();
    this._buildSpeedControls();
    this._buildDisplayOptions();
    this._bindRadar();
    this._bind();
    this._scheduleHintCollapse();
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
    `;
    const military = el.querySelector("#optMilitary");
    const labels = el.querySelector("#optLabels");
    const heights = el.querySelector("#optHeights");

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
    const radiusKm = (this.minimap.width / 2) * this._radarScale / 1000;
    const follow = this.radarCenterAircraft ? " · centered on aircraft" : " · drag pan";
    this.minimapLabel.textContent = `Radar · ${radiusKm.toFixed(0)} km radius · scroll zoom${follow}`;
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
    const key = entries.map((e) => e.id).sort().join("|");
    if (key === this._identifyPanelKey) return;
    this._identifyPanelKey = key;
    panel.innerHTML = entries.map((e) => {
      const cls = `cat-${e.categoryKey.replace(/\s/g, "")}`;
      return `
        <div class="identify-card ${cls}">
          <div class="ic-title">${e.name}<span class="ic-cat">${e.categoryKey}</span></div>
          <div class="ic-row"><span class="ic-label">Radius</span>${e.radiusLabel}</div>
          <div class="ic-row"><span class="ic-label">Base / Ceiling</span>${e.lowerFt.toLocaleString()}–${e.upperFt.toLocaleString()} ft AMSL</div>
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
        </li>`;
    }).join("");

    if (items.length === 0) {
      this.airspaceList.innerHTML = `<li class="empty-list">No airspaces match filter.</li>`;
    }

    this.airspaceList.querySelectorAll("button.teleport").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.onFlyTo?.(btn.dataset.id);
      });
    });
  }

  _scheduleHintCollapse() {
    setTimeout(() => this.controlsHint.classList.add("collapsed"), 5000);
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
      this.hud.querySelector("#latlon").textContent = latlonText;
    }

    const adminText = this._adminCache?.label ?? "…";
    if (this._hudCache.admin !== adminText) {
      this._hudCache.admin = adminText;
      if (this.placeLabel) this.placeLabel.textContent = adminText;
    }

    const altText = `${altM.toFixed(0)} m  /  ${altFt.toFixed(0)} ft AMSL`;
    if (this._hudCache.alt !== altText) {
      this._hudCache.alt = altText;
      this.hud.querySelector("#alt").textContent = altText;
    }

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

    const spdEl = this.hud.querySelector("#speed");
    if (spdEl) {
      const spd = this.drone.currentSpeed || 0;
      const preset = this.drone.activePreset();
      const speedLine = `${spd.toFixed(0)} m/s · ${(spd * 3.6).toFixed(0)} km/h · ${preset.label} (${preset.kmh} km/h)`;
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
      if (this.panelTitle) {
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
    for (const r of [50_000, 100_000, 200_000, 300_000]) {
      const rp = r / SCALE;
      ctx.beginPath();
      ctx.arc(cx, cy, rp, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillText(`${r / 1000}km`, cx + rp - 26, cy - 2);
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
      const cssColor = "#" + c.color.toString(16).padStart(6, "0");
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
