// main.js — entry point: scene, ground tiles, drone, airspaces, UI loop.
import * as THREE from "three";
import { Drone } from "./drone.js";
import { AirspaceLayer } from "./airspace.js";
import { UI } from "./ui.js";
import { DynamicGround } from "./ground.js";
import { FlyToController } from "./flyto.js";
import { FlightHistory } from "./flightHistory.js";
import { pickAirspacesAlongRay } from "./identify.js";
import { getStartLocation } from "./geolocation.js";
import { geoToWorld, ORIGIN } from "./coords.js";
import { TourGuide } from "./tourGuide.js";

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x89b4dc);
scene.fog = new THREE.Fog(0xa9c1da, 80_000, 400_000);

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
renderer.sortObjects = true;
document.getElementById("app").appendChild(renderer.domElement);
// Explicitly drop the initial inline style.width/height so the canvas relies
// on the parent #app's full-viewport box. Three.js's setSize() writes pixel
// strings that can drift out of sync with the viewport on later resize.
renderer.domElement.style.width = "100%";
renderer.domElement.style.height = "100%";

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
sun.position.set(0.5, 1.0, 0.4).normalize();
scene.add(sun);

const ground = new DynamicGround({ baseZoom: 9, detailZoom: 11, baseRange: 3, detailRange: 2 });
scene.add(ground.group);

{
  const planeGeo = new THREE.PlaneGeometry(800_000, 800_000);
  const planeMat = new THREE.MeshBasicMaterial({
    color: 0x1a2a3a,
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
const flightHistory = new FlightHistory(drone);
const layer = new AirspaceLayer();

let ui;
let tourGuide;
let catalogHighlightId = null;
let _historySampleT = 0;
let _applyingHistory = false;

function applySnapshot(s) {
  if (!s) return;
  _applyingHistory = true;
  drone.restore(s);
  ui?.syncSpeedButtons?.();
  ui?.setCameraMode?.(drone.cameraMode);
  _applyingHistory = false;
}

function resetDrone() {
  const c = geoToWorld(ORIGIN.lat, ORIGIN.lon);
  drone.teleport(c.x, 200, c.z, 0, -0.05);
  layer?.clearHighlights();
  catalogHighlightId = null;
  ui?.clearFlyToTarget();
  flightHistory.clear();
  flightHistory.push(drone.snapshot(), { label: "Bangkok reset" });
}

function startFlyTo(id, { duration = 0.45, onComplete, pushHistory = true, direction = "S" } = {}) {
  const v = layer.overviewVantage(id, camera.fov, direction);
  if (!v) return false;
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
  return true;
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

(async function bootstrap() {
  await layer.load("./data/airspaces.json");
  scene.add(layer.group);
  scene.add(layer.labelRoot);
  scene.add(layer.identifyLabelsGroup);

  tourGuide = new TourGuide({
    drone,
    flyTo,
    layer,
    camera,
    onFlyTo: startFlyTo,
    onStop: () => {
      catalogHighlightId = null;
      drone.hover = false;
      drone.flightLocked = false;
      ui?.setTourRunning(false);
      ui?.clearFlyToTarget();
      layer.clearHighlights();
      flightHistory.push(drone.snapshot(), { label: "Tour complete · explore" });
    },
  });
  await tourGuide.load();

  ui = new UI({
    drone,
    camera,
    airspaceLayer: layer,
    tourGuide,
    onFlyTo: startFlyTo,
    onUndo: undoFlight,
    onRedo: redoFlight,
    onReset: resetDrone,
  });

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

  const start = await getStartLocation();
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
  flightHistory.push(drone.snapshot(), {
    label: start.source === "gps" ? "GPS start" : "Bangkok start",
  });

  document.getElementById("loading").style.display = "none";
})().catch((err) => {
  console.error(err);
  const el = document.getElementById("loading");
  if (el) el.textContent = "Failed to load airspace data: " + err.message;
});

const isTouchOnly = matchMedia("(pointer: coarse)").matches && !matchMedia("(pointer: fine)").matches;
if (isTouchOnly) {
  const mn = document.getElementById("mobileNotice");
  if (mn) mn.style.display = "block";
}

let lastT = performance.now();
let rafId = null;
function _safe(label, fn) {
  try { return fn(); }
  catch (err) { console.error(`[loop:${label}]`, err); return undefined; }
}
function loop(t) {
  const dt = Math.min((t - lastT) / 1000, 0.1);
  lastT = t;

  // Every per-frame call wrapped so one bad subsystem never freezes the
  // entire render loop — the user gets a useful console error instead of a
  // permanent black screen.
  const flying = _safe("flyTo", () => flyTo.update(dt)) ?? false;
  const touring = _safe("tour-isRunning", () => tourGuide?.isRunning()) ?? false;
  if (touring) _safe("tour-update", () => tourGuide.update(dt));
  if (!flying && !touring) _safe("drone-update", () => drone.update(dt));

  if (!flying && !touring && !flyTo.active && !_applyingHistory && drone.currentSpeed > 0.5) {
    _historySampleT += dt;
    if (_historySampleT >= 12) {
      _historySampleT = 0;
      _safe("history-push", () => flightHistory.push(drone.snapshot(), { label: "Manual flight" }));
    }
    _safe("history-sample", () => flightHistory.samplePosition(drone.position));
  }

  _safe("ground-alt", () => ground.setAltitude(drone.position.y));
  _safe("ground-update", () => ground.updateAround(drone.position.x, drone.position.z));
  _safe("horizon", () => updateHorizonCompass(drone.position));

  _safe("identify", () => {
    if (drone.identifyMode && !flyTo.active) {
      const ids = pickAirspacesAlongRay(camera, layer);
      layer.setHighlighted(ids);
      ui?.updateIdentifyPanel(layer.identifyInfoForIds(ids, drone.position));
    } else if (catalogHighlightId && !flyTo.active) {
      layer.setHighlighted(new Set([catalogHighlightId]));
      ui?.updateIdentifyPanel([]);
    } else if (!flyTo.active && !drone.identifyMode) {
      layer.clearHighlights();
      ui?.updateIdentifyPanel([]);
    }
  });

  _safe("label-scales", () => layer.updateLabelScales(camera, renderer));

  if (ui) {
    _safe("hud", () => ui.updateHUD(dt));
    _safe("minimap", () => ui.drawMinimap());
  }
  _safe("render", () => renderer.render(scene, camera));
  rafId = requestAnimationFrame(loop);
}
rafId = requestAnimationFrame(loop);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
  } else if (rafId === null) {
    lastT = performance.now();
    rafId = requestAnimationFrame(loop);
  }
});

window.__sim = { scene, camera, drone, layer, ground, flightHistory, tourGuide };
