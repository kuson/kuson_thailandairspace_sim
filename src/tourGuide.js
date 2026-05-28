// tourGuide.js — scripted airspace tour: takeoff, warps, narration, finale.
import { geoToWorld, ORIGIN } from "./coords.js";

function distance3(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

function flyDurationForDistance(distM, requested) {
  if (requested != null) return requested;
  return Math.min(2.8, Math.max(0.45, 0.35 + distM / 420_000));
}

export class TourGuide {
  constructor({ drone, flyTo, layer, camera, onFlyTo, onStop }) {
    this.drone = drone;
    this.flyTo = flyTo;
    this.layer = layer;
    this.camera = camera;
    this.onFlyTo = onFlyTo;
    this.onStop = onStop;

    this.data = null;
    this.running = false;
    this.variantId = null;
    this.stops = [];
    this.index = 0;
    this._dwellT = 0;
    this._phase = "idle";
    this._savedLabels = null;
    this._onPhaseDone = null;

    // Cinematic orbit during dwell — slow look-around so each stop reveals
    // the airspace from multiple angles instead of a static stare.
    this._orbit = null;             // {cx, cz, r, angle, dir, pitch}
    this._orbitOmega = (Math.PI * 2) / 90; // one revolution per 90 s
  }

  async load(url = "./data/airspaceTour.json") {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Tour data failed: ${res.status}`);
    this.data = await res.json();
  }

  get variants() {
    return this.data?.variants ?? {};
  }

  isRunning() {
    return this.running;
  }

  start(variantId) {
    const variant = this.variants[variantId];
    if (!variant?.stops?.length) return false;
    if (this.running) this.stop({ silent: true });

    this.variantId = variantId;
    this.stops = variant.stops;
    this.index = 0;
    this.running = true;
    this._phase = "run";
    this._dwellT = 0;

    const c = geoToWorld(ORIGIN.lat, ORIGIN.lon);
    this.drone.teleport(c.x, 200, c.z, 0, -0.05);
    this.drone.flightLocked = true;
    this.drone.hover = true;

    // Identify mode would fight the tour's own highlight + scripted narration.
    // Force it off and notify the UI so the panel + crosshairs reset cleanly.
    if (this.drone.identifyMode) {
      this.drone.identifyMode = false;
      this.drone.onIdentifyToggle?.(false);
    }

    if (this._savedLabels === null) {
      this._savedLabels = this.layer.labelsGroup.visible;
    }
    this.layer.setLabelsVisible(true);

    this._syncOverlay();
    this._runCurrentStop();
    return true;
  }

  stop({ silent = false } = {}) {
    this.running = false;
    this._phase = "idle";
    this.flyTo.cancel();
    if (this._savedLabels !== null) {
      this.layer.setLabelsVisible(this._savedLabels);
      this._savedLabels = null;
    }
    this.drone.flightLocked = false;
    this.layer.clearHighlights();
    this._hideOverlay();
    if (!silent) this.onStop?.();
  }

  skipToNext() {
    if (!this.running) return;
    this.flyTo.cancel();
    this._dwellT = 0;
    this.index += 1;
    if (this.index >= this.stops.length) {
      this.stop();
      return;
    }
    this._runCurrentStop();
  }

  update(dt) {
    if (!this.running || this._phase !== "dwell") return;
    this._dwellT += dt;

    // Cinematic orbit around the stop's centroid. Keeps the camera level
    // (preserves the vantage's pitch) so the airspace stays roughly framed
    // throughout the dwell.
    if (this._orbit) {
      const o = this._orbit;
      o.angle += this._orbitOmega * o.dir * dt;
      const x = o.cx + Math.cos(o.angle) * o.r;
      const z = o.cz + Math.sin(o.angle) * o.r;
      this.drone.position.x = x;
      this.drone.position.z = z;
      // Always look at the orbit center (drone yaw = azimuth from drone to centre)
      this.drone.bodyYaw = Math.atan2(-(o.cx - x), -(o.cz - z));
      this.drone.bodyPitch = o.pitch;
      if (typeof this.drone._applyCameraMode === "function") {
        this.drone._applyCameraMode();
      }
      if (typeof this.drone._syncCamera === "function") {
        this.drone._syncCamera();
      }
    }

    const stop = this.stops[this.index];
    const dwell = stop?.dwellSec ?? 20;
    this._updateProgress(dwell);
    if (this._dwellT >= dwell) {
      this.index += 1;
      if (this.index >= this.stops.length) {
        this.stop();
        return;
      }
      this._runCurrentStop();
    }
  }

  _setupOrbit() {
    // Resolve a centre for the orbit. Airspace stops orbit the airspace
    // vantage's lookX/lookZ. Other stops (takeoff/rules/finale) orbit
    // Bangkok origin.
    const stop = this.stops[this.index];
    let cx = null, cz = null;
    if (stop?.airspaceId) {
      const v = this.layer.overviewVantage(stop.airspaceId, this.camera.fov);
      if (v) { cx = v.lookX; cz = v.lookZ; }
    }
    if (cx == null) {
      const c = geoToWorld(ORIGIN.lat, ORIGIN.lon);
      cx = c.x; cz = c.z;
    }
    const dx = this.drone.position.x - cx;
    const dz = this.drone.position.z - cz;
    const r = Math.hypot(dx, dz);
    if (r < 200) {                  // sitting on top — no orbit
      this._orbit = null;
      return;
    }
    this._orbit = {
      cx, cz, r,
      angle: Math.atan2(dz, dx),
      dir: (this.index % 2 === 0) ? 1 : -1,   // alternate stops
      pitch: this.drone.bodyPitch,
    };
  }

  _runCurrentStop() {
    const stop = this.stops[this.index];
    if (!stop) {
      this.stop();
      return;
    }
    this._dwellT = 0;
    this._phase = "fly";
    this._orbit = null;  // pause orbit while flying to the next stop
    this._renderStop(stop);

    if (stop.type === "takeoff") {
      this._doTakeoff(stop);
      return;
    }
    if (stop.type === "finale") {
      this._doFinale(stop);
      return;
    }
    if (stop.type === "rules") {
      this._doRules(stop);
      return;
    }
    if (stop.airspaceId) {
      this._doAirspace(stop);
      return;
    }
    this._beginDwell();
  }

  _doTakeoff(stop) {
    const c = geoToWorld(ORIGIN.lat, ORIGIN.lon);
    const y0 = this.drone.position.y;
    const y1 = stop.climbToM ?? 1400;
    const dur = stop.climbSec ?? 10;
    this.layer.clearHighlights();
    this.flyTo.start(
      { x: c.x, y: y1, z: c.z, yaw: 0, pitch: -0.22 },
      {
        duration: dur,
        from: { x: c.x, y: y0, z: c.z, yaw: this.drone.bodyYaw, pitch: this.drone.bodyPitch },
        onComplete: () => {
          this.drone.position.set(c.x, y1, c.z);
          this._beginDwell();
        },
      },
    );
  }

  _doAirspace(stop) {
    const v = this.layer.overviewVantage(stop.airspaceId, this.camera.fov);
    if (!v) {
      this.index += 1;
      this._runCurrentStop();
      return;
    }
    const from = this.drone.position.clone();
    const dist = distance3(from, { x: v.x, y: v.y, z: v.z });
    const dur = flyDurationForDistance(dist, stop.flyDurationSec);
    const yaw = Math.atan2(-(v.lookX - v.x), -(v.lookZ - v.z));
    this.onFlyTo?.(stop.airspaceId, {
      duration: dur,
      onComplete: () => this._beginDwell(),
    });
  }

  _doRules(stop) {
    const c = geoToWorld(ORIGIN.lat, ORIGIN.lon);
    const alt = 2200;
    const dist = distance3(this.drone.position, { x: c.x, y: alt, z: c.z });
    const dur = flyDurationForDistance(dist, stop.flyDurationSec);
    this.layer.clearHighlights();
    this.flyTo.start(
      { x: c.x, y: alt, z: c.z, yaw: 0, pitch: -0.35 },
      {
        duration: dur,
        onComplete: () => this._beginDwell(),
      },
    );
  }

  _doFinale(stop) {
    const c = geoToWorld(ORIGIN.lat, ORIGIN.lon);
    const alt = 1800;
    const dist = distance3(this.drone.position, { x: c.x, y: alt, z: c.z });
    const dur = flyDurationForDistance(dist, stop.flyDurationSec);
    this.layer.clearHighlights();
    this.flyTo.start(
      { x: c.x, y: alt, z: c.z, yaw: 0, pitch: -0.18 },
      {
        duration: dur,
        onComplete: () => {
          if (stop.returnBangkok) {
            this.drone.teleport(c.x, 200, c.z, 0, -0.05);
          }
          this._beginDwell();
        },
      },
    );
  }

  _beginDwell() {
    this._phase = "dwell";
    this._dwellT = 0;
    this._setupOrbit();
    this._syncOverlay();
  }

  _renderStop(stop) {
    const el = document.getElementById("tourOverlay");
    if (!el) return;
    const chapter = document.getElementById("tourChapter");
    const title = document.getElementById("tourTitle");
    const body = document.getElementById("tourNarration");
    const variant = this.variants[this.variantId];
    if (chapter) {
      chapter.textContent = stop.chapter ?? variant?.label ?? "";
    }
    if (title) title.textContent = stop.title ?? "";
    if (body) {
      body.innerHTML = (stop.lines ?? [])
        .map((line) => `<p>${line}</p>`)
        .join("");
    }
    el.classList.add("visible");
    this._updateProgress(stop.dwellSec ?? 20);
  }

  _updateProgress(dwellSec) {
    const bar = document.getElementById("tourProgressBar");
    const label = document.getElementById("tourProgressLabel");
    if (!bar || !label) return;
    const total = this.stops.length;
    const u = dwellSec > 0 ? Math.min(1, this._dwellT / dwellSec) : 1;
    const overall = ((this.index + u) / total) * 100;
    bar.style.width = `${overall}%`;
    label.textContent = `Stop ${this.index + 1} of ${total}`;
  }

  _syncOverlay() {
    const el = document.getElementById("tourOverlay");
    if (el && this.running) el.classList.add("visible");
  }

  _hideOverlay() {
    const el = document.getElementById("tourOverlay");
    if (el) el.classList.remove("visible");
    const bar = document.getElementById("tourProgressBar");
    if (bar) bar.style.width = "0%";
  }
}
