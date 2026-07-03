// gfx.js — gated bloom overlay (Betterment-11 §0.5.7 T11).
//
// ARCHITECTURE NOTE (measured, not assumed): the playbook's initial
// RenderPass→UnrealBloom→OutputPass chain renders the scene into a linear
// half-float target and grades at the end. That composites the sim's many
// TRANSLUCENT airspace fills in linear space, where the legacy path blends
// them in display space — measured on the day scene as a 47%-of-pixels
// divergence (mean Δ18, max Δ98) concentrated wherever fills overlay sky,
// while opaque terrain matched byte-exactly. No bloom parameter fixes that;
// it is inherent to full-chain linear compositing. So instead:
//
//   1. renderer.render(scene, camera)   ← the EXACT legacy frame, canvas MSAA,
//                                          logdepth, display-space blending.
//   2. copyFramebufferToTexture         ← grab that finished frame.
//   3. TexturePass → UnrealBloomPass    ← compute bloom FROM the display-space
//      (renderToScreen)                    frame and composite base+bloom back.
//
// Day parity is exact by construction (the base IS the legacy frame; with
// nothing over the bloom threshold the composite is a copy). The two B10
// risk items — composer×MSAA and composer×logdepth×additive-points — vanish
// because the scene never renders into a render target. Trade: the bloom
// threshold works on display-space luminance (post-tonemap), so it sits high
// (0.97): only near-saturated pixels — additive night city lights, tracers,
// beacons, the sun disc, fresnel hot edges — bloom. Passes imported from the
// SAME pinned three@0.170.0 the importmap already maps `three/addons/` to
// (no vendored copy: the whole three core is CDN-pinned in this repo).
//
// Gate: "Enhanced graphics" checkbox (WORLD) → kuson.gfx.v1 {composer:true},
// default ON. OFF — or ANY construction/render error (SwiftShader, exotic
// GL) — falls back to the bare legacy render call, warning once.
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { TexturePass } from "three/addons/postprocessing/TexturePass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { CopyShader } from "three/addons/shaders/CopyShader.js";
import * as THREE from "three";

const LS_KEY = "kuson.gfx.v1";
const DEFAULT_GFX = { composer: true };

export function getGfxSettings() {
  try {
    const raw = globalThis.localStorage?.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_GFX };
    return { ...DEFAULT_GFX, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_GFX };
  }
}

export function setGfxSettings(patch) {
  const next = { ...getGfxSettings(), ...patch };
  try {
    globalThis.localStorage?.setItem(LS_KEY, JSON.stringify(next));
  } catch { /* private mode — in-memory only */ }
  return next;
}

// Display-space bloom tuning (see architecture note). Measured: the DAY sky
// (lum ≈0.94) is BRIGHTER than the night city lights (warm ≈0.80), so no
// single threshold separates them — bloom is therefore NIGHT-GATED:
// effective strength = strength × nightFactor, and the whole overlay is
// skipped below nf 0.05 (day output = the bare legacy frame, parity by
// construction, zero overlay cost). Threshold 0.62 catches the warm light
// carpet, beacons, tracers and the T12 moon/stars; dusk (nf ≈ 0.5) gets a
// gentle scaled glow on the bright horizon, signed off visually at C4.
// C4 retune: threshold 0.62 also caught volume fresnel rims + the dusk haze
// band and, combined with the pre-fix city-cluster saturation, detonated
// horizon-wide white blobs. 0.80 releases the rims; saturated light cores,
// the moon and tracers still cross it.
export const BLOOM = { strength: 0.4, radius: 0.4, threshold: 0.8 };

/**
 * @param {{ renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera }} deps
 */
export function installGfx({ renderer, scene, camera }) {
  let composer = null;
  let bloom = null;
  let copyTex = null;        // FramebufferTexture at drawing-buffer size
  let broken = false;
  let enabled = !!getGfxSettings().composer;
  let warned = false;
  let curW = 0, curH = 0;    // logical size; captured lazily from the canvas
  let nightSrc = null;       // () => nightFactor 0..1 — wired in bootstrap

  function _warnOnce(err) {
    if (warned) return;
    warned = true;
    console.warn("[gfx] bloom overlay disabled — direct render only:", err);
  }

  function _dispose() {
    copyTex?.dispose();
    composer?.dispose?.();
    composer = null; bloom = null; copyTex = null;
  }

  function _build() {
    const pr = renderer.getPixelRatio();
    curW = renderer.domElement.width / pr;
    curH = renderer.domElement.height / pr;
    // Frame copy target — must match the drawing buffer in DEVICE pixels.
    copyTex = new THREE.FramebufferTexture(Math.round(curW * pr), Math.round(curH * pr));
    composer = new EffectComposer(renderer);
    composer.setPixelRatio(pr);
    composer.setSize(curW, curH);
    const texPass = new TexturePass(copyTex);
    composer.addPass(texPass);
    bloom = new UnrealBloomPass(
      new THREE.Vector2(curW, curH),
      BLOOM.strength, BLOOM.radius, BLOOM.threshold
    );
    composer.addPass(bloom);
    // Final raw copy to screen. NOT optional: if UnrealBloomPass itself is
    // the screen pass, it blits the base via an internal MeshBasicMaterial —
    // a BUILT-IN material, which the renderer tone-maps + sRGB-encodes again
    // when the target is the canvas (r170 WebGLPrograms gates grading on
    // renderTarget===null), double-grading our already-display-space base
    // (measured: uniform ≈+19/255 veil). CopyShader is a raw ShaderMaterial
    // with no grading chunks, so the composite reaches the canvas untouched;
    // the bloom pass, no longer last, additively composites into the
    // readBuffer instead of the screen.
    composer.addPass(new ShaderPass(CopyShader));
  }

  return {
    render() {
      // The base frame is ALWAYS the exact legacy call.
      renderer.render(scene, camera);
      if (!enabled || broken) return;
      const nf = nightSrc ? nightSrc() : 0;
      if (nf < 0.05) return;   // day/dusk floor: legacy frame IS the output
      try {
        if (!composer) _build();
        bloom.strength = BLOOM.strength * nf;
        renderer.copyFramebufferToTexture(copyTex);
        composer.render();
      } catch (err) {
        broken = true;
        _dispose();
        _warnOnce(err);
      }
    },
    setNightSource(fn) { nightSrc = fn; },
    setEnabled(on) {
      enabled = !!on;
      setGfxSettings({ composer: enabled });
    },
    resize() {
      // Sizes are re-derived from the canvas on the next enabled render.
      if (composer) _dispose();
    },
    isActive() { return enabled && !broken && !!composer; },
    bloomPass: () => bloom,
  };
}
