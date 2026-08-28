// test/e2e/teleport-nan.test.mjs — state_TODO §3: large teleports must never
// bake NaN into ground-tile geometry (THREE "computeBoundingSphere():
// Computed radius is NaN" console spam).
//
// Root cause (fixed in src/ground.js + src/terrain.js): a teleport outside
// the Web-Mercator latitude domain (|lat| > 90°, e.g. a runaway/staged
// warp) makes latToTileY() return NaN; DynamicGround.updateAround() then
// built tiles from NaN indices → tileYToLat(NaN) → NaN plane width/height →
// PlaneGeometry positions full of NaN → one THREE console error per NaN
// tile per rendered frame. Once the elevation grid had streamed in,
// elevationAt(NaN, NaN) slipped past its range guard (NaN fails `fy < 0`)
// and baked NaN vertex heights on top. This spec drives that exact repro
// with the terrain data DELAYED, so both sides of the load gap are covered:
// teleport far during the gap, let the grid arrive while still far out,
// then warp back inside coverage and prove the sim still runs on real
// elevations with zero NaN errors.

import test from "node:test";
import assert from "node:assert/strict";
import { launchSim, waitForSim, dismissStartScreen } from "./harness.mjs";

const NAN_ERR = /computeBoundingSphere|Computed radius is NaN/i;

/** Wait for `n` rendered frames (rAF ticks share the app loop's cadence). */
function settleFrames(page, n = 4) {
  return page.evaluate(
    (count) =>
      new Promise((res) => {
        let seen = 0;
        const tick = () => (++seen >= count ? res() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    n,
  );
}

/** The app's own terrain module singleton (same URL ⇒ same instance). */
function terrainLoaded(page) {
  return page.evaluate(() => import("/src/terrain.js").then((m) => m.isLoaded()));
}

test("large teleport during the terrain-load gap: no NaN geometry errors", { timeout: 180_000 }, async (t) => {
  const sim = await launchSim({ url: "about:blank" });
  t.after(() => sim.close());
  const { page } = sim;

  // Hold the terrain grid responses to widen the pre-load gap. Registered
  // after launchSim's routes, so Playwright matches it first for these URLs.
  let hold = true;
  const pending = [];
  await page.route(/\/data\/terrain\.(bin|json)(\?|$)/, (route) => {
    if (hold) { pending.push(route); return; }
    route.continue();
  });

  await page.goto(`${sim.baseURL}/index.html`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await waitForSim(page);
  await dismissStartScreen(page);

  // The gap is real: terrain requests are parked, grid not parsed.
  assert.ok(pending.length >= 1, "terrain requests should be held by the route");
  assert.equal(await terrainLoaded(page), false, "terrain grid must not be loaded yet");

  // Teleport FAR — the same drone.teleport() staging API every warp path
  // (reset, tour stops, fly-to arrival snapshots) ultimately drives.
  // ~9,000 km north puts |lat| > 90°: historically latToTileY → NaN tiles.
  await page.evaluate(() => {
    window.__sim.drone.teleport(0, 500, -9_000_000, 0, -0.1);
  });
  await settleFrames(page, 5);

  const nanKeysDuringGap = await page.evaluate(
    () => [...window.__sim.ground._tiles.keys()].filter((k) => k.includes("NaN")).length,
  );
  assert.equal(nanKeysDuringGap, 0, "no NaN tile keys may be built during the gap");
  assert.deepEqual(
    sim.consoleErrors.filter((e) => NAN_ERR.test(e)),
    [],
    "no computeBoundingSphere/NaN console errors during the gap",
  );

  // Let the terrain grid stream in WHILE the drone is still far outside the
  // Mercator domain — the moment onTerrainReady() rebuilds the live tile set.
  hold = false;
  for (const r of pending.splice(0)) r.continue();
  await page.waitForFunction(
    () => import("/src/terrain.js").then((m) => m.isLoaded()),
    null,
    { timeout: 60_000 },
  );
  await settleFrames(page, 5);
  assert.deepEqual(
    sim.consoleErrors.filter((e) => NAN_ERR.test(e)),
    [],
    "no NaN errors when the grid arrives while the drone is far out",
  );

  // Warp back inside coverage (Doi Inthanon, ~2 500 m) and prove the sim
  // still runs on real elevations: the arrival clamp must lift the drone
  // well above the requested 200 m, the tile set must be finite and sane,
  // and the render loop must still be producing frames.
  await page.evaluate(async () => {
    const { geoToWorld } = await import("/src/coords.js");
    const w = geoToWorld(18.5886, 98.4867);
    window.__sim.drone.teleport(w.x, 200, w.z, 0, -0.1);
  });
  const frameBefore = await page.evaluate(() => window.__sim.renderer.info.render.frame);
  await settleFrames(page, 5);

  const after = await page.evaluate(() => ({
    pos: {
      x: window.__sim.drone.position.x,
      y: window.__sim.drone.position.y,
      z: window.__sim.drone.position.z,
    },
    tiles: window.__sim.ground._tiles.size,
    nanKeys: [...window.__sim.ground._tiles.keys()].filter((k) => k.includes("NaN")).length,
    frame: window.__sim.renderer.info.render.frame,
  }));
  assert.ok(Number.isFinite(after.pos.x) && Number.isFinite(after.pos.y) && Number.isFinite(after.pos.z),
    `drone position must be finite, got ${JSON.stringify(after.pos)}`);
  assert.ok(after.pos.y > 1000,
    `terrain floor clamp must lift the drone onto the loaded grid (y=${after.pos.y})`);
  assert.ok(after.tiles > 0, "ground tiles must exist after warping back");
  assert.equal(after.nanKeys, 0, "no NaN tile keys after terrain load");
  assert.ok(after.frame > frameBefore, "render loop must still be producing frames");
  assert.deepEqual(
    sim.consoleErrors.filter((e) => NAN_ERR.test(e)),
    [],
    "zero computeBoundingSphere/NaN console errors across the whole scenario",
  );
});
