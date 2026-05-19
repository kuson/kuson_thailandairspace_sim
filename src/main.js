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

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

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

function startFlyTo(id) {
  const v = layer.overviewVantage(id, camera.fov);
  if (!v) return;
  const a = layer.airspaces.find((x) => x.id === id);
  ui.markFlyToTarget(id);
  const yaw = Math.atan2(-(v.lookX - v.x), -(v.lookZ - v.z));
  flyTo.start(
    { x: v.x, y: v.y, z: v.z, yaw, pitch: v.pitch ?? -0.15 },
    {
      duration: 0.45,
      onComplete: () => {
        drone.hover = false;
        catalogHighlightId = id;
        layer.setHighlighted(new Set([id]));
        if (!_applyingHistory) {
          flightHistory.push(drone.snapshot(), {
            label: a?.shortName ?? id,
            airspaceId: id,
          });
        }
      },
    },
  );
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

  ui = new UI({
    drone,
    camera,
    airspaceLayer: layer,
    onFlyTo: startFlyTo,
    onUndo: undoFlight,
    onRedo: redoFlight,
    onReset: resetDrone,
  });

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
function loop(t) {
  const dt = Math.min((t - lastT) / 1000, 0.1);
  lastT = t;

  const flying = flyTo.update(dt);
  if (!flying) drone.update(dt);

  if (!flying && !flyTo.active && !_applyingHistory && drone.currentSpeed > 0.5) {
    _historySampleT += dt;
    if (_historySampleT >= 12) {
      _historySampleT = 0;
      flightHistory.push(drone.snapshot(), { label: "Manual flight" });
    }
    flightHistory.samplePosition(drone.position);
  }

  ground.updateAround(drone.position.x, drone.position.z);
  updateHorizonCompass(drone.position);

  if (drone.identifyMode && !flyTo.active) {
    const ids = pickAirspacesAlongRay(camera, layer);
    layer.setHighlighted(ids);
    ui?.updateIdentifyPanel(layer.identifyInfoForIds(ids));
  } else if (catalogHighlightId && !flyTo.active) {
    layer.setHighlighted(new Set([catalogHighlightId]));
    ui?.updateIdentifyPanel([]);
  } else if (!flyTo.active && !drone.identifyMode) {
    layer.clearHighlights();
    ui?.updateIdentifyPanel([]);
  }

  layer.updateLabelScales(camera, renderer);

  if (ui) {
    ui.updateHUD(dt);
    ui.drawMinimap();
  }
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

window.__sim = { scene, camera, drone, layer, ground, flightHistory };
