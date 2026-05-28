// drone.js — 6DoF drone movement with WASD + Q/E + mouse-look, plus pointer-lock.
import * as THREE from "three";
import { FlightMode, EasyMode, resolveMode } from "./modes.js";

const KMH_TO_MS = 1 / 3.6;
const BOOST_FACTOR = 3;
const PITCH_LIMIT = (85 * Math.PI) / 180;
const MOUSE_SENSITIVITY = 0.0022;
const DOWN_PITCH = -Math.PI / 2 + 0.002;

// 3rd-person camera offset (in body-local space: +X right, +Y up, +Z back).
// Distance scales by current model so a Mavic 3 chase is tight and a 777 is
// wide enough to see the wings.
const THIRD_PERSON_BASE = { back: 20, up: 6 };

// ---------------- Aircraft model factory ----------------
// Each function returns a THREE.Group oriented so +Z is "forward" (matches the
// engine convention used elsewhere in this file). Origin is the centre of mass.
//
// Materials use MeshLambertMaterial so the scene's directional + hemisphere
// lights produce real volume shading on the primitive shapes.

function _mat(hex, opts = {}) {
  return new THREE.MeshLambertMaterial({ color: hex, ...opts });
}
function _glassMat(hex, opacity = 0.5) {
  return new THREE.MeshPhongMaterial({
    color: hex, transparent: true, opacity,
    shininess: 90, specular: 0xffffff,
  });
}

/**
 * Build a proper 3-D wing from a custom BufferGeometry. Two wing halves
 * (mirrored about the fuselage centreline) extending along world X with
 * leading edge at -Z (forward). Tapered, swept, dihedral'd.
 *
 *  rootChord   chord at the fuselage attachment
 *  tipChord    chord at the wingtip
 *  span        total wingspan (tip-to-tip)
 *  sweepBack   how far the leading edge slides toward +Z at the tip
 *  thickness   vertical thickness of the wing
 *  dihedral    radians; the tip is raised in +Y by tan(dihedral)·halfSpan
 *  color       Lambert material color
 */
function _wingHalf(side, { rootChord, tipChord, span, sweepBack, thickness, dihedral, color }) {
  const halfSpan = span / 2;
  const xRoot = 0;
  const xTip  = side * halfSpan;
  const zRootLE = -rootChord / 2;
  const zRootTE =  rootChord / 2;
  const zTipLE  = -rootChord / 2 + sweepBack;
  const zTipTE  = zTipLE + tipChord;
  const yTop = thickness / 2;
  const yBot = -thickness / 2;
  const tipDy = Math.tan(dihedral) * halfSpan;   // dihedral lift at tip

  // 8 vertices: 4 corners × top+bottom layers
  // 0: root LE top    4: root LE bot
  // 1: root TE top    5: root TE bot
  // 2: tip  TE top    6: tip  TE bot
  // 3: tip  LE top    7: tip  LE bot
  const v = new Float32Array([
    xRoot, yTop,         zRootLE,
    xRoot, yTop,         zRootTE,
    xTip,  yTop + tipDy, zTipTE,
    xTip,  yTop + tipDy, zTipLE,
    xRoot, yBot,         zRootLE,
    xRoot, yBot,         zRootTE,
    xTip,  yBot + tipDy, zTipTE,
    xTip,  yBot + tipDy, zTipLE,
  ]);
  const idx = [
    // top  (CCW from +Y)
    0, 1, 2,   0, 2, 3,
    // bottom (CCW from -Y → reverse top)
    4, 6, 5,   4, 7, 6,
    // leading edge (vertices 0, 3 top / 4, 7 bot)
    0, 3, 7,   0, 7, 4,
    // trailing edge (vertices 1, 2 top / 5, 6 bot)
    1, 5, 6,   1, 6, 2,
    // tip cap
    2, 6, 7,   2, 7, 3,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(v, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // Render both faces so the mirrored left-wing winding doesn't go dark.
  const mat = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });
  return new THREE.Mesh(geo, mat);
}

function _wing(opts) {
  const g = new THREE.Group();
  const right = _wingHalf( 1, opts);
  const left  = _wingHalf(-1, opts);
  // P2.T3: tag wing halves so _animateModel can deflect them as ailerons.
  // The wing-half geometry has its root at x=0 and tip at side*halfSpan, so
  // mesh.rotation.z pivots about the root for a visible wingtip tilt.
  right.userData.surface = "aileron-R";
  left.userData.surface  = "aileron-L";
  g.add(right); g.add(left);

  // P2.T3 nav lights at wingtips: red port (left), green starboard (right).
  // Sized as a fraction of the wing's thickness so it's visible at all scales.
  const halfSpan = opts.span / 2;
  const tipDy = Math.tan(opts.dihedral) * halfSpan;
  const tipZ  = -opts.rootChord / 2 + opts.sweepBack + opts.tipChord / 2;
  const lightSize = Math.max(0.12, opts.thickness * 1.2);
  const mkLight = (color, role) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(lightSize, lightSize, lightSize),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, fog: false }),
    );
    m.userData.navLight = role;
    return m;
  };
  const portLight = mkLight(0xff2233, "port");
  portLight.position.set(-halfSpan, tipDy, tipZ);
  const stbdLight = mkLight(0x33ff44, "starboard");
  stbdLight.position.set( halfSpan, tipDy, tipZ);
  g.add(portLight); g.add(stbdLight);

  return g;
}

/** Legacy name — kept so older callsites still resolve. Delegates to _wing. */
function _wingExtrusion(opts) {
  return _wing(opts);
}

/** Cabin window strip — row of small dark rectangles glued to fuselage side. */
function _windowStrip({ count = 8, spacing = 0.8, w = 0.25, h = 0.18 }) {
  const g = new THREE.Group();
  const mat = _mat(0x14202a);
  for (let i = 0; i < count; i++) {
    const wm = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.04), mat);
    wm.position.z = -((count - 1) / 2 - i) * spacing;
    g.add(wm);
  }
  return g;
}

/** Spinning propeller disc (visual blur). Returns a Group with two thin blades. */
function _prop({ diameter = 2.0, color = 0x202020, spinRate = 40 }) {
  const g = new THREE.Group();
  const blade1 = new THREE.Mesh(
    new THREE.BoxGeometry(diameter, 0.04, 0.18),
    _mat(color, { transparent: true, opacity: 0.55 }),
  );
  g.add(blade1);
  const blade2 = blade1.clone();
  blade2.rotation.y = Math.PI / 2;
  g.add(blade2);
  // Hub
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), _mat(0x111111));
  g.add(hub);
  // P2.T3 tag: Drone._animateModel spins this group around its local Y axis
  // every frame, scaled by spinRate and (for airplanes) throttle fraction.
  g.userData.isProp = true;
  g.userData.spinRate = spinRate;
  return g;
}

/** Tricycle landing gear: nose strut + 2 mains. */
function _tricycleGear({ noseZ, mainZ, mainSpread, dropY, wheelR = 0.18, tire = 0x111 }) {
  const g = new THREE.Group();
  const strutMat = _mat(0x555);
  const tireMat = _mat(tire);
  function strut(x, z) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, dropY, 8), strutMat);
    s.position.set(x, -dropY / 2, z);
    g.add(s);
    const w = new THREE.Mesh(new THREE.CylinderGeometry(wheelR, wheelR, 0.12, 12), tireMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, -dropY, z);
    g.add(w);
  }
  strut(0, noseZ);
  strut(-mainSpread, mainZ);
  strut( mainSpread, mainZ);
  return g;
}

function modelMavic3() {
  // DJI Mavic 3 — elongated, aerodynamic body (longer front-to-back than
  // wide), big Hasselblad dual-camera gimbal slung beneath the nose,
  // forward-swept X-arms extending well past the body, two trailing
  // antennas on the rear shoulders.
  const g = new THREE.Group();
  const carbon = new THREE.MeshPhongMaterial({ color: 0x1b1e24, shininess: 25, specular: 0x202428 });
  const lightGrey = _mat(0x3a3d44);
  const armMat = _mat(0x141618);
  const accent = _mat(0xc0c4cc);

  // Main fuselage — long, narrow capsule made from a stretched sphere +
  // belly box. Length 4.2, width 1.6, height 0.7.
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.8, 22, 14), carbon);
  body.scale.set(1.0, 0.45, 2.6);
  body.position.y = 0.15;
  g.add(body);
  // Belly fairing (where the gimbal mounts)
  const belly = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.35, 1.8), carbon);
  belly.position.set(0, -0.18, -0.3);
  g.add(belly);
  // Top deck cosmetic seam
  const seam = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 3.6), lightGrey);
  seam.position.y = 0.55;
  g.add(seam);

  // Hasselblad-style gimbal: a flat-edged housing with two big visible
  // lenses (main + tele) facing forward.
  const gimYoke = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.22, 0.32), lightGrey);
  gimYoke.position.set(0, -0.25, -1.5);
  g.add(gimYoke);
  const gimBox = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.55, 0.65), carbon);
  gimBox.position.set(0, -0.5, -1.65);
  g.add(gimBox);
  // Two camera barrels poking out the front of the gimbal
  for (const lens of [
    { x: -0.25, r: 0.18, len: 0.45 },     // Hasselblad main (larger)
    { x:  0.25, r: 0.13, len: 0.35 },     // Tele
  ]) {
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(lens.r, lens.r, lens.len, 16),
      _mat(0x0a0a0a),
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(lens.x, -0.5, -2.0);
    g.add(barrel);
    // Lens glass element (front)
    const glass = new THREE.Mesh(
      new THREE.CircleGeometry(lens.r * 0.85, 14),
      _glassMat(0x2a4a66, 0.92),
    );
    glass.position.set(lens.x, -0.5, -2.0 - lens.len / 2 - 0.01);
    glass.rotation.y = Math.PI;
    g.add(glass);
    // Lens ring
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(lens.r + 0.02, 0.025, 6, 18),
      accent.clone(),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(lens.x, -0.5, -2.0 - lens.len / 2);
    g.add(ring);
  }
  // "Hasselblad" stripe (orange) on the gimbal cube
  const hbStripe = new THREE.Mesh(new THREE.BoxGeometry(0.97, 0.08, 0.05), _mat(0xff7a00));
  hbStripe.position.set(0, -0.45, -1.98);
  g.add(hbStripe);

  // Front obstacle sensors (twin red dots) on the very nose
  for (const sx of [-0.45, 0.45]) {
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xff2828 }),
    );
    eye.position.set(sx, 0.05, -1.65);
    g.add(eye);
  }

  // X-arms: front arms swept FORWARD-out, rear arms swept BACKWARD-out.
  // Mavic 3 has a distinctive forward-tilted X.
  // Coordinates picked so arms extend ~1.8 m past the body.
  const armSpec = [
    { x:  2.0, z: -1.6 },   // FR
    { x: -2.0, z: -1.6 },   // FL
    { x:  2.0, z:  1.5 },   // RR
    { x: -2.0, z:  1.5 },   // RL
  ];
  for (const a of armSpec) {
    // Arm rod from body shoulder to motor pod
    const shoulderX = a.x * 0.18;
    const shoulderZ = a.z * 0.4;
    const len = Math.hypot(a.x - shoulderX, a.z - shoulderZ);
    const ang = Math.atan2(a.z - shoulderZ, a.x - shoulderX);
    const arm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.075, 0.075, len, 10),
      armMat,
    );
    arm.rotation.z = Math.PI / 2;
    arm.rotation.y = ang;
    arm.position.set((shoulderX + a.x) / 2, 0.05, (shoulderZ + a.z) / 2);
    g.add(arm);
    // Motor pod at the end of each arm
    const motor = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 0.28, 16),
      lightGrey,
    );
    motor.position.set(a.x, 0.18, a.z);
    g.add(motor);
    // Motor top cap (golden hub)
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 0.08, 12),
      _mat(0xc89232),
    );
    hub.position.set(a.x, 0.36, a.z);
    g.add(hub);
    // Translucent prop disc (motion blur)
    const prop = _prop({ diameter: 1.7, color: 0x4a4d52 });
    prop.position.set(a.x, 0.45, a.z);
    g.add(prop);
  }

  // Two rear antennas (whips sticking back+up from the rear shoulders)
  for (const sx of [-0.45, 0.45]) {
    const ant = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.7, 6),
      armMat,
    );
    ant.rotation.x = -0.5;     // angled back
    ant.position.set(sx, 0.55, 1.4);
    g.add(ant);
    const tipBulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 8, 6),
      _mat(0xff2828),
    );
    tipBulb.position.set(sx, 0.85, 1.7);
    g.add(tipBulb);
  }

  // Bottom landing legs (two small skids)
  for (const sx of [-0.45, 0.45]) {
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.42, 6),
      lightGrey,
    );
    leg.position.set(sx, -0.45, 0.7);
    g.add(leg);
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.06, 0.18),
      armMat,
    );
    pad.position.set(sx, -0.66, 0.7);
    g.add(pad);
  }
  return g;
}

function modelCessna172() {
  // Classic high-wing single-engine GA, white over blue trim.
  const g = new THREE.Group();
  const livWhite = 0xeef0f3, livBlue = 0x2a6fb5, accent = 0xc0c4cc;

  // Tapered fuselage (CylinderGeometry with different top/bottom radii gives a
  // narrowing tail-cone). Two stacked sections.
  const nose = new THREE.Mesh(
    new THREE.CylinderGeometry(0.65, 0.85, 3.2, 16),
    _mat(livWhite),
  );
  nose.rotation.x = Math.PI / 2;
  nose.position.z = -2.6;
  g.add(nose);
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.45, 1.45, 2.6),
    _mat(livWhite),
  );
  cabin.position.set(0, 0.05, -0.6);
  g.add(cabin);
  const tailCone = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7, 0.18, 5.0, 16),
    _mat(livWhite),
  );
  tailCone.rotation.x = Math.PI / 2;
  tailCone.position.z = 3.1;
  g.add(tailCone);
  // Blue trim stripe along the fuselage side
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.18, 7.5), _mat(livBlue));
  stripe.position.set(0.78, -0.15, 0.3);
  g.add(stripe);
  const stripeL = stripe.clone(); stripeL.position.x = -0.78; g.add(stripeL);

  // Engine cowling + spinner cone + spinning prop disc
  const cowl = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.65, 0.8, 14), _mat(livBlue));
  cowl.rotation.x = Math.PI / 2;
  cowl.position.z = -4.4;
  g.add(cowl);
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.7, 14), _mat(0xffffff));
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.z = -5.05;
  g.add(spinner);
  const prop = _prop({ diameter: 2.0, color: 0x222 });
  prop.rotation.x = Math.PI / 2;
  prop.position.z = -5.3;
  g.add(prop);

  // Window strip — black sides + windshield wedge
  const winL = _windowStrip({ count: 2, spacing: 0.9, w: 0.06, h: 0.6 });
  winL.position.set(0.73, 0.25, -0.6);
  g.add(winL);
  const winR = _windowStrip({ count: 2, spacing: 0.9, w: 0.06, h: 0.6 });
  winR.position.set(-0.73, 0.25, -0.6);
  g.add(winR);
  // Windshield (slanted front glass)
  const wsh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.65, 0.05), _glassMat(0x223344, 0.72));
  wsh.position.set(0, 0.32, -1.85);
  wsh.rotation.x = 0.45;
  g.add(wsh);

  // High wing with proper span + slight dihedral + flaps split
  const wing = _wingExtrusion({
    rootChord: 1.6, tipChord: 1.2, span: 11, sweepBack: 0.05, thickness: 0.18,
    dihedral: 0.025, color: livWhite,
  });
  wing.position.set(0, 0.85, -0.5);
  g.add(wing);
  // Wing strut on each side (diagonal from fuselage belly to mid-wing under)
  const strutMat = _mat(accent);
  for (const sx of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 2.6), strutMat);
    strut.position.set(sx * 1.3, 0.35, -0.4);
    strut.rotation.z = sx * 0.28;
    strut.rotation.y = sx * 0.1;
    g.add(strut);
  }

  // Horizontal stab + vertical stab (classic, not T-tail)
  const hstab = _wingExtrusion({
    rootChord: 0.9, tipChord: 0.55, span: 3.4, sweepBack: 0.08, thickness: 0.12,
    dihedral: 0.02, color: livWhite,
  });
  hstab.position.set(0, 0.5, 3.5);
  g.add(hstab);
  const vstab = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.3, 1.6), _mat(livWhite));
  vstab.position.set(0, 1.1, 3.4);
  vstab.geometry.translate(0, 0, -0.6); // anchor at leading edge
  g.add(vstab);
  // Tail blue trim
  const vstabAccent = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.5, 0.9), _mat(livBlue));
  vstabAccent.position.set(0, 1.4, 3.7);
  g.add(vstabAccent);

  // Tricycle landing gear — nosewheel near cowling, mains under wing root
  g.add(_tricycleGear({ noseZ: -3.6, mainZ: -0.2, mainSpread: 1.3, dropY: 0.85 }));
  return g;
}

function modelLearjet() {
  // Learjet 35: pointed nose, swept low wings with wingtip tip-tanks, twin
  // fuselage-mounted engines, T-tail. White over deep red trim.
  const g = new THREE.Group();
  const white = 0xfafafa, accent = 0xb01818, dark = 0x303440;

  // Pointed nose cone
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.55, 2.0, 18), _mat(white));
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -6.6;
  g.add(nose);
  // Main fuselage tube (cabin)
  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.55, 10.5, 18), _mat(white));
  fuse.rotation.x = Math.PI / 2;
  fuse.position.z = -0.4;
  g.add(fuse);
  // Tail boom taper
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.3, 3.0, 16), _mat(white));
  boom.rotation.x = Math.PI / 2;
  boom.position.z = 5.7;
  g.add(boom);
  // Red trim stripe
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.14, 12), _mat(accent));
  stripe.position.set(0.6, -0.15, -0.5);
  g.add(stripe);
  const stripeL = stripe.clone(); stripeL.position.x = -0.6; g.add(stripeL);

  // Windshield + cabin window strip
  const wsh = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.4, 0.05), _glassMat(0x223344, 0.7));
  wsh.position.set(0, 0.35, -5.4);
  wsh.rotation.x = 0.55;
  g.add(wsh);
  for (const sx of [-0.55, 0.55]) {
    const ws = _windowStrip({ count: 6, spacing: 0.6, w: 0.06, h: 0.18 });
    ws.position.set(sx, 0.05, -0.6);
    g.add(ws);
  }

  // Swept low wing with Learjet's signature wingtip TANKS
  const wing = _wingExtrusion({
    rootChord: 2.3, tipChord: 1.3, span: 11, sweepBack: 1.4, thickness: 0.16,
    dihedral: 0.04, color: white,
  });
  wing.position.set(0, -0.55, 0.4);
  g.add(wing);
  // Wingtip tip-tanks (small horizontal cylinders at the wing ends)
  for (const sx of [-1, 1]) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.6, 12), _mat(white));
    tank.rotation.x = Math.PI / 2;
    tank.position.set(sx * 5.5, -0.45, 1.6);
    g.add(tank);
    // Tank nose & tail caps
    const tankNose = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), _mat(white));
    tankNose.position.set(sx * 5.5, -0.45, 0.85);
    g.add(tankNose);
    const tankTail = tankNose.clone();
    tankTail.position.z = 2.35;
    g.add(tankTail);
    // Accent ring
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.1, 12), _mat(accent));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(sx * 5.5, -0.45, 1.0);
    g.add(ring);
  }

  // Twin rear-mounted engines (fuselage flanks)
  for (const sx of [-1, 1]) {
    const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.9, 16), _mat(dark));
    nacelle.rotation.x = Math.PI / 2;
    nacelle.position.set(sx * 1.05, 0.18, 4.2);
    g.add(nacelle);
    // Intake "fan" disc (dark with light rim)
    const fan = new THREE.Mesh(new THREE.CircleGeometry(0.36, 14), _mat(0x111));
    fan.position.set(sx * 1.05, 0.18, 3.25);
    fan.rotation.y = Math.PI;
    g.add(fan);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.04, 6, 18), _mat(0xc0c0c8));
    rim.rotation.x = Math.PI / 2;
    rim.position.set(sx * 1.05, 0.18, 3.27);
    g.add(rim);
    // Exhaust cone
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.4, 12), _mat(0x202028));
    exhaust.rotation.x = Math.PI / 2;
    exhaust.position.set(sx * 1.05, 0.18, 5.3);
    g.add(exhaust);
    // Pylon attaching engine to fuselage
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.55, 1.6), _mat(white));
    pylon.position.set(sx * 0.7, 0.18, 4.2);
    g.add(pylon);
  }

  // T-tail
  const vstab = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.2, 1.4), _mat(white));
  vstab.position.set(0, 1.2, 5.6);
  g.add(vstab);
  const vstabAcc = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.6, 0.6), _mat(accent));
  vstabAcc.position.set(0, 2.05, 5.7);
  g.add(vstabAcc);
  const hstab = _wingExtrusion({
    rootChord: 0.8, tipChord: 0.45, span: 3.0, sweepBack: 0.25, thickness: 0.08,
    dihedral: 0.03, color: white,
  });
  hstab.position.set(0, 2.3, 5.5);
  g.add(hstab);

  // Retracted-look gear hints (small fairings under fuselage)
  return g;
}

function modelBoeing777() {
  // Boeing 777-300ER (-ish): long wide-body fuselage, swept wings with raked
  // tips, two enormous under-wing GE90 nacelles, conventional tail (not T).
  // Full-size — intentionally larger than the other models to reflect the
  // real-world size difference between a widebody jet and a GA / bizjet.
  const g = new THREE.Group();
  const white = 0xfafbfc, lower = 0xdfe2ea, navy = 0x0c2353, accent = 0xd02020;

  // Nose cone (tapered cylinder fronted by half-sphere)
  const noseCone = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.3, 4.5, 18), _mat(white));
  noseCone.rotation.x = Math.PI / 2;
  noseCone.position.z = -12.5;
  g.add(noseCone);
  const noseTip = new THREE.Mesh(new THREE.SphereGeometry(1.0, 16, 12, 0, Math.PI*2, 0, Math.PI/2), _mat(0x202428));
  noseTip.rotation.x = -Math.PI / 2;
  noseTip.position.z = -14.6;
  g.add(noseTip);

  // Main barrel
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 18, 20), _mat(white));
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = -1.0;
  g.add(barrel);
  // Belly tone (slightly darker grey)
  const belly = new THREE.Mesh(
    new THREE.CylinderGeometry(1.41, 1.41, 18, 20, 1, false, -Math.PI/2 - 0.6, 1.2),
    _mat(lower),
  );
  belly.rotation.x = Math.PI / 2;
  belly.position.z = -1.0;
  g.add(belly);

  // Tapered tail cone
  const tailCone = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 0.45, 6, 18), _mat(white));
  tailCone.rotation.x = Math.PI / 2;
  tailCone.position.z = 11;
  g.add(tailCone);

  // Cockpit windshield (5-panel-ish wedge approximated as 2 boxes)
  const wsh = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.6, 0.06), _glassMat(0x14202e, 0.78));
  wsh.position.set(0, 0.55, -13.4);
  wsh.rotation.x = 0.55;
  g.add(wsh);

  // Cabin windows (10-window strip per side)
  const ws = _windowStrip({ count: 22, spacing: 0.7, w: 0.07, h: 0.18 });
  ws.position.set(1.42, 0.25, -1);
  g.add(ws);
  const ws2 = _windowStrip({ count: 22, spacing: 0.7, w: 0.07, h: 0.18 });
  ws2.position.set(-1.42, 0.25, -1);
  g.add(ws2);

  // Navy livery cheatline
  for (const sx of [-1, 1]) {
    const cheat = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 26), _mat(navy));
    cheat.position.set(sx * 1.43, 0.55, -1);
    g.add(cheat);
  }

  // Main wing — large swept planform with dihedral
  const wing = _wingExtrusion({
    rootChord: 5.4, tipChord: 1.8, span: 28, sweepBack: 4.0, thickness: 0.6,
    dihedral: 0.07, color: white,
  });
  wing.position.set(0, -0.7, 1.2);
  g.add(wing);
  // Raked wingtips (small swept extension)
  for (const sx of [-1, 1]) {
    const tip = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.18, 1.0), _mat(white));
    tip.position.set(sx * 14.2, -0.4, 3.6);
    tip.rotation.z = sx * 0.18;
    tip.rotation.y = sx * 0.55;
    g.add(tip);
  }

  // Two huge under-wing engines (GE90-style — very wide nacelles)
  for (const sx of [-1, 1]) {
    const px = sx * 6.5;
    const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 0.9, 4.0, 18), _mat(white));
    nacelle.rotation.x = Math.PI / 2;
    nacelle.position.set(px, -1.6, -0.5);
    g.add(nacelle);
    // Intake fan
    const fan = new THREE.Mesh(new THREE.CircleGeometry(0.95, 16), _mat(0x0d0d0d));
    fan.rotation.y = Math.PI;
    fan.position.set(px, -1.6, -2.45);
    g.add(fan);
    const fanRim = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.08, 8, 22), _mat(0x9095a0));
    fanRim.rotation.x = Math.PI / 2;
    fanRim.position.set(px, -1.6, -2.46);
    g.add(fanRim);
    // Engine pylon to wing
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.9, 1.4), _mat(white));
    pylon.position.set(px, -0.95, -0.6);
    g.add(pylon);
    // Exhaust nozzle
    const exh = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, 0.6, 14), _mat(0x2a2e35));
    exh.rotation.x = Math.PI / 2;
    exh.position.set(px, -1.6, 1.7);
    g.add(exh);
  }

  // Conventional tail — large vstab + low hstab (NOT T-tail)
  const vstab = new THREE.Mesh(new THREE.BoxGeometry(0.35, 4.5, 3.0), _mat(white));
  vstab.position.set(0, 1.7, 10.5);
  g.add(vstab);
  // Navy accent on tail fin
  const vstabAcc = new THREE.Mesh(new THREE.BoxGeometry(0.36, 2.0, 1.4), _mat(navy));
  vstabAcc.position.set(0, 3.0, 10.9);
  g.add(vstabAcc);
  // Red flash
  const vstabFlash = new THREE.Mesh(new THREE.BoxGeometry(0.37, 0.4, 1.0), _mat(accent));
  vstabFlash.position.set(0, 3.7, 10.7);
  g.add(vstabFlash);
  // Horizontal stab (just below tail fin, slight sweep + dihedral)
  const hstab = _wingExtrusion({
    rootChord: 2.4, tipChord: 0.85, span: 10.5, sweepBack: 1.8, thickness: 0.28,
    dihedral: 0.07, color: white,
  });
  hstab.position.set(0, 0.6, 11.2);
  g.add(hstab);

  return g;
}

function modelUFO() {
  // Classic flying saucer with brushed-metal hull, glowing cabin dome, two
  // rings of porthole lights, antenna sphere on top, tractor-beam projector.
  const g = new THREE.Group();
  const hullMat = new THREE.MeshPhongMaterial({
    color: 0xbfc8d6, shininess: 80, specular: 0xffffff,
  });

  // Lower saucer hull (flattened sphere)
  const hull = new THREE.Mesh(new THREE.SphereGeometry(3.2, 32, 14), hullMat);
  hull.scale.set(1, 0.28, 1);
  g.add(hull);
  // Equator ring (thicker, brass)
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(3.2, 0.22, 10, 36),
    _mat(0x6b5a30),
  );
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  // Inner brushed ring
  const ring2 = new THREE.Mesh(
    new THREE.TorusGeometry(2.4, 0.08, 8, 28),
    _mat(0x4a5a6a),
  );
  ring2.rotation.x = Math.PI / 2;
  ring2.position.y = -0.35;
  g.add(ring2);

  // Upper dome (cabin) — half-sphere with glass tint
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1.7, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    _glassMat(0x66ffcc, 0.55),
  );
  dome.position.y = 0.4;
  g.add(dome);
  // Dome base ring
  const domeRing = new THREE.Mesh(new THREE.TorusGeometry(1.72, 0.08, 8, 24), _mat(0x303a44));
  domeRing.rotation.x = Math.PI / 2;
  domeRing.position.y = 0.42;
  g.add(domeRing);

  // Two pilot silhouettes inside the dome (small dark blobs)
  for (const sx of [-0.55, 0.55]) {
    const pilot = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10), _mat(0x1a1f26));
    pilot.position.set(sx, 0.7, 0);
    g.add(pilot);
  }

  // Two rings of porthole lights — outer (8) + inner (8 offset)
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xffd24a });   // emissive look
  const lightMat2 = new THREE.MeshBasicMaterial({ color: 0x66e0ff });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), lightMat);
    light.position.set(Math.cos(a) * 3.05, -0.15, Math.sin(a) * 3.05);
    g.add(light);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), lightMat2);
    light.position.set(Math.cos(a) * 2.0, -0.55, Math.sin(a) * 2.0);
    g.add(light);
  }

  // Antenna on top with a glowing sphere
  const antennaRod = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.9, 6), _mat(0x303a44));
  antennaRod.position.y = 2.0;
  g.add(antennaRod);
  const antennaTip = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xff5050 }),
  );
  antennaTip.position.y = 2.55;
  g.add(antennaTip);

  // Underbelly tractor-beam emitter (cone) + halo ring
  const beamHousing = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.45, 0.5, 16), _mat(0x303a44));
  beamHousing.position.y = -0.75;
  g.add(beamHousing);
  const beamGlow = new THREE.Mesh(
    new THREE.ConeGeometry(0.55, 1.4, 18, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffe14a, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
  );
  beamGlow.position.y = -1.6;
  g.add(beamGlow);

  return g;
}

/** Choose model per preset id. Order matches SPEED_PRESETS. */
function buildAircraftModel(presetId) {
  switch (presetId) {
    case "1x":         return modelMavic3();
    case "cessna172":  return modelCessna172();
    case "learjet":    return modelLearjet();
    case "b777":       return modelBoeing777();
    case "100x":
    default:           return modelUFO();
  }
}

/** Chase-cam distance multiplier per preset (Mavic 3 tight; 777 wide). */
function thirdPersonScaleForPreset(presetId) {
  switch (presetId) {
    case "1x":         return 0.4;   // Mavic 3 — close behind
    case "cessna172":  return 1.0;
    case "learjet":    return 1.3;
    case "b777":       return 3.5;   // full-size model — needs a wide pull-back
    case "100x":
    default:           return 0.9;
  }
}

/**
 * Absolute cruise speeds (km/h) per preset button.
 *  - `kmh`     : cruise / hover-max
 *  - `minKmh`  : minimum forward speed for fixed-wing — at or below stall+10%
 *                airplanes cannot stop or reverse; drone/UFO use 0 (can hover).
 *  - `model`   : flight model ("free" = 6-DoF strafing; "airplane" = always-
 *                forward + ailerons).
 *  - `display` : friendly label for HUD/captions.
 */
export const SPEED_PRESETS = [
  { id: "1x",        label: "1×",         kmh: 50,     minKmh: 0,   model: "free",     display: "Mavic 3 drone", boostCap: 4   },
  { id: "cessna172", label: "Cessna 172", kmh: 226,    minKmh: 130, model: "airplane", display: "Cessna 172",    boostCap: 1.5 },
  { id: "learjet",   label: "Learjet",    kmh: 850,    minKmh: 240, model: "airplane", display: "Learjet",       boostCap: 1.1 },
  { id: "b777",      label: "Boeing 777", kmh: 920,    minKmh: 370, model: "airplane", display: "Boeing 777",    boostCap: 1.0 },
  { id: "100x",      label: "100×",       kmh: 10_000, minKmh: 0,   model: "free",     display: "UFO",           boostCap: 5   },
];

export function presetById(id) {
  return SPEED_PRESETS.find((p) => p.id === id) ?? SPEED_PRESETS[0];
}

export class Drone {
  constructor(camera, domElement) {
    this.camera = camera;
    this.dom = domElement;

    this.position = new THREE.Vector3(0, 200, 0);
    this.bodyYaw = 0;
    this.bodyPitch = 0;
    this.bodyRoll = 0;
    this.yaw = 0;
    this.pitch = 0;

    // Aircraft body — switches model by speed preset (Mavic 3 / Cessna /
    // Learjet / 777 / UFO). Container is always added to the scene;
    // inner model is swapped on setSpeedPreset(). Hidden in 1st-person view.
    this.mesh = new THREE.Group();
    this._currentModel = null;
    this._buildModelForPreset("100x");

    this.keys = new Set();
    this.hover = false;
    this.locked = false;
    this.speedPresetId = "100x";
    this.cruiseSpeedMs = presetById("100x").kmh * KMH_TO_MS;
    this.currentSpeed = 0;
    this.flightLocked = false;

    /**
     * Effective flight mode (FlightMode enum from ./modes.js). Honours Easy
     * Mode, so this is HOVERCRAFT by default until the user presses M.
     * Dispatch lives in update() below.
     */
    this.flightMode = resolveMode("100x");
    /** Smoothed forward airspeed (m/s) for airplane mode. */
    this.airspeedMs = presetById("100x").kmh * KMH_TO_MS;
    /** Target roll (rad) commanded by A/D in airplane mode. */
    this._targetRoll = 0;
    /** Global pause flag — `P` key / Pause button. Freezes everything except UI. */
    this.paused = false;
    this.identifyMode = false;
    /** @type {null | 'down' | 'left' | 'right'} */
    this.cameraMode = null;
    /** 'first' (in-cockpit) or 'third' (chase cam). */
    this.viewPerson = "first";
    this.onIdentifyToggle = null;
    this.onCameraModeChange = null;
    this.onViewPersonChange = null;
    this.onPauseChange = null;
    this.onPresetKeySwitch = null;     // notify UI to sync speed buttons
    this.onFlightModeChange = null;    // notify UI when flightMode resolves to a different value

    // Hoisted scratch vectors — avoid per-frame allocation in hot paths.
    this._fwdVec = new THREE.Vector3();
    this._rightVec = new THREE.Vector3();
    this._moveVec = new THREE.Vector3();

    this._bindEvents();
  }

  // ---------------- Aircraft models ----------------
  /** Build a tiny, recognisable, "cute" aircraft per preset. */
  _buildModelForPreset(presetId) {
    if (this._currentModel) {
      this.mesh.remove(this._currentModel);
      this._currentModel.traverse?.((o) => {
        o.geometry?.dispose?.();
        if (o.material) {
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
        }
      });
    }
    const model = buildAircraftModel(presetId);
    // viewPerson may still be undefined when called from the constructor
    // (constructor calls this BEFORE setting viewPerson). Treat undefined as
    // first-person → invisible chase mesh.
    model.visible = (this.viewPerson === "third");
    this.mesh.add(model);
    this._currentModel = model;
  }

  _applyCameraMode() {
    if (this.cameraMode === "down") {
      this.yaw = this.bodyYaw;
      this.pitch = DOWN_PITCH;
    } else if (this.cameraMode === "left") {
      this.yaw = this.bodyYaw - Math.PI / 2;
      this.pitch = -0.06;
    } else if (this.cameraMode === "right") {
      this.yaw = this.bodyYaw + Math.PI / 2;
      this.pitch = -0.06;
    } else {
      this.yaw = this.bodyYaw;
      this.pitch = this.bodyPitch;
    }
  }

  _viewModeFromKey(key) {
    if (key === "arrowdown") return "down";
    if (key === "arrowleft") return "left";
    if (key === "arrowright") return "right";
    return null;
  }

  _setCameraMode(mode) {
    const next = this.cameraMode === mode ? null : mode;
    this.cameraMode = next;
    this._applyCameraMode();
    this._syncCamera();
    this.onCameraModeChange?.(this.cameraMode);
  }

  _syncCamera() {
    // Aircraft mesh always sits at the body position.
    this.mesh.position.copy(this.position);
    this.mesh.rotation.order = "YXZ";
    this.mesh.rotation.y = this.bodyYaw;
    this.mesh.rotation.x = this.bodyPitch;
    this.mesh.rotation.z = this.bodyRoll;     // airplane bank visible in 3rd-person

    // Camera position: 1st-person = at body; 3rd-person = chase from behind.
    if (this.viewPerson === "third") {
      const scale = thirdPersonScaleForPreset(this.speedPresetId);
      const back = THIRD_PERSON_BASE.back * scale;
      const up = THIRD_PERSON_BASE.up * scale;
      // Chase vector: behind aircraft (along +Z in body local → world via yaw/pitch),
      // raised by `up`. Camera yaw matches body yaw so the aircraft fills the frame.
      const yaw = this.bodyYaw;
      const pitch = this.bodyPitch;
      const cosP = Math.cos(pitch), sinP = Math.sin(pitch);
      // Forward unit vec (same as Drone.forward())
      const fx = -Math.sin(yaw) * cosP;
      const fy =  sinP;
      const fz = -Math.cos(yaw) * cosP;
      this.camera.position.set(
        this.position.x - fx * back,
        this.position.y - fy * back + up,
        this.position.z - fz * back,
      );
      this.camera.rotation.order = "YXZ";
      this.camera.rotation.y = yaw;
      this.camera.rotation.x = pitch - 0.05;   // slight tilt-down so aircraft sits high in frame
    } else {
      this.camera.position.copy(this.position);
      this.camera.rotation.order = "YXZ";
      this.camera.rotation.y = this.yaw;
      this.camera.rotation.x = this.pitch;
    }
  }

  setViewPerson(person) {
    const next = (person === "third") ? "third" : "first";
    if (next === this.viewPerson) return;
    this.viewPerson = next;
    if (this._currentModel) this._currentModel.visible = (next === "third");
    this._syncCamera();
    this.onViewPersonChange?.(next);
  }

  toggleViewPerson() {
    this.setViewPerson(this.viewPerson === "first" ? "third" : "first");
  }

  _bindEvents() {
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if (k === "i") {
        // Identify is suppressed while the tour is running — the tour owns the
        // highlight/narration loop and identify would race with it.
        if (this.flightLocked) {
          e.preventDefault();
          return;
        }
        this.identifyMode = !this.identifyMode;
        this.onIdentifyToggle?.(this.identifyMode);
        e.preventDefault();
        return;
      }
      const viewMode = this._viewModeFromKey(k);
      if (viewMode) {
        this._setCameraMode(viewMode);
        e.preventDefault();
        return;
      }
      // 'V' = toggle 1st ↔ 3rd person chase cam. Works in tour too — handy for
      // sightseeing the orbit, doesn't fight the tour's drone control because
      // it only swaps camera placement, not body position.
      if (k === "v") {
        this.toggleViewPerson();
        e.preventDefault();
        return;
      }
      // 'P' = pause/resume simulation (drone, tour, flyTo). UI also wires a
      // Pause button in the telemetry HUD that mirrors this.
      if (k === "p") {
        this.paused = !this.paused;
        this.onPauseChange?.(this.paused);
        e.preventDefault();
        return;
      }
      // 'K' = toggle Easy Mode (Hovercraft) ↔ Realistic. Re-resolve the
      // current preset through resolveMode() so flightMode reflects the new
      // EasyMode flag and the UI mode chip refreshes via onFlightModeChange.
      // Note: the playbook P0.T6 spec said "M", but M was already bound to
      // ui.toggleMapPrimary; K was the next unused mnemonic ("Kinematic").
      if (k === "k") {
        EasyMode.enabled = !EasyMode.enabled;
        this.setSpeedPreset(this.speedPresetId);
        e.preventDefault();
        return;
      }
      // 1..5 → select aircraft preset in the same order as SPEED_PRESETS.
      // 1 Mavic 3 · 2 Cessna · 3 Learjet · 4 B777 · 5 UFO.
      if (k >= "1" && k <= "5") {
        const idx = parseInt(k, 10) - 1;
        const preset = SPEED_PRESETS[idx];
        if (preset) {
          this.setSpeedPreset(preset.id);
          this.onPresetKeySwitch?.(preset.id);
        }
        e.preventDefault();
        return;
      }
      if (this.flightLocked) return;
      this.keys.add(k);
      if (k === " ") {
        this.hover = !this.hover;
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", (e) => {
      if (this.flightLocked) return;
      const k = e.key.toLowerCase();
      if (this._viewModeFromKey(k)) return;
      this.keys.delete(k);
    });
    window.addEventListener("blur", () => { this.keys.clear(); });

    this.dom.addEventListener("click", () => {
      this.dom.requestPointerLock?.();
    });
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === this.dom;
    });

    let dragging = false;
    this.dom.addEventListener("mousedown", () => { dragging = true; });
    window.addEventListener("mouseup", () => { dragging = false; });
    document.addEventListener("mousemove", (e) => {
      if (this.cameraMode) return;
      if (this.locked || dragging) {
        this.bodyYaw -= e.movementX * MOUSE_SENSITIVITY;
        this.bodyPitch -= e.movementY * MOUSE_SENSITIVITY;
        this.bodyPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.bodyPitch));
        this.yaw = this.bodyYaw;
        this.pitch = this.bodyPitch;
      }
    });
  }

  forward() {
    const yaw = this.bodyYaw;
    const pitch = this.cameraMode === "down" ? 0 : this.bodyPitch;
    return this._fwdVec.set(
      -Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch),
    );
  }

  right() {
    return this._rightVec.set(Math.cos(this.bodyYaw), 0, -Math.sin(this.bodyYaw));
  }

  headingDeg() {
    let h = (-this.bodyYaw * 180) / Math.PI;
    h = ((h % 360) + 360) % 360;
    return h;
  }

  setSpeedPreset(id) {
    const p = presetById(id);
    const changed = (this.speedPresetId !== p.id);
    this.speedPresetId = p.id;
    this.cruiseSpeedMs = p.kmh * KMH_TO_MS;
    const prevMode = this.flightMode;
    this.flightMode = resolveMode(p.id);
    const modeChanged = prevMode !== this.flightMode;
    // Airplane mode: lock airspeed to cruise on preset change; level the bank.
    if (this.flightMode === FlightMode.AIRPLANE) {
      this.airspeedMs = p.kmh * KMH_TO_MS;
      this._targetRoll = 0;
      this.bodyRoll = 0;
      this.hover = false;  // hover meaningless for fixed-wing
    } else {
      this.bodyRoll = 0;   // hovercraft / drone / UFO stay level
      this._targetRoll = 0;
    }
    if (changed) {
      this._buildModelForPreset(p.id);
      if (this.viewPerson === "third") this._syncCamera();
    }
    if (modeChanged) this.onFlightModeChange?.(this.flightMode);
  }

  /** @deprecated use setSpeedPreset */
  setSpeedMultiplier() {}

  activePreset() {
    return presetById(this.speedPresetId);
  }

  // P3.T1: physics integration runs at fixed 120 Hz from main.js. Anything
  // that advances state (mode dispatch, position clamp) lives here so frame
  // rate cannot change motion per wall-second.
  physicsStep(dt) {
    if (this.flightLocked || this.paused) return;

    switch (this.flightMode) {
      case FlightMode.AIRPLANE:
        this._updateAirplane(dt);
        break;
      case FlightMode.HOVERCRAFT:
      case FlightMode.DRONE:
      case FlightMode.UFO:
      default:
        this._updateHovercraft(dt);
        break;
    }

    if (this.position.y < 1) this.position.y = 1;
  }

  // P3.T1: per-frame, non-physics work — camera follow + model animation.
  // Called once per rAF tick with variable dt; physicsStep handles integration.
  update(dt) {
    if (this.flightLocked) {
      this.currentSpeed = 0;
      return;
    }
    if (this.paused) {
      this.currentSpeed = 0;
      this._syncCamera();
      return;
    }

    if (this.cameraMode) this._applyCameraMode();
    this._syncCamera();
    this._animateModel(dt);
  }

  /**
   * P2.T3: per-frame model animation.
   *   - Spin every group tagged userData.isProp around its local Y axis,
   *     scaled by spinRate and (for airplanes) by the current throttle
   *     fraction so a parked airplane's prop slows to idle.
   *   - For AIRPLANE mode, deflect aileron-tagged wing halves around their
   *     root by the current roll command (A/D keys).
   *   - Pulse nav-light opacity in a 1.5 s sine cycle (red/green wingtip
   *     lights from _wing()). Cheap, no extra geometry.
   */
  _animateModel(dt) {
    const model = this._currentModel;
    if (!model || !model.visible) return;
    const t = (this._navLightT = (this._navLightT ?? 0) + dt);

    // Throttle fraction drives prop spin for airplanes; non-airplane presets
    // (Mavic, UFO) just spin at full nominal rate.
    let throttle = 1;
    if (this.flightMode === FlightMode.AIRPLANE) {
      const preset = presetById(this.speedPresetId);
      const maxMs = preset.kmh * KMH_TO_MS;
      throttle = Math.max(0.15, Math.min(this.airspeedMs / maxMs, 1.2));
    }

    // Aileron deflection from keyboard input — only meaningful in AIRPLANE
    // mode; hovercraft uses strafing, no ailerons.
    let aileron = 0;
    if (this.flightMode === FlightMode.AIRPLANE) {
      if (this.keys.has("a")) aileron += 1;
      if (this.keys.has("d")) aileron -= 1;
    }
    const aileronAngle = aileron * 0.18;     // visible but subtle wing flex
    const navPulse = 0.4 + 0.6 * Math.abs(Math.sin(t * 3.5));

    model.traverse((child) => {
      if (child.userData?.isProp) {
        child.rotation.y += (child.userData.spinRate ?? 40) * dt * throttle;
      }
      if (child.userData?.surface === "aileron-R") {
        child.rotation.z = -aileronAngle;     // right wing tip up = roll left
      } else if (child.userData?.surface === "aileron-L") {
        child.rotation.z =  aileronAngle;     // left wing tip up = roll right
      }
      if (child.userData?.navLight && child.material) {
        child.material.opacity = navPulse;
      }
    });
  }

  /**
   * Hovercraft (Easy Mode default): kinematic 6-DoF strafe — go in any
   * direction, no inertia. Also the fallback for DRONE / UFO modes until
   * Phase 3 replaces it with a real second-order controller.
   */
  _updateHovercraft(dt) {
    const preset = presetById(this.speedPresetId);
    const cappedBoost = Math.min(BOOST_FACTOR, preset.boostCap ?? BOOST_FACTOR);
    const boostMult = this.keys.has("shift") ? cappedBoost : 1;
    const precisionMult = this.keys.has("control") ? 1 / 3 : 1;  // Ctrl = fine positioning
    const speed = this.cruiseSpeedMs * boostMult * precisionMult;
    const fwd = this.forward();
    const rt = this.right();

    const move = this._moveVec.set(0, 0, 0);
    let vy = 0;

    if (!this.hover) {
      if (this.keys.has("w")) move.add(fwd);
      if (this.keys.has("s")) move.sub(fwd);
      if (this.keys.has("a")) move.sub(rt);
      if (this.keys.has("d")) move.add(rt);

      if (this.keys.has("e")) vy += 1;
      if (this.keys.has("q")) vy -= 1;
    }

    if (move.lengthSq() > 0) move.normalize();
    move.multiplyScalar(speed * dt);
    this.position.add(move);
    this.position.y += vy * speed * dt;

    const horiz = move.length() / Math.max(dt, 1e-6);
    const vert = Math.abs(vy * speed);
    this.currentSpeed = Math.hypot(horiz, vert);
  }

  /**
   * Fixed-wing physics: aircraft is always moving forward at or above the
   * preset's `minKmh` floor (no stop, no reverse). A/D bank the wings (roll),
   * which produces a coordinated yaw rate (level-turn equation, simplified).
   * W/S adjust throttle within `[minKmh, kmh × boost]`. Q/E pitch up/down.
   */
  _updateAirplane(dt) {
    const preset = presetById(this.speedPresetId);
    const minMs = (preset.minKmh ?? 0) * KMH_TO_MS;
    const maxMs = preset.kmh * KMH_TO_MS * (this.keys.has("shift") ? Math.min(BOOST_FACTOR, preset.boostCap ?? BOOST_FACTOR) : 1);

    // ---- Throttle (W = up, S = down) ----
    const throttleRate = (maxMs - minMs) * 0.6;       // reach min↔max in ~1.7 s
    if (this.keys.has("w")) this.airspeedMs += throttleRate * dt;
    if (this.keys.has("s")) this.airspeedMs -= throttleRate * dt;
    if (this.airspeedMs < minMs) this.airspeedMs = minMs;
    if (this.airspeedMs > maxMs) this.airspeedMs = maxMs;

    // ---- Roll command (A/D ailerons) ----
    const ROLL_MAX = (45 * Math.PI) / 180;     // ±45° bank limit
    const ROLL_RATE = (90 * Math.PI) / 180;    // 90°/s commanded roll rate
    let rollCmd = 0;
    if (this.keys.has("a")) rollCmd += 1;   // left aileron → left bank → turn left
    if (this.keys.has("d")) rollCmd -= 1;   // right aileron → right bank → turn right
    if (rollCmd !== 0) {
      this._targetRoll += rollCmd * ROLL_RATE * dt;
    } else {
      // No input → roll target eases back to wings-level.
      this._targetRoll *= Math.max(0, 1 - dt * 1.2);
    }
    this._targetRoll = Math.max(-ROLL_MAX, Math.min(ROLL_MAX, this._targetRoll));
    // Roll axis smoothing: lerp current toward target.
    this.bodyRoll += (this._targetRoll - this.bodyRoll) * Math.min(1, dt * 4.5);

    // ---- Pitch (Q = down, E = up — keeps "Q/E = down/up" parity with free) ----
    const PITCH_RATE = (35 * Math.PI) / 180;   // 35°/s
    let pitchCmd = 0;
    if (this.keys.has("e")) pitchCmd += 1;
    if (this.keys.has("q")) pitchCmd -= 1;
    this.bodyPitch += pitchCmd * PITCH_RATE * dt;
    this.bodyPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.bodyPitch));

    // ---- Yaw rate from bank (level turn equation, simplified for sim) ----
    // ω = g · tan(bank) / v.  Clamped so very-slow flight doesn't spin.
    const v = Math.max(this.airspeedMs, 20);
    const yawRate = (9.81 * Math.tan(this.bodyRoll)) / v;
    this.bodyYaw += yawRate * dt;

    // ---- Translation: always forward at current airspeed ----
    const fwd = this.forward();
    this.position.x += fwd.x * this.airspeedMs * dt;
    this.position.y += fwd.y * this.airspeedMs * dt;
    this.position.z += fwd.z * this.airspeedMs * dt;

    this.currentSpeed = this.airspeedMs;
  }

  snapshot() {
    return {
      x: this.position.x,
      y: this.position.y,
      z: this.position.z,
      yaw: this.bodyYaw,
      pitch: this.bodyPitch,
      speedPresetId: this.speedPresetId,
      hover: this.hover,
      cameraMode: this.cameraMode,
      bodyRoll: this.bodyRoll,
    };
  }

  restore(s) {
    if (!s) return;
    this.bodyYaw = s.yaw;
    this.bodyPitch = s.pitch;
    this.cameraMode = s.cameraMode ?? null;
    this.teleport(s.x, s.y, s.z, s.yaw, s.pitch);
    if (s.speedPresetId) this.setSpeedPreset(s.speedPresetId);
    else if (s.speedMultiplier) {
      const map = { 1: "1x", 5: "cessna172", 20: "learjet", 50: "b777", 100: "100x" };
      this.setSpeedPreset(map[s.speedMultiplier] ?? "100x");
    }
    // bodyRoll must be applied AFTER teleport() and setSpeedPreset(): the latter
    // resets bodyRoll/_targetRoll to 0 when switching presets, so a banked
    // snapshot would otherwise level out.
    this.bodyRoll = s.bodyRoll ?? 0;
    this._targetRoll = this.bodyRoll;
    this.hover = s.hover ?? false;
    this._applyCameraMode();
  }

  teleport(x, y, z, yawRad = 0, pitchRad = -0.1) {
    this.position.set(x, y, z);
    this.bodyYaw = yawRad;
    this.bodyPitch = pitchRad;
    if (this.cameraMode == null) {
      this.yaw = yawRad;
      this.pitch = pitchRad;
    } else {
      this._applyCameraMode();
    }
    this._syncCamera();
  }
}
