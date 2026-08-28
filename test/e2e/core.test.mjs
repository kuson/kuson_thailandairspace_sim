// test/e2e/core.test.mjs — e2e batch A: core interaction checklist (state_TODO §2).
//
// One shared browser for the whole file (launchSim is the expensive part);
// the checklist items run as ordered subtests, each leaving the sim back in
// a neutral state (units metric, radar-primary, first-person, identify off,
// unpaused) so later subtests never depend on a mid-toggle from an earlier one.
//
// Assertions are grounded in what the code actually renders:
//   - keys 1..5 → drone.js keydown (SPEED_PRESETS order) → setSpeedPreset()
//     swaps drone._currentModel + onPresetKeySwitch resyncs #speedControls
//     buttons and invalidates the HUD speed-line cache (ui.js).
//   - W in HOVERCRAFT (EasyMode default) strafes forward (_updateHovercraft).
//   - P toggles drone.paused; physicsStep() early-returns while paused;
//     ui._reflectPauseUI flips #togglePause to "▶ Resume [P]".
//   - U toggles ui.unitSystem metric↔aero (fmtSpeed/fmtAlt: m/s+km/h ↔ kt/ft).
//   - M toggles body.map-primary + resizes #minimap 260 ↔ innerWidth.
//   - I toggles drone.identifyMode → crosshairs + #identifyPanel cards,
//     capped at 3 with a ".ic-more" expand pill (_renderIdentifyCards CAP=3).
//   - V toggles drone.viewPerson first↔third (chase model visibility).
//   - HUD: #latlon DMS via coords.formatLatLon, #speed via fmtSpeed,
//     #heading = `${deg}° ${compass}` — all repainted per frame in updateHUD.

import test from "node:test";
import assert from "node:assert/strict";
import { launchSim, waitForSim, dismissStartScreen, pressKey } from "./harness.mjs";

// ---------------------------------------------------------------------------
// Helpers local to this spec.

/**
 * Dispatch a single keydown or keyup on document.body — same event shape as
 * harness.pressKey, but split so a key can be HELD across frames (the drone
 * integrates `keys` every physics substep until keyup arrives).
 */
function keyEvent(page, type, key) {
  return page.evaluate(
    ({ type, k }) => {
      const code =
        k.length === 1
          ? /[a-z]/i.test(k)
            ? "Key" + k.toUpperCase()
            : /[0-9]/.test(k)
              ? "Digit" + k
              : k === " "
                ? "Space"
                : k
          : k;
      document.body.dispatchEvent(
        new KeyboardEvent(type, { key: k, code, bubbles: true, cancelable: true }),
      );
    },
    { type, k: key },
  );
}
const holdKey = (page, key) => keyEvent(page, "keydown", key);
const releaseKey = (page, key) => keyEvent(page, "keyup", key);

/** Wait n animation frames inside the page (HUD repaints happen per frame). */
function frames(page, n = 2) {
  return page.evaluate(
    (count) =>
      new Promise((res) => {
        const step = (i) => (i <= 0 ? res() : requestAnimationFrame(() => step(i - 1)));
        step(count);
      }),
    n,
  );
}


/**
 * Wait until the app has RENDERED `n` more frames (renderer.info.render.frame
 * advances past its current value). Under SwiftShader the app renders only
 * ~1–3 rAF frames per 400 ms, so a wall-clock sleep can contain ZERO physics
 * steps (each frame runs physics then render); gating on the renderer's frame
 * counter guarantees real physics steps happened between key state changes
 * and position reads.
 */
async function waitForRenderedFrames(page, n = 2, timeout = 60_000) {
  const base = await page.evaluate(() => window.__sim.renderer.info.render.frame);
  await page.waitForFunction(
    ({ base, n }) => window.__sim.renderer.info.render.frame >= base + n,
    { base, n },
    { timeout },
  );
}

/** textContent of a selector (empty string if missing). */
function text(page, sel) {
  return page.evaluate((s) => document.querySelector(s)?.textContent ?? "", sel);
}

function getPos(page) {
  return page.evaluate(() => {
    const p = window.__sim.drone.position;
    return { x: p.x, y: p.y, z: p.z };
  });
}

const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);

// DMS as produced by coords.formatLatLon: `13°41'23.4"N 100°45'1.2"E`
const DMS_RE = /^\d+°\d{2}'\d+\.\d"[NS] \d+°\d{2}'\d+\.\d"[EW]$/;

// ---------------------------------------------------------------------------

test("core interaction checklist", { timeout: 180_000 }, async (t) => {
  const sim = await launchSim();
  t.after(() => sim.close());
  const { page } = sim;

  await waitForSim(page);
  await dismissStartScreen(page);
  // Let updateHUD paint at least once post-dismiss.
  await frames(page, 3);

  // ── 8. HUD sanity: lat/lon DMS, SPD line, HDG readout exist ─────────────
  await t.test("8. HUD sanity: lat/lon DMS, SPD line, HDG readout", async () => {
    await page.waitForFunction(
      () => /"[NS]/.test(document.getElementById("latlon")?.textContent ?? ""),
      null, { timeout: 10_000 },
    );
    const latlon = await text(page, "#latlon");
    assert.match(latlon, DMS_RE, `#latlon should be DMS, got "${latlon}"`);

    const spd = await text(page, "#speed");
    // metric default: "<mps> m/s · <kmh> km/h · <label> (<kmh> km/h)"
    assert.match(spd, /^\d+ m\/s · \d+ km\/h · .+ \(\d+ km\/h\)$/, `SPD line, got "${spd}"`);

    const hdg = await text(page, "#heading");
    assert.match(hdg, /^\d+° [NESW]+/, `HDG readout, got "${hdg}"`);

    // HDG updates between frames: nudge bodyYaw (headingDeg() = -bodyYaw°)
    // and confirm updateHUD repaints the digital readout. Restored after.
    await page.evaluate(() => { window.__sim.drone.bodyYaw += 0.6; });
    await frames(page, 3);
    const hdgAfter = await text(page, "#heading");
    assert.notEqual(hdgAfter, hdg, "HDG readout should update when heading changes");
    await page.evaluate(() => { window.__sim.drone.bodyYaw -= 0.6; });
    await frames(page, 3);
  });

  // ── 2. Movement: holding W moves the drone (+ HUD updates live) ─────────
  await t.test("2. movement: holding W changes position over frames", async () => {
    const before = await getPos(page);
    const latlonBefore = await text(page, "#latlon");
    const spdBefore = await text(page, "#speed");

    await holdKey(page, "w");
    // Frame-gated, not wall-clock: 2 rendered frames with W held ≫ 50 m at
    // the 100× preset (each dt-clamped 0.1 s step moves ~278 m).
    await waitForRenderedFrames(page, 2);
    const during = await getPos(page);
    const spdDuring = await text(page, "#speed");
    await releaseKey(page, "w");
    await frames(page, 3);

    // 100× preset cruises at 10 000 km/h ≈ 2 778 m/s → 2 frames ≫ 50 m.
    assert.ok(
      dist(before, during) > 50,
      `drone should move while W held (moved ${dist(before, during).toFixed(1)} m)`,
    );
    // HUD rows track the motion (item 8's "update between frames").
    const latlonAfter = await text(page, "#latlon");
    assert.notEqual(latlonAfter, latlonBefore, "lat/lon DMS should update while moving");
    assert.notEqual(spdDuring, spdBefore, "SPD line should update while moving");
    assert.match(spdDuring, /^[1-9]\d* m\/s/, `SPD should be non-zero while W held, got "${spdDuring}"`);
  });

  // ── 3. P pauses and resumes ──────────────────────────────────────────────
  await t.test("3. P pauses (position freezes, button flips) and resumes", async () => {
    await pressKey(page, "p");
    assert.equal(await page.evaluate(() => window.__sim.drone.paused), true, "drone.paused after P");
    const btnPaused = await text(page, "#togglePause");
    assert.ok(btnPaused.includes("Resume [P]"), `pause button should read Resume, got "${btnPaused}"`);

    // Held W must not move the drone while paused (physicsStep early-returns).
    // Frame-gated: rendering continues while paused (only physics halts), so
    // requiring rendered frames proves loop iterations actually happened
    // between the two position reads — a zero-frame wall-clock window would
    // pass vacuously.
    const before = await getPos(page);
    await holdKey(page, "w");
    await waitForRenderedFrames(page, 2);
    const frozen = await getPos(page);
    assert.ok(dist(before, frozen) < 1e-6, `position must freeze while paused (moved ${dist(before, frozen)} m)`);

    // Resume: P again → flag + button flip back, and held W moves again.
    await pressKey(page, "p");
    assert.equal(await page.evaluate(() => window.__sim.drone.paused), false, "drone.paused after resume");
    const btnResumed = await text(page, "#togglePause");
    assert.equal(btnResumed, "Pause [P]", "pause button label after resume");
    // Frame-gated like item 2: guarantee physics steps ran post-resume
    // instead of hoping a wall-clock window contains a SwiftShader frame.
    await waitForRenderedFrames(page, 2);
    const moved = await getPos(page);
    await releaseKey(page, "w");
    await frames(page, 3);
    assert.ok(dist(frozen, moved) > 50, `movement should resume after unpause (moved ${dist(frozen, moved).toFixed(1)} m)`);
  });

  // ── 1. Speed presets: keys 1–5 ───────────────────────────────────────────
  await t.test("1. speed presets: 1–5 change HUD preset label and swap model", async () => {
    const snapshot = () =>
      page.evaluate(() => ({
        preset: window.__sim.drone.speedPresetId,
        modelUuid: window.__sim.drone._currentModel?.uuid ?? null,
        activeBtn: document.querySelector("#speedControls .speed-btn.active")?.dataset.preset ?? null,
      }));

    const initial = await snapshot();
    assert.equal(initial.preset, "100x", "boot preset is 100× (main.js setSpeedPreset('100x'))");

    // Key 2 → Cessna 172. SPEED_PRESETS[1] = { id: 'cessna172', kmh: 226 }.
    await pressKey(page, "2");
    await frames(page, 3);
    const cessna = await snapshot();
    assert.equal(cessna.preset, "cessna172", "key 2 selects cessna172");
    assert.equal(cessna.activeBtn, "cessna172", "active speed button follows key 2");
    assert.notEqual(cessna.modelUuid, initial.modelUuid, "aircraft model swapped for Cessna");
    assert.ok(
      (await text(page, "#speed")).includes("Cessna 172 (226 km/h)"),
      "HUD speed line shows the Cessna preset label",
    );

    // Key 1 → Mavic 3 ("1x", 50 km/h, label "1×").
    await pressKey(page, "1");
    await frames(page, 3);
    const mavic = await snapshot();
    assert.equal(mavic.preset, "1x", "key 1 selects 1x");
    assert.equal(mavic.activeBtn, "1x", "active speed button follows key 1");
    assert.notEqual(mavic.modelUuid, cessna.modelUuid, "aircraft model swapped for Mavic");
    assert.ok(
      (await text(page, "#speed")).includes("1× (50 km/h)"),
      "HUD speed line shows the 1× preset label",
    );

    // Key 5 → back to 100× UFO (restores the boot preset for later subtests).
    await pressKey(page, "5");
    await frames(page, 3);
    const ufo = await snapshot();
    assert.equal(ufo.preset, "100x", "key 5 selects 100x");
    assert.equal(ufo.activeBtn, "100x", "active speed button follows key 5");
    assert.notEqual(ufo.modelUuid, mavic.modelUuid, "aircraft model swapped for UFO");
    assert.ok(
      (await text(page, "#speed")).includes("100× (10000 km/h)"),
      "HUD speed line shows the 100× preset label",
    );
  });

  // ── 4. U flips units metric ↔ aero ───────────────────────────────────────
  await t.test("4. U flips units metric ↔ aero in HUD speed/alt", async () => {
    assert.equal(await page.evaluate(() => window.__sim.ui.unitSystem), "metric");
    assert.match(await text(page, "#speed"), /m\/s · \d+ km\/h/, "metric SPD baseline");

    await pressKey(page, "u");
    await frames(page, 3);
    assert.equal(await page.evaluate(() => window.__sim.ui.unitSystem), "aero", "unitSystem after U");
    const spdAero = await text(page, "#speed");
    assert.match(spdAero, /^\d+ kt · \d+ km\/h · .+ \(\d+ kt\)$/, `aero SPD line, got "${spdAero}"`);
    const altAero = await text(page, "#alt");
    assert.match(altAero, /^-?\d+ ft AMSL/, `aero ALT line, got "${altAero}"`);
    assert.ok(!altAero.includes(" m "), "aero ALT drops the metres reading");

    await pressKey(page, "u");
    await frames(page, 3);
    assert.equal(await page.evaluate(() => window.__sim.ui.unitSystem), "metric", "unitSystem toggles back");
    const altMetric = await text(page, "#alt");
    assert.match(altMetric, /^-?\d+ m\s+\/\s+-?\d+ ft AMSL/, `metric ALT line, got "${altMetric}"`);
  });

  // ── 5. M toggles map-primary layout ──────────────────────────────────────
  await t.test("5. M toggles map-primary layout (radar becomes primary)", async () => {
    const before = await page.evaluate(() => ({
      cls: document.body.classList.contains("map-primary"),
      w: document.getElementById("minimap").width,
    }));
    assert.equal(before.cls, false, "starts radar-inset");
    assert.equal(before.w, 260, "minimap starts at 260px");

    await pressKey(page, "m");
    await frames(page, 2);
    const on = await page.evaluate(() => ({
      cls: document.body.classList.contains("map-primary"),
      w: document.getElementById("minimap").width,
      h: document.getElementById("minimap").height,
      innerW: window.innerWidth,
      innerH: window.innerHeight,
      label: document.getElementById("minimapLabel")?.textContent ?? "",
    }));
    assert.equal(on.cls, true, "body gains .map-primary");
    assert.equal(on.w, on.innerW, "minimap canvas fills viewport width");
    assert.equal(on.h, on.innerH, "minimap canvas fills viewport height");
    assert.ok(on.label.startsWith("Map (primary)"), `radar label flips, got "${on.label}"`);

    await pressKey(page, "m");
    await frames(page, 2);
    const off = await page.evaluate(() => ({
      cls: document.body.classList.contains("map-primary"),
      w: document.getElementById("minimap").width,
      label: document.getElementById("minimapLabel")?.textContent ?? "",
    }));
    assert.equal(off.cls, false, "body drops .map-primary");
    assert.equal(off.w, 260, "minimap back to 260px inset");
    assert.ok(off.label.startsWith("Radar ·"), `radar label restored, got "${off.label}"`);
  });

  // ── 7. V toggles 1st/3rd person ──────────────────────────────────────────
  await t.test("7. V toggles 1st/3rd-person view", async () => {
    const state = () =>
      page.evaluate(() => ({
        person: window.__sim.drone.viewPerson,
        modelVisible: window.__sim.drone._currentModel?.visible ?? null,
      }));

    assert.deepEqual(await state(), { person: "first", modelVisible: false }, "starts first-person, chase model hidden");
    await pressKey(page, "v");
    assert.deepEqual(await state(), { person: "third", modelVisible: true }, "V → third-person, chase model shown");
    await pressKey(page, "v");
    assert.deepEqual(await state(), { person: "first", modelVisible: false }, "V again → back to first-person");
  });

  // ── 6. I identify mode: bottom cards, cap 3 + expand pill ────────────────
  await t.test("6. identify mode: cards appear, capped at 3 with expand pill", async (t2) => {
    await pressKey(page, "i");
    assert.equal(await page.evaluate(() => window.__sim.drone.identifyMode), true, "identifyMode on");

    // Pick runs at 10 Hz in the main loop; panel appears on the next pick.
    await page.waitForFunction(
      () => document.getElementById("identifyPanel")?.classList.contains("visible"),
      null, { timeout: 10_000 },
    );
    const info = await page.evaluate(() => {
      const panel = document.getElementById("identifyPanel");
      return {
        crosshairs: document.getElementById("crosshairs")?.classList.contains("visible") ?? false,
        cards: panel.querySelectorAll(".identify-card").length,
        entries: window.__sim.ui._lastIdentifyEntries.length,
        pill: panel.querySelector(".ic-more")?.textContent ?? null,
      };
    });
    t2.diagnostic(`identify hits at start position: ${info.entries} (cards shown: ${info.cards})`);

    assert.equal(info.crosshairs, true, "crosshairs visible in identify mode");
    assert.ok(info.entries >= 1, "start position is inside CTR/TMA volumes — hits exist");
    assert.ok(info.cards >= 1 && info.cards <= 3, `at most 3 cards visible (got ${info.cards})`);
    assert.equal(info.cards, Math.min(3, info.entries), "cards = min(3, hits)");
    if (info.entries > 3) {
      assert.match(info.pill ?? "", /^\+\d+ more — expand$/, `expand pill present, got "${info.pill}"`);
      // Expanding reveals every entry.
      await page.click("#identifyPanel .ic-more");
      await page.waitForFunction(
        (n) => document.querySelectorAll("#identifyPanel .identify-card").length === n,
        info.entries, { timeout: 5_000 },
      );
    }

    // Toggle identify off → panel cleared and hidden.
    await pressKey(page, "i");
    assert.equal(await page.evaluate(() => window.__sim.drone.identifyMode), false, "identifyMode off");
    await page.waitForFunction(
      () => !document.getElementById("identifyPanel")?.classList.contains("visible"),
      null, { timeout: 5_000 },
    );
    assert.equal(await text(page, "#identifyPanel"), "", "panel emptied when identify exits");
  });
});
