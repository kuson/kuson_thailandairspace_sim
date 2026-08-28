// test/e2e/features.test.mjs — e2e batch B: warp / tour / persistence / traffic-heat
// (state_TODO §2). Two shared browser sessions:
//
//   Session 1 (flight):        1. catalog warp fly-to lands near the target volume
//                              2. flight-history undo/redo round-trip after 3 warps
//                              3. express tour → narration overlay + identify blocked;
//                                 End tour → controls work again
//   Session 2 (persistence):   4. Strict-CAAT toggle persists across reload
//                              5. traffic heat nominal: #optHeatRecord → #heatStatus "recording"
//                              7. traffic-heat settings survive reload (kuson.pathHeatmap.settings.v1)
//                              6. traffic-heat ERROR path (runs LAST — it poisons the page's
//                                 IndexedDB realm): a failing IDB write must flip recording
//                                 off (checkbox unchecked, settings recordingOn=false) and
//                                 surface "error — …" on the status line. This automates
//                                 STATUS.yaml's pending manual verification of
//                                 src/pathHeatmap error handling (collector.js splat error →
//                                 index.js onPositions catch → ui.setHeatStatus checkbox sync).
//
// Like boot.test.mjs, consoleErrors are collected but deliberately not asserted.

import test from "node:test";
import assert from "node:assert/strict";
import { launchSim, waitForSim, dismissStartScreen, pressKey } from "./harness.mjs";

const HEAT_LS_KEY = "kuson.pathHeatmap.settings.v1";
const CAAT_LS_KEY = "kuson.sim.strictCaat";

function clickById(page, id) {
  return page.evaluate((elId) => {
    const el = document.getElementById(elId);
    if (!el) throw new Error(`#${elId} not found`);
    el.click();
  }, id);
}

function dronePos(page) {
  return page.evaluate(() => ({
    x: window.__sim.drone.position.x,
    y: window.__sim.drone.position.y,
    z: window.__sim.drone.position.z,
  }));
}

const distXZ = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * Post-reload start-screen dismissal. The harness's dismissStartScreen drives
 * a real pointer click, whose "element is stable" actionability wait can time
 * out when several SwiftShader browsers run concurrently (rAF starvation).
 * The start-screen click path itself is already covered by boot.test.mjs and
 * this file's initial per-session dismissals, so reload re-dismissals use a
 * JS click on the same Explore button instead.
 */
async function dismissStartScreenJs(page, { timeout = 60_000 } = {}) {
  await page.waitForFunction(() => {
    const btn = document.querySelector('#startScreen .ss-btn[data-idx="0"]');
    return !!btn && btn.offsetParent !== null;
  }, null, { timeout });
  await page.evaluate(() => {
    document.querySelector('#startScreen .ss-btn[data-idx="0"]').click();
  });
  await page.waitForFunction(() => {
    const el = document.getElementById("startScreen");
    return !el || getComputedStyle(el).display === "none";
  }, null, { timeout });
}

/**
 * Click a catalog card (the same #airspaceList button.teleport path a user
 * clicks — ui._requestFlyTo → main.startFlyTo) and wait for the arrival
 * history entry (type "flyto" is recorded in startFlyTo's onComplete).
 * Returns the drone position right after arrival.
 */
async function warpTo(page, id) {
  await page.evaluate((aid) => {
    const btn = document.querySelector(`#airspaceList button.teleport[data-id="${aid}"]`);
    if (!btn) throw new Error(`no catalog fly-to button for ${aid}`);
    btn.click();
  }, id);
  await page.waitForFunction(
    (aid) =>
      window.__sim.flightHistory.stack.some((e) => e.type === "flyto" && e.airspaceId === aid),
    id,
    { timeout: 30_000 },
  );
  return dronePos(page);
}

/**
 * Click #undoBtn / #redoBtn until the history cursor sits on the "flyto"
 * entry for `airspaceId`. Warps can also log BOUNDARY entries for volumes
 * crossed mid-flight, so a single warp may need several steps.
 */
async function stepHistoryUntil(page, btnId, canFn, airspaceId) {
  for (let i = 0; i < 30; i++) {
    const cur = await page.evaluate(() => {
      const c = window.__sim.flightHistory.current;
      return c ? { type: c.type, airspaceId: c.airspaceId ?? null } : null;
    });
    if (cur && cur.type === "flyto" && cur.airspaceId === airspaceId) return;
    const can = await page.evaluate((fn) => window.__sim.flightHistory[fn](), canFn);
    assert.ok(can, `${canFn}() exhausted before reaching flyto entry for ${airspaceId}`);
    await clickById(page, btnId);
  }
  assert.fail(`never reached the flyto entry for ${airspaceId} via #${btnId}`);
}

// ───────────────────────── session 1: warp / history / tour ─────────────────────────

test("warp fly-to, flight-history undo/redo, express tour (shared session)", { timeout: 240_000 }, async (t) => {
  const sim = await launchSim();
  t.after(() => sim.close());
  const { page } = sim;
  await waitForSim(page);
  await dismissStartScreen(page);
  await page.waitForFunction(
    () => document.querySelectorAll("#airspaceList button.teleport").length > 0,
    null,
    { timeout: 30_000 },
  );

  // Rank the catalog targets by horizontal distance from the Bangkok spawn,
  // carrying each target's arrival vantage so tests can pick spread-out stops.
  const ranked = await page.evaluate(() => {
    const { drone, layer, camera } = window.__sim;
    const ids = [...document.querySelectorAll("#airspaceList button.teleport")].map(
      (b) => b.dataset.id,
    );
    return ids
      .map((id) => {
        const v = layer.overviewVantage(id, camera.fov, "S");
        return v
          ? { id, vx: v.x, vz: v.z, d: Math.hypot(v.x - drone.position.x, v.z - drone.position.z) }
          : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.d - a.d);
  });
  assert.ok(ranked.length >= 4, `need at least 4 catalog targets, got ${ranked.length}`);

  await t.test("1. catalog warp fly-to lands near a distant target volume", async () => {
    const target = ranked[0]; // farthest volume from the spawn
    assert.ok(
      target.d > 100_000,
      `farthest catalog target should be >100 km away (got ${(target.d / 1000).toFixed(0)} km)`,
    );
    const before = await dronePos(page);
    const after = await warpTo(page, target.id);
    // Arrival = the S-side overview vantage startFlyTo aims at.
    const arrivalErr = Math.hypot(after.x - target.vx, after.z - target.vz);
    assert.ok(
      arrivalErr < 1500,
      `aircraft should end near the ${target.id} vantage (off by ${arrivalErr.toFixed(0)} m)`,
    );
    assert.ok(
      distXZ(after, before) > 100_000,
      "warp should have moved the aircraft a long distance",
    );
  });

  await t.test("2. undo/redo round-trip after 3 warps", async () => {
    // Three fresh targets (not test 1's — its flyto entry already exists),
    // pairwise ≥80 km apart so undo/redo teleports are unambiguous.
    const picked = [];
    for (const cand of ranked.slice(1)) {
      if (picked.every((p) => Math.hypot(p.vx - cand.vx, p.vz - cand.vz) >= 80_000)) {
        picked.push(cand);
        if (picked.length === 3) break;
      }
    }
    assert.equal(picked.length, 3, "need 3 spread-out warp targets");
    const [wA, wB, wC] = picked;

    await warpTo(page, wA.id);
    const pB = await warpTo(page, wB.id);
    const pC = await warpTo(page, wC.id);

    assert.equal(
      await page.evaluate(() => window.__sim.flightHistory.canUndo()),
      true,
      "history should be undoable after 3 warps",
    );

    // Undo back to the warp-B arrival: restores the earlier position.
    await stepHistoryUntil(page, "undoBtn", "canUndo", wB.id);
    const undone = await dronePos(page);
    assert.ok(
      distXZ(undone, pB) < 1500,
      `undo should restore the warp-B position (off by ${distXZ(undone, pB).toFixed(0)} m)`,
    );
    assert.ok(
      distXZ(undone, pC) > 50_000,
      "undo should have moved the aircraft away from the last warp target",
    );

    // Redo forward to the warp-C arrival: re-applies the undone jump.
    await stepHistoryUntil(page, "redoBtn", "canRedo", wC.id);
    const redone = await dronePos(page);
    assert.ok(
      distXZ(redone, pC) < 1500,
      `redo should re-apply the warp-C position (off by ${distXZ(redone, pC).toFixed(0)} m)`,
    );
  });

  await t.test("3. express tour: narration overlay, identify blocked, End tour restores controls", async () => {
    await page.waitForFunction(() => !!document.getElementById("tourShortBtn"), null, {
      timeout: 15_000,
    });
    await clickById(page, "tourShortBtn"); // "Express tour" → tourGuide.start("short")
    await page.waitForFunction(() => window.__sim.tourGuide?.running === true, null, {
      timeout: 15_000,
    });
    await page.waitForFunction(
      () => document.getElementById("tourOverlay")?.classList.contains("visible"),
      null,
      { timeout: 15_000 },
    );
    const overlay = await page.evaluate(() => ({
      visible: document.getElementById("tourOverlay").classList.contains("visible"),
      text: ["tourChapter", "tourTitle", "tourNarration"]
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ")
        .trim(),
    }));
    assert.equal(overlay.visible, true, "narration overlay should be visible during the tour");
    assert.ok(overlay.text.length > 0, "narration overlay should carry stop text");

    // Identify (I) is blocked while the tour drives the drone (flightLocked +
    // inputGuard's learning-mode matrix).
    await page.waitForFunction(() => window.__sim.drone.flightLocked === true, null, {
      timeout: 15_000,
    });
    await pressKey(page, "i");
    await page.evaluate(() => new Promise((r) => setTimeout(r, 150)));
    assert.equal(
      await page.evaluate(() => window.__sim.drone.identifyMode),
      false,
      "identify must stay off while the tour is running",
    );

    // End the tour → overlay hides and controls work again.
    await clickById(page, "tourEndBtn");
    await page.waitForFunction(() => window.__sim.tourGuide?.running === false, null, {
      timeout: 15_000,
    });
    assert.equal(
      await page.evaluate(() =>
        document.getElementById("tourOverlay").classList.contains("visible"),
      ),
      false,
      "narration overlay should hide after End tour",
    );
    await pressKey(page, "i");
    await page.waitForFunction(() => window.__sim.drone.identifyMode === true, null, {
      timeout: 10_000,
    });
    await pressKey(page, "i"); // toggle back off (leave a clean state)
    await page.waitForFunction(() => window.__sim.drone.identifyMode === false, null, {
      timeout: 10_000,
    });
  });
});

// ───────────────── session 2: persistence + traffic heat (incl. IDB error path) ─────────────────

test("Strict-CAAT + traffic-heat persistence and IndexedDB error path (shared session)", { timeout: 300_000 }, async (t) => {
  const sim = await launchSim();
  t.after(() => sim.close());
  const { page } = sim;
  await waitForSim(page);
  await dismissStartScreen(page);

  await t.test("4. Strict CAAT toggle persists across reload (kuson.sim.strictCaat)", async () => {
    assert.equal(
      await page.evaluate(() => window.__sim.simState.isStrictCaat()),
      false,
      "Strict CAAT should default OFF",
    );
    await clickById(page, "toggleStrictCaat");
    const flipped = await page.evaluate((key) => ({
      on: window.__sim.simState.isStrictCaat(),
      ls: localStorage.getItem(key),
      label: document.getElementById("toggleStrictCaat").textContent.trim(),
    }), CAAT_LS_KEY);
    assert.equal(flipped.on, true, "toggle should flip Strict CAAT on");
    assert.equal(flipped.ls, "1", "flag should be persisted to localStorage");
    assert.equal(flipped.label, "CAAT: ON");

    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitForSim(page);
    await dismissStartScreenJs(page);
    const persisted = await page.evaluate((key) => ({
      on: window.__sim.simState.isStrictCaat(),
      ls: localStorage.getItem(key),
      label: document.getElementById("toggleStrictCaat").textContent.trim(),
    }), CAAT_LS_KEY);
    assert.equal(persisted.on, true, "Strict CAAT should survive a reload");
    assert.equal(persisted.ls, "1");
    assert.equal(persisted.label, "CAAT: ON", "button should reflect the persisted state");
  });

  await t.test("5. traffic heat nominal: Record checkbox → status line reports recording", async () => {
    await page.waitForFunction(
      () => !!document.getElementById("optHeatRecord") && !!document.getElementById("heatStatus"),
      null,
      { timeout: 15_000 },
    );
    // Recording needs Live Flights; use the offline mock source (no network).
    await page.evaluate(() => {
      const src = document.getElementById("optFlightSource");
      src.value = "mock";
      src.dispatchEvent(new Event("change", { bubbles: true }));
      const lf = document.getElementById("optLiveFlights");
      if (!lf.checked) lf.click();
    });
    await page.waitForFunction(() => window.__sim.liveFlights.isEnabled() === true, null, {
      timeout: 15_000,
    });
    await page.evaluate(() => {
      const rec = document.getElementById("optHeatRecord");
      if (!rec.checked) rec.click();
    });
    await page.waitForFunction(
      () => (document.getElementById("heatStatus")?.textContent ?? "").includes("recording"),
      null,
      { timeout: 20_000 },
    );
    const st = await page.evaluate((key) => ({
      txt: document.getElementById("heatStatus").textContent,
      checked: document.getElementById("optHeatRecord").checked,
      settings: JSON.parse(localStorage.getItem(key)),
    }), HEAT_LS_KEY);
    assert.match(st.txt, /recording/, `status line should report recording (got "${st.txt}")`);
    assert.equal(st.checked, true, "checkbox should stay checked while recording");
    assert.equal(st.settings.recordingOn, true, "recordingOn should be persisted");
  });

  await t.test("7. traffic-heat settings survive reload (kuson.pathHeatmap.settings.v1)", async () => {
    await page.evaluate(() => {
      const w = document.getElementById("optHeatWindow");
      w.value = "7d";
      w.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const before = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), HEAT_LS_KEY);
    assert.equal(before.recordingOn, true);
    assert.equal(before.viewPreset, "7d");

    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitForSim(page);
    await dismissStartScreenJs(page);
    const after = await page.evaluate((key) => ({
      settings: JSON.parse(localStorage.getItem(key)),
      windowSel: document.getElementById("optHeatWindow").value,
      recChecked: document.getElementById("optHeatRecord").checked,
    }), HEAT_LS_KEY);
    assert.equal(after.settings.recordingOn, true, "recordingOn should survive the reload");
    assert.equal(after.settings.viewPreset, "7d", "view window should survive the reload");
    assert.equal(after.windowSel, "7d", "window select should be restored from settings");
    assert.equal(after.recChecked, true, "record checkbox should be restored from settings");
  });

  // Runs LAST: it poisons this page's IndexedDB realm. Automates STATUS.yaml's
  // pending manual verification of the traffic-heat error path.
  await t.test("6. traffic-heat IDB error path: status reports error, checkbox flips off with module state", async () => {
    // After the reload above, persisted settings (recordingOn + mock live
    // flights) bring the collector back to "recording" via the boot poll.
    await page.waitForFunction(
      () => (document.getElementById("heatStatus")?.textContent ?? "").includes("recording"),
      null,
      { timeout: 30_000 },
    );

    // Poison IDB at the transaction seam: store.js idbRunTx calls
    // db.transaction(...) inside its Promise executor, so the throw rejects
    // incrementMany → collector.splatPositions sets {state:"error"} and
    // rethrows → pathHeatmap/index.js onPositions .catch turns recording off
    // (setPathHeatmapSettings + collector.setRecording(false, preserveError))
    // → ui.setHeatStatus syncs the checkbox from the real module state.
    await page.evaluate(() => {
      IDBDatabase.prototype.transaction = function () {
        throw new Error("kuson-e2e simulated IndexedDB failure");
      };
    });
    // Exercise the record path through the module's real seam (the handler
    // createPathHeatmapModule installed on liveFlights.onPositions).
    await page.evaluate(() => {
      const lf = window.__sim.liveFlights;
      if (typeof lf.onPositions !== "function") {
        throw new Error("pathHeatmap collector is not wired to liveFlights.onPositions");
      }
      lf.onPositions([{ id: "E2E001", lat: 13.75, lon: 100.55, altM: 3200, onGround: false }]);
    });

    // Read status + checkbox + persisted settings atomically in the predicate
    // (the next mock poll would repaint the line "off" once recording is off).
    const handle = await page.waitForFunction((key) => {
      const txt = document.getElementById("heatStatus")?.textContent ?? "";
      const chk = document.getElementById("optHeatRecord");
      if (!txt.includes("error") || !chk || chk.checked) return null;
      let recordingOn = null;
      try {
        recordingOn = JSON.parse(localStorage.getItem(key))?.recordingOn ?? null;
      } catch {
        /* leave null */
      }
      return { txt, checked: chk.checked, recordingOn };
    }, HEAT_LS_KEY, { timeout: 20_000 });
    const st = await handle.jsonValue();

    assert.match(st.txt, /error/, `status line should report the error (got "${st.txt}")`);
    assert.ok(
      st.txt.includes("kuson-e2e simulated IndexedDB failure"),
      `status line should carry the failure detail (got "${st.txt}")`,
    );
    assert.equal(st.checked, false, "checkbox must agree with the module: recording turned off");
    assert.equal(st.recordingOn, false, "persisted settings must show recordingOn=false");
  });
});
