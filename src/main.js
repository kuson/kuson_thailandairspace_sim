// main.js — entry point: scene, ground tiles, drone, airspaces, UI loop.
import * as THREE from "three";
import { Drone } from "./drone.js";
import { AirspaceLayer } from "./airspace.js";
import { UI } from "./ui.js";
import { loadTerrain } from "./terrain.js";
import { DynamicGround } from "./ground.js";
import { FlyToController } from "./flyto.js";
import { FlightHistory, HISTORY_EVENT_TYPES } from "./flightHistory.js";
import { EasyMode, FlightMode } from "./modes.js";
import { pickAirspacesAlongRay } from "./identify.js";
import { getStartLocation } from "./geolocation.js";
import { geoToWorld, ORIGIN } from "./coords.js";
import { TourGuide } from "./tourGuide.js";
import { installSky, updateSky } from "./sky.js";
import { installCityBeacons } from "./cities.js";
import { installProvinceLines } from "./provinces.js";
import { installAirportBeacons } from "./airports.js";
import { installRangeRings } from "./rangeRings.js";
import { getGroundDetailSettings, setGroundDetailSettings } from "./groundSettings.js";
import { LiveFlightsLayer } from "./liveFlights.js";
import { getLiveFlightsSettings, setLiveFlightsSettings } from "./flightSources.js";
import { FollowController } from "./followController.js";
import { RigidBody, QuadrotorModel, FixedWingModel } from "./physics.js";
import { SimMode, SimModeMachine } from "./simMode.js";
import { simState } from "./simState.js";
import * as ceilings from "./ceilings.js";
import { installDebugOverlay } from "./debugOverlay.js";
import { GameMode } from "./game/gameMode.js";
import { AtcRadio } from "./game/atc.js";
import { UfoLayer } from "./game/ufo.js";
import { TypingChallenge } from "./game/typing.js";
import { alerts, AlertTier } from "./alerts.js";
import { installStartScreen } from "./startScreen.js";
import { installAudio } from "./audio.js";

// B7.T9: build the start-screen overlay immediately (before bootstrap runs).
// Failure-safe: if construction throws, stub methods are returned and dismissed
// is true so nothing blocks the sim.
const startScreen = installStartScreen();

const scene = new THREE.Scene();
// Shared sun direction — the Sky shader, the sun-disc sprite, and the
// DirectionalLight all read from this so lighting matches the sky.
const SUN_DIR = new THREE.Vector3(0.5, 1.0, 0.4).normalize();
const skyRig = installSky(scene, undefined, SUN_DIR);
// Horizon haze hard-coded to match Sky shader output at ~10° above horizon.
// fog.far is lerped per-frame in the render loop based on altitude (P2.T2).
const FOG_NEAR_BASE = 30_000;
const FOG_FAR_BASE  = 250_000;
// Bluer horizon haze (was 0xc8d4dc grey-blue) so distant terrain melts into a
// sky-blue band instead of a flat grey one. Matches the richer Sky dome.
scene.fog = new THREE.Fog(0xa6cdee, FOG_NEAR_BASE, FOG_FAR_BASE);

const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  2,
  600_000
);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  logarithmicDepthBuffer: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
// Neutral (not ACES) tonemapping. ACESFilmic desaturates the bright Preetham
// sky to cream-white and mutes the airspace colours; NeutralToneMapping
// preserves hue + saturation, so the sky reads blue and the volumes pop.
// Exposure 0.7 keeps the Voyager basemap bright without blowing out the sky.
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 0.7;
renderer.sortObjects = true;
document.getElementById("app").appendChild(renderer.domElement);
// Explicitly drop the initial inline style.width/height so the canvas relies
// on the parent #app's full-viewport box. Three.js's setSize() writes pixel
// strings that can drift out of sync with the viewport on later resize.
renderer.domElement.style.width = "100%";
renderer.domElement.style.height = "100%";
const debugOverlay = installDebugOverlay(renderer);

// Renderer / camera sizing. In map-primary mode the 3D scene shrinks to a
// fixed inset (matched to the CSS box for #app in index.html); otherwise it
// fills the viewport.
let mapPrimary = false;
function applyRendererSize() {
  let w, h;
  if (mapPrimary) {
    w = 320; h = 240;             // keep in sync with body.map-primary #app
  } else {
    w = window.innerWidth; h = window.innerHeight;
  }
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  // Make the canvas styled-size follow regardless of devicePixelRatio scaling.
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
}
window.addEventListener("resize", () => {
  if (mapPrimary && ui) {
    // Minimap canvas fills the viewport in primary mode — keep it in sync.
    ui.minimap.width = window.innerWidth;
    ui.minimap.height = window.innerHeight;
  }
  applyRendererSize();
});

// Lights — let aircraft models shade with volume instead of flat color. The
// airspace + ground meshes use MeshBasicMaterial and ignore lighting, so this
// only affects the new aircraft models (which use MeshLambert / MeshPhong).
const hemi = new THREE.HemisphereLight(0xc6d8f0, 0x394a3a, 1.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2d8, 1.1);
sun.position.copy(SUN_DIR);   // shared with sky.js Sky shader + sun sprite
scene.add(sun);

const ground = new DynamicGround({ baseZoom: 9, detailZoom: 11, baseRange: 3, detailRange: 2 });
scene.add(ground.group);

// Thai city beacons (Phase 2 P2.T5). Top 18 by prominence × proximity so a
// satellite-style view doesn't read as a wall of labels.
const cityBeacons = installCityBeacons(scene, { y: 200, topN: 24 });

// Betterment-6: ground orientation layers (airports / range rings / province
// names), each independently toggleable + persisted (kuson.grounddetail.v1).
// Defaults: airports + provinces on, range rings off (opt-in).
const groundDetail = getGroundDetailSettings();
const rangeRings = installRangeRings(scene);
rangeRings.group.visible = groundDetail.rangeRings;
let airportBeacons = null;
installAirportBeacons(scene, { y: 200, topN: 14 })
  .then((r) => { airportBeacons = r; r.group.visible = groundDetail.airports; })
  .catch((err) => console.warn("[airports]", err));
// Province boundary overlay (Phase 2 P2.T6) + names (Betterment-6 §14.3). Async.
let provinceLines = null;
installProvinceLines(scene)
  .then((r) => { provinceLines = r; r.group.visible = groundDetail.provinces; })
  .catch((err) => console.warn("[provinces]", err));

// Betterment-4: live ADS-B traffic overlay. Off by default; allocates nothing
// and hits no network until the operator toggles "Show me live flights".
const liveFlights = new LiveFlightsLayer(scene, { camera, renderer });

// Wide base plane beneath the tiles — reads as the open ocean/atmosphere
// beyond the loaded basemap. Deep vivid blue (was a dark slate 0x1a2a3a) so
// the world surrounds the flyer in blue water rather than a void.
{
  const planeGeo = new THREE.PlaneGeometry(800_000, 800_000);
  const planeMat = new THREE.MeshBasicMaterial({
    color: 0x125a96,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: 4,
    polygonOffsetUnits: 4,
  });
  const plane = new THREE.Mesh(planeGeo, planeMat);
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = -8;
  plane.renderOrder = -2;
  ground.group.add(plane);
  ground.setFallbackPlane(plane);
}

function makeLabel(text, color = "#ffffff") {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 256;
  const ctx = c.getContext("2d");
  ctx.font = "bold 192px ui-monospace, monospace";
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 256, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex, depthTest: false, transparent: true,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(12_000, 6_000, 1);
  sprite.renderOrder = 9000;
  return sprite;
}

/** @type {{ sprites: THREE.Sprite[], poles: THREE.Mesh[], offsets: {x:number,z:number}[] }} */
const horizonCompass = (function () {
  const D = 200_000;
  const entries = [
    ["N", 0, -D],
    ["S", 0, D],
    ["E", D, 0],
    ["W", -D, 0],
  ];
  const out = { sprites: [], poles: [], offsets: entries.map(([, x, z]) => ({ x, z })) };
  for (const [label, x, z] of entries) {
    const s = makeLabel(label, "#ffffff");
    s.position.set(x, 10_000, z);
    scene.add(s);
    out.sprites.push(s);
    const poleGeo = new THREE.CylinderGeometry(400, 400, 10_000, 8);
    const poleMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false,
    });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(x, 5000, z);
    pole.renderOrder = 50;
    scene.add(pole);
    out.poles.push(pole);
  }
  return out;
})();

function updateHorizonCompass(pos) {
  for (let i = 0; i < 4; i++) {
    const o = horizonCompass.offsets[i];
    const wx = pos.x + o.x;
    const wz = pos.z + o.z;
    horizonCompass.sprites[i].position.set(wx, 10_000, wz);
    horizonCompass.poles[i].position.set(wx, 5000, wz);
  }
}

const drone = new Drone(camera, renderer.domElement);
scene.add(drone.mesh);

const flyTo = new FlyToController(drone);
// Betterment-4.1: spectator follow-cam for "view this plane".
const follow = new FollowController(drone, camera);
window.addEventListener("keydown", (e) => {
  if (!follow.active) return;
  if (e.key === "Escape" || (e.key.length === 1 && "wasdqeWASDQE".includes(e.key)) || e.key.startsWith("Arrow")) follow.release();
});
renderer.domElement.addEventListener("pointerdown", () => { if (follow.active) follow.release(); });
const flightHistory = new FlightHistory(drone);
const layer = new AirspaceLayer();

let ui;
let tourGuide;
let catalogHighlightId = null;
let _applyingHistory = false;

// B8.T1: audio core — created before bootstrap so startScreen buttons can unlock it.
const audio = installAudio({ alerts });

// P5.T7: authoritative top-level mode, derived each frame from the live
// controller signals (see loop). Replaces the flyTo/tour/paused/replay
// flag-AND tangle the loop used to juggle.
const simMode = new SimModeMachine();

const atc    = new AtcRadio({ layer, getDronePos: () => drone.position, alerts, AlertTier, audio });
const ufos   = new UfoLayer(scene, { layer });
const typing = new TypingChallenge({ drone, audio });
const game   = new GameMode({ layer, startFlyTo, getDronePos: () => drone.position, atc, ufos, typing, alerts, AlertTier, audio });

// Betterment-2 P3: build the per-frame context the flight-history event log
// diffs against. Cheap — airspacesAt is AABB-accelerated.
function historyContext(free) {
  const inside = layer?.airspacesAt?.(drone.position.x, drone.position.y, drone.position.z) ?? [];
  return {
    snapshot: drone.snapshot(),
    free,
    presetId: drone.speedPresetId,
    presetDisplay: drone.activePreset?.()?.display,
    easy: EasyMode.enabled,
    paused: !!drone.paused,
    rthActive: !!drone.rth?.active,
    insideId: inside[0]?.id ?? null,
  };
}

function applySnapshot(s) {
  if (!s) return;
  _applyingHistory = true;
  drone.restore(s);
  ui?.syncSpeedButtons?.();
  ui?.setCameraMode?.(drone.cameraMode);
  // P3: re-seed the event-log baseline so the restore teleport isn't logged
  // as a spurious course/position/preset change on the next frame.
  flightHistory.resetBaseline(historyContext(false));
  _applyingHistory = false;
}

function resetDrone() {
  const c = geoToWorld(ORIGIN.lat, ORIGIN.lon);
  drone.teleport(c.x, 200, c.z, 0, -0.05);
  layer?.clearHighlights();
  catalogHighlightId = null;
  ui?.clearFlyToTarget();
  flightHistory.clear();
  flightHistory.record(HISTORY_EVENT_TYPES.RESET, drone.snapshot(), { label: "Reset to Bangkok" });
}

// Betterment-2 P1.T2: startFlyTo now returns {ok, reason?} so the UI can
// surface lockout reasons as a toast instead of silently no-op'ing. The
// canonical fly-to state machine is documented in doc/flyto_state_machine.md.
function startFlyTo(id, { duration = 0.45, onComplete, pushHistory = true, direction = "S" } = {}) {
  const v = layer.overviewVantage(id, camera.fov, direction);
  if (!v) return { ok: false, reason: `No vantage available for ${id}.` };
  const a = layer.airspaces.find((x) => x.id === id);
  ui.markFlyToTarget(id);
  const yaw = Math.atan2(-(v.lookX - v.x), -(v.lookZ - v.z));
  flyTo.start(
    { x: v.x, y: v.y, z: v.z, yaw, pitch: v.pitch ?? -0.15 },
    {
      duration,
      onComplete: () => {
        drone.hover = Boolean(tourGuide?.isRunning());
        catalogHighlightId = id;
        layer.setHighlighted(new Set([id]));
        if (pushHistory && !_applyingHistory) {
          flightHistory.push(drone.snapshot(), {
            label: `${a?.shortName ?? id} (from ${direction})`,
            airspaceId: id,
          });
        }
        onComplete?.();
      },
    },
  );
  return { ok: true };
}

function undoFlight() {
  const s = flightHistory.undo();
  if (s) {
    applySnapshot(s);
    catalogHighlightId = s.airspaceId ?? null;
    if (catalogHighlightId) layer.setHighlighted(new Set([catalogHighlightId]));
    else layer.clearHighlights();
    ui?.clearFlyToTarget();
    if (catalogHighlightId) ui?.markFlyToTarget(catalogHighlightId);
  }
}

function redoFlight() {
  const s = flightHistory.redo();
  if (s) {
    applySnapshot(s);
    catalogHighlightId = s.airspaceId ?? null;
    if (catalogHighlightId) layer.setHighlighted(new Set([catalogHighlightId]));
    else layer.clearHighlights();
    ui?.clearFlyToTarget();
    if (catalogHighlightId) ui?.markFlyToTarget(catalogHighlightId);
  }
}

drone.onIdentifyToggle = (on) => {
  ui?.setIdentifyActive(on);
  if (!on && !catalogHighlightId) layer.clearHighlights();
};

flightHistory.onChange = (state) => ui?.updateHistoryButtons?.(state);

async function bootstrap() {
  await layer.load("./data/airspaces.json");
  startScreen.tick("Loading airspaces…");
  scene.add(layer.group);
  scene.add(layer.labelRoot);
  scene.add(layer.identifyLabelsGroup);

  // P4.T5: hand the airspace layer to the drone so its tiered geofence
  // can run unfiltered membership queries each substep.
  drone.setAirspaceLayer(layer);

  // P4.T4: kick off the SRTM-baked terrain grid load in parallel with the
  // rest of bootstrap. Until it resolves, AGL() falls back to AMSL and the
  // geofence ceiling reads as if ground were at MSL — same behaviour the
  // sim had before T4 landed, just with one degraded frame at startup.
  loadTerrain("./data/terrain.bin", "./data/terrain.json")
    .then(() => startScreen.tick("Loading terrain…"))
    .catch((err) => console.warn("[terrain] load failed:", err));

  tourGuide = new TourGuide({
    drone,
    flyTo,
    layer,
    camera,
    onFlyTo: startFlyTo,
    // Betterment-2 P1.T2: onStop ALWAYS runs the UI/state teardown so
    // _tourRunning can never get stuck true (the E4 root cause). `silent`
    // now scopes only the "Tour complete" history entry — the silent path
    // (reset-during-tour) suppresses the entry but still clears the flags.
    onStop: ({ silent = false } = {}) => {
      catalogHighlightId = null;
      drone.hover = false;
      drone.flightLocked = false;
      ui?.setTourRunning(false);
      ui?.clearFlyToTarget();
      layer.clearHighlights();
      if (!silent) {
        flightHistory.record(HISTORY_EVENT_TYPES.TOUR, drone.snapshot(), { label: "Tour complete · explore" });
      }
    },
  });
  await tourGuide.load();
  startScreen.tick("Loading tour data…");

  ui = new UI({
    drone,
    camera,
    airspaceLayer: layer,
    liveFlights,
    tourGuide,
    onFlyTo: startFlyTo,
    onUndo: undoFlight,
    onRedo: redoFlight,
    onReset: resetDrone,
  });
  // Re-publish ui on __sim now that it exists — the top-level assignment
  // captured it as undefined because bootstrap() is async.
  window.__sim.ui = ui;
  startScreen.tick("Building UI…");

  // B7.T5: wire ATC radio log → UI panel.
  atc.onMessage((e) => ui?.appendRadioLog(e));

  // UI's 'M' key toggles map-primary; we own the renderer, so resize it here.
  ui.onGroundQualityChange = (mode) => {
    ground.setQuality(mode);
    // Re-prime tiles at new zoom around current position.
    ground.updateAround(drone.position.x, drone.position.z);
  };

  ui.onMapPrimaryChange = (on) => {
    mapPrimary = on;
    applyRendererSize();
  };

  // Betterment-4: live-flights wiring. Each UI control persists then drives the
  // layer; restore the persisted source/interval/enabled on load.
  const lfSettings = getLiveFlightsSettings();
  liveFlights.setSource(lfSettings.source);
  liveFlights.setIntervalMs(lfSettings.intervalMs);
  if (lfSettings.proxyBase) liveFlights.setProxyBase(lfSettings.proxyBase);
  liveFlights.onStatusChange = (s) => ui.setLiveFlightsStatus(s);
  ui.onLiveFlightsToggle = (on) => { setLiveFlightsSettings({ enabled: on }); liveFlights.setEnabled(on); };
  ui.onFlightSourceChange = (id) => { setLiveFlightsSettings({ source: id }); liveFlights.setSource(id); };
  ui.onFlightIntervalChange = (ms) => { setLiveFlightsSettings({ intervalMs: ms }); liveFlights.setIntervalMs(ms); };
  ui.onSelectFlight = (icao) => { liveFlights.selectedId = icao || null; };
  ui.onFollowFlight = (icao) => {
    const fl = icao && liveFlights.flights.get(icao);
    if (fl) { liveFlights.selectedId = icao; follow.setTarget(fl); }
  };
  follow.onChange = (fl) => ui.setFollowing?.(fl ? fl.id : null);
  if (lfSettings.enabled) liveFlights.setEnabled(true);

  // Betterment-6: ground-detail layer toggles — persist + flip the scene group.
  ui.onGroundLayerToggle = (key, on) => {
    setGroundDetailSettings({ [key]: on });
    if (key === "airports") { if (airportBeacons) airportBeacons.group.visible = on; }
    else if (key === "rangeRings") { rangeRings.group.visible = on; }
    else if (key === "provinces") { if (provinceLines) provinceLines.group.visible = on; }
  };
  window.__sim.ground = {
    rangeRings,
    get airports() { return airportBeacons; },
    get provinces() { return provinceLines; },
  };

  const start = await getStartLocation();
  startScreen.tick("Locating start position…");
  const w = geoToWorld(start.lat, start.lon);
  drone.teleport(w.x, start.altM ?? 200, w.z, 0, -0.05);
  drone.setSpeedPreset("100x");
  ui.syncSpeedButtons();
  ui.setRadarMapDefault(true);
  ui.setRadarCenterDefault(true);

  drone.onCameraModeChange = (mode) => ui.setCameraMode(mode);

  if (start.source === "gps") {
    ui._radarCenter.x = w.x;
    ui._radarCenter.z = w.z;
  }

  ground.updateAround(w.x, w.z);
  flightHistory.record(HISTORY_EVENT_TYPES.START, drone.snapshot(), {
    label: start.source === "gps" ? "GPS start" : "Bangkok start",
  });
  startScreen.tick("Ready!");

  // B8.T1: bind audio to UI (Sound settings block).
  ui.bindAudio(audio);

  // B7.T9: hand off to the start-screen for mode selection.
  startScreen.ready({
    onExplore: () => { audio.unlock(); },
    onTour:    () => { audio.unlock(); tourGuide.start("short"); },
    onPlay:    () => { audio.unlock(); game.start(); },
  });
}

// P6.T3: on touch-only devices (no fine pointer) the sim is unusable —
// it needs a keyboard + mouse. Don't run the heavy bootstrap, geolocation
// prompt, or render loop until the user explicitly opts in via "Try
// anyway". simStarted also guards the visibilitychange restart below so a
// tab-focus can't sneak the loop alive before opt-in.
let simStarted = false;
function startSim() {
  if (simStarted) return;
  simStarted = true;
  // B7.T9: hide the old #loading div immediately — the start-screen overlay
  // replaces it.  The div stays in the DOM as a no-op fallback.
  const _loadingEl = document.getElementById("loading");
  if (_loadingEl) _loadingEl.style.display = "none";
  bootstrap().catch((err) => {
    console.error(err);
    startScreen.fail("Failed to load: " + err.message);
  });
  lastT = performance.now();
  rafId = requestAnimationFrame(loop);
}

let lastT = performance.now();
let rafId = null;
// P3.T1: fixed-step physics accumulator. Variable rAF dt feeds the outer
// loop; physics integrates at exactly 1/120 s per step so motion is
// frame-rate-independent (matches per wall-second whether at 20 or 144 fps).
const PHYS_DT = 1 / 120;
const PHYS_ACCUM_CAP = 0.25;  // avoid spiral-of-death after long pauses
let physAccum = 0;

// P5.T2: throttle the identify ray-march to 10 Hz. The pick + highlight +
// panel rebuild is the heaviest per-frame work in identify mode; 100 ms
// cadence is imperceptible to the user but cuts that cost ~6× at 60 fps.
let lastIdentifyT = 0;

// P5.T8: dynamic DPR reduction under frame pressure. Two consecutive
// frames slower than 25 ms (sub-40 fps) halve the device-pixel-ratio so
// the GPU fills 4× fewer pixels; 30 consecutive frames under 15 ms
// (60 fps+) restore it one step. Hysteresis (asymmetric counters) avoids
// thrashing the resolution every few frames.
const DPR_MAX = Math.min(window.devicePixelRatio || 1, 2);
const DPR_MIN = Math.max(DPR_MAX / 2, 0.5);
let currentDPR = DPR_MAX;
let slowFrameRun = 0;
let fastFrameRun = 0;

/**
 * B8.T2 — Snapshot drone state for the audio engine each frame.
 * Reads from the live drone object; safe to call while paused.
 */
function droneStateForAudio() {
  const fm = drone.flightMode;
  let mode;
  if (fm === FlightMode.AIRPLANE) {
    mode = "airplane";
  } else if (fm === FlightMode.DRONE) {
    mode = "drone";
  } else {
    mode = "hover"; // HOVERCRAFT / UFO
  }

  let throttle, airspeedMs, Vs, stalled;
  if (mode === "airplane" && drone._fixedwing) {
    throttle   = drone._fixedwing.throttle;
    airspeedMs = drone._fixedwing.airspeedMs;
    Vs         = drone._fixedwing.Vs;
    stalled    = drone._fixedwing.stalled;
  } else {
    // drone / hover: use currentSpeed as proxy (0–50 m/s → 0–1)
    const spd = drone.currentSpeed ?? 0;
    throttle   = Math.max(0, Math.min(1, spd / 50));
    airspeedMs = 0;
    Vs         = 0;
    stalled    = false;
  }

  return {
    mode,
    presetId:   drone.speedPresetId,
    throttle:   throttle   ?? 0,
    airspeedMs: airspeedMs ?? 0,
    Vs:         Vs         ?? 0,
    stalled:    stalled    ?? false,
    paused:     !!drone.paused,
  };
}

function _safe(label, fn) {
  try { return fn(); }
  catch (err) { console.error(`[loop:${label}]`, err); return undefined; }
}
function loop(t) {
  const dt = Math.min((t - lastT) / 1000, 0.1);
  lastT = t;

  // P5.T8: adapt DPR to frame pressure. dt is already clamped to 0.1 s, so
  // a single post-pause spike can't fool the counters; requiring 2 (down)
  // / 30 (up) consecutive frames adds hysteresis. Skip the first frame
  // (dt can be a stale-tab spike before the visibility reset kicks in).
  const frameMs = dt * 1000;
  if (frameMs > 25) { slowFrameRun++; fastFrameRun = 0; }
  else if (frameMs < 15) { fastFrameRun++; slowFrameRun = 0; }
  else { slowFrameRun = 0; fastFrameRun = 0; }
  if (slowFrameRun >= 2 && currentDPR > DPR_MIN) {
    currentDPR = Math.max(DPR_MIN, currentDPR * 0.5);
    renderer.setPixelRatio(currentDPR);
    applyRendererSize();
    slowFrameRun = 0;
  } else if (fastFrameRun >= 30 && currentDPR < DPR_MAX) {
    currentDPR = Math.min(DPR_MAX, currentDPR * 2);
    renderer.setPixelRatio(currentDPR);
    applyRendererSize();
    fastFrameRun = 0;
  }

  // Every per-frame call wrapped so one bad subsystem never freezes the
  // entire render loop — the user gets a useful console error instead of a
  // permanent black screen.
  const flyActive = _safe("flyTo", () => flyTo.update(dt)) ?? false;
  const tourActive = _safe("tour-isRunning", () => tourGuide?.isRunning()) ?? false;
  if (tourActive) _safe("tour-update", () => tourGuide.update(dt));

  // P5.T7: collapse the flyTo/tour/paused/replay flags into one validated
  // mode. The drone is "driven" externally only by a fly-to or a tour;
  // those are the cases that skip the physics integrator. FREE/PAUSED/REPLAY
  // all fall through to physicsStep + update — physicsStep self-gates on
  // drone.paused, so a paused sim still syncs its camera via drone.update.
  const mode = _safe("sim-mode", () => simMode.resolve({
    paused: drone.paused,
    replaying: _applyingHistory,
    touring: tourActive,
    flyingTo: flyActive,
  })) ?? SimMode.FREE;
  const droneDriven = (mode === SimMode.FLYING_TO || mode === SimMode.TOURING);

  if (!droneDriven) {
    physAccum = Math.min(physAccum + dt, PHYS_ACCUM_CAP);
    while (physAccum >= PHYS_DT) {
      _safe("drone-physics", () => drone.physicsStep(PHYS_DT));
      physAccum -= PHYS_DT;
    }
    _safe("drone-update", () => drone.update(dt));
  } else {
    // While flyTo / tour drive the drone directly, drop any pending physics
    // time so we don't replay it when control returns.
    physAccum = 0;
  }

  // Betterment-4.1: follow-cam owns the camera (runs after drone.update) while
  // locked onto a live flight; a no-op otherwise.
  _safe("follow", () => follow.update(dt));

  // Betterment-2 P3 (E2): log course/location + discrete state changes, not a
  // periodic "Manual flight" snapshot. Discrete events (preset/mode/pause/RTH/
  // boundary) track in any mode; course/position deltas only count in free
  // flight (tour/fly-to drive the drone and shouldn't fill the log). Skip
  // while an undo/redo restore is being applied — that frame's jump isn't a
  // user manoeuvre.
  if (!_applyingHistory) {
    _safe("history-track", () => flightHistory.track(historyContext(mode === SimMode.FREE)));
    if (mode === SimMode.FREE && drone.currentSpeed > 0.5) {
      _safe("history-sample", () => flightHistory.samplePosition(drone.position));
    }
  }

  // Altitude-driven fog falloff (P2.T2). THREE.Fog is linear so we adapt the
  // playbook's density formula by pushing fog.far outward at altitude — at
  // FL350 (~10 km) the horizon clears; at ground level the haze is dense.
  _safe("fog-altitude", () => {
    const tFog = Math.max(0, Math.min(drone.position.y / 12_000, 0.7));
    scene.fog.far = FOG_FAR_BASE / Math.max(0.3, 1 - tFog);
  });

  // P4.T1: keep the sky dome centred on the camera (no black void when flying
  // far from Bangkok) and fade it to space-black above 60 km.
  _safe("sky-follow", () => updateSky(skyRig, camera.position, drone.position.y));

  _safe("ground-alt", () => ground.setAltitude(drone.position.y));
  _safe("ground-update", () => ground.updateAround(drone.position.x, drone.position.z));
  _safe("horizon", () => updateHorizonCompass(drone.position));

  _safe("identify", () => {
    if (drone.identifyMode && !flyTo.active) {
      // P5.T2: re-pick at 10 Hz, not every frame. The highlight + panel
      // persist between picks; 100 ms latency is imperceptible while the
      // ray-vs-prism scan is the dominant identify-mode cost.
      if (t - lastIdentifyT > 100) {
        lastIdentifyT = t;
        const ids = pickAirspacesAlongRay(camera, layer);
        layer.setHighlighted(ids);
        ui?.updateIdentifyPanel(layer.identifyInfoForIds(ids, drone.position));
      }
    } else if (catalogHighlightId && !flyTo.active) {
      layer.setHighlighted(new Set([catalogHighlightId]));
      ui?.updateIdentifyPanel([]);
    } else if (!flyTo.active && !drone.identifyMode) {
      layer.clearHighlights();
      ui?.updateIdentifyPanel([]);
    }
  });

  // P4.T5: pulse authorisation-airspace outlines at 1 Hz so the user sees
  // the volume that's currently capping their altitude.
  _safe("geofence-flash", () => layer.tickGeofenceFlash(dt));

  _safe("label-scales", () => layer.updateLabelScales(camera, renderer));
  _safe("city-scales", () => cityBeacons.updateScales(camera, renderer));
  _safe("airport-scales", () => airportBeacons?.updateScales(camera, renderer));
  _safe("range-rings", () => rangeRings.update(drone.position, camera, renderer, ui?.unitSystem === "aero"));
  _safe("province-scales", () => provinceLines?.updateScales(camera, renderer));
  _safe("liveflights", () => liveFlights.update(dt, camera.position));
  _safe("liveflights-labels", () => liveFlights.updateLabelScales(camera, renderer));
  _safe("ufos", () => ufos.update(dt));
  _safe("audio", () => audio.update(dt, droneStateForAudio()));
  _safe("game", () => game.update(dt));

  if (ui) {
    _safe("hud", () => ui.updateHUD(dt));
    _safe("minimap", () => ui.drawMinimap());
  }
  _safe("render", () => renderer.render(scene, camera));
  _safe("debug-overlay", () => debugOverlay.update());
  rafId = requestAnimationFrame(loop);
}

// P6.T3: gate startup on pointer capability. Touch-only → show the
// blocking notice and wait for an explicit "Try anyway"; otherwise start
// immediately.
const isTouchOnly = matchMedia("(pointer: coarse)").matches && !matchMedia("(pointer: fine)").matches;
if (isTouchOnly) {
  const mn = document.getElementById("mobileNotice");
  if (mn) mn.style.display = "flex";
  const btn = document.getElementById("mobileTryAnyway");
  if (btn) {
    btn.addEventListener("click", () => {
      if (mn) mn.style.display = "none";
      startSim();
    }, { once: true });
  } else {
    startSim();   // no opt-in button present → don't hard-block
  }
} else {
  startSim();
}

document.addEventListener("visibilitychange", () => {
  if (!simStarted) return;
  if (document.hidden) {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
  } else if (rafId === null) {
    lastT = performance.now();
    rafId = requestAnimationFrame(loop);
  }
});

window.__sim = {
  scene, camera, drone, layer, ground, flightHistory, tourGuide, ui, simMode,
  simState, ceilings, renderer, liveFlights, follow,
  physics: { RigidBody, QuadrotorModel, FixedWingModel },
  debugOverlay, game, audio,
};
