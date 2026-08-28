// test/e2e/boot.test.mjs — smoke test: the app boots headlessly, builds every
// airspace volume from data/airspaces.json, shows a WebGL renderer, and the
// start screen is visible then dismissible.
//
// Deliberately does NOT assert consoleErrors is empty — known boot-window
// errors are being fixed separately; this spec only proves the boot path.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchSim, waitForSim, dismissStartScreen } from "./harness.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("app boots headlessly and matches airspaces.json", { timeout: 180_000 }, async (t) => {
  const expected = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "data", "airspaces.json"), "utf8"),
  ).airspaces.length;
  assert.ok(expected > 0, "airspaces.json should contain entries");

  const sim = await launchSim();
  t.after(() => sim.close());
  const { page } = sim;

  await t.test("readiness signal fires (window.__sim.drone)", async () => {
    await waitForSim(page);
  });

  await t.test("WebGL renderer exists (window.__sim.renderer)", async () => {
    const r = await page.evaluate(() => ({
      hasRenderer: !!window.__sim.renderer,
      hasCanvas: !!window.__sim.renderer?.domElement,
    }));
    assert.equal(r.hasRenderer, true, "window.__sim.renderer should exist");
    assert.equal(r.hasCanvas, true, "renderer should own a canvas");
  });

  await t.test(`airspace volume count equals data/airspaces.json (${expected})`, async () => {
    const counts = await page.evaluate(() => ({
      airspaces: window.__sim.layer?.airspaces?.length ?? -1,
      compiled: window.__sim.layer?.compiled?.length ?? -1,
    }));
    assert.equal(counts.airspaces, expected, "layer.airspaces count");
    assert.equal(counts.compiled, expected, "compiled volume count");
  });

  await t.test("start screen is visible, then dismissible", async () => {
    const visibleBefore = await page.evaluate(() => {
      const el = document.getElementById("startScreen");
      return !!el && getComputedStyle(el).display !== "none";
    });
    assert.equal(visibleBefore, true, "start screen should be up after boot");

    await dismissStartScreen(page);

    const visibleAfter = await page.evaluate(() => {
      const el = document.getElementById("startScreen");
      return !!el && getComputedStyle(el).display !== "none";
    });
    assert.equal(visibleAfter, false, "start screen should be hidden after Explore");
  });
});
