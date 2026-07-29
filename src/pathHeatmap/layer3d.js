import * as THREE from "three";
import { geoToWorld } from "../coords.js";
import { BBOX } from "./gridMath.js";
import { worldBoundsFromBbox } from "./layer2d.js";

const PLANE_Y_AMSL = 2;

function makeTexture(uint8, cols, rows) {
  const tex = new THREE.DataTexture(
    uint8,
    cols,
    rows,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  // Heat RGBA from densityToRgba is sRGB; matches renderer.outputColorSpace.
  tex.colorSpace = THREE.SRGBColorSpace;
  // flipY left at THREE default (true): south-first row0 → plane south (+Z) edge
  // after XZ rotation. Layer2D flips rows on canvas instead — same RGBA buffer.
  tex.needsUpdate = true;
  return tex;
}

export class HeatLayer3D {
  constructor(scene) {
    const { minX, minZ, maxX, maxZ } = worldBoundsFromBbox(BBOX, geoToWorld);
    const width = maxX - minX;
    const depth = maxZ - minZ;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;

    this._texture = makeTexture(new Uint8Array(4), 1, 1);

    const mat = new THREE.MeshBasicMaterial({
      map: this._texture,
      transparent: true,
      depthWrite: false,
      opacity: 1,
    });

    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);

    this._mesh = new THREE.Mesh(geo, mat);
    this._mesh.position.set(cx, PLANE_Y_AMSL, cz);
    this._mesh.scale.set(width, depth, 1);

    this.group = new THREE.Group();
    this.group.visible = false;
    this.group.add(this._mesh);
    scene.add(this.group);
  }

  setOpacity(n) {
    this._mesh.material.opacity = Math.max(0, Math.min(1, n));
  }

  setVisible(on) {
    this.group.visible = !!on;
  }

  // South-row-first RGBA from densityToRgba (row0 = lamin); no row flip here.
  setTextureRGBA(uint8, cols, rows) {
    if (!uint8 || !cols || !rows) {
      this._replaceTexture(makeTexture(new Uint8Array(4), 1, 1));
      return;
    }
    const t = this._texture;
    if (t.image.width !== cols || t.image.height !== rows) {
      this._replaceTexture(makeTexture(uint8, cols, rows));
      return;
    }
    t.image.data.set(uint8);
    t.needsUpdate = true;
  }

  _replaceTexture(next) {
    this._texture.dispose();
    this._texture = next;
    this._mesh.material.map = next;
    this._mesh.material.needsUpdate = true;
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this._texture.dispose();
    this._mesh.geometry.dispose();
    this._mesh.material.dispose();
  }
}
