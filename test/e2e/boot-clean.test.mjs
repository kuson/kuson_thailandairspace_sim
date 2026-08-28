// boot-clean.test.mjs — the boot window produces ZERO real console errors.
//
// Regression spec for the boot-window declutter crash: loop() starts on the
// first rAF after startSim() while async bootstrap() is still in flight, and
// referenced `declutterLayers` — formerly a const scoped INSIDE bootstrap()
// — so every frame logged
//   [loop:declutter] ReferenceError: declutterLayers is not defined
// (hundreds of console.error lines during a slow load; the declutter pass
// never ran at all since the name was invisible to loop() even post-init).
// Fixed in src/main.js by hoisting a module-level `let declutterLayers =
// null` and guarding the loop call with ?. — the same idiom the file already
// uses for ui/tourGuide/airportBeacons/provinceLines.
//
// Scenario is deliberately boot + idle ONLY (no teleports, no key input):
// teleport/terrain edge cases are covered elsewhere and must not leak into
// this window.
//
// Filtered noise: "Failed to load resource" lines are the browser's own
// network-layer reports for requests the harness intentionally aborts
// (nominatim/adsb/etc. via the catch-all route) — not app errors.

import test from "node:test";
import assert from "node:assert/strict";
import { launchSim, waitForSim } from "./harness.mjs";

const IDLE_MS = 8_000;

function realErrors(consoleErrors) {
  return consoleErrors.filter((e) => !e.includes("Failed to load resource"));
}

test("boot + idle produces zero real console errors", { timeout: 180_000 }, async (t) => {
  const sim = await launchSim();
  t.after(() => sim.close());

  await waitForSim(sim.page);

  // Idle with the render loop running so any per-frame error (the old
  // declutter ReferenceError fired every rAF) has ample time to surface.
  await new Promise((resolve) => setTimeout(resolve, IDLE_MS));

  const errors = realErrors(sim.consoleErrors);

  // Belt-and-braces: the specific regression this spec guards against.
  const declutterErrors = errors.filter((e) => e.includes("[loop:declutter]"));
  assert.equal(
    declutterErrors.length,
    0,
    `declutter loop errors during boot window:\n${declutterErrors.slice(0, 5).join("\n")}`
  );

  assert.deepEqual(
    errors,
    [],
    `expected zero real console errors during boot+idle, got ${errors.length}:\n` +
      errors.slice(0, 10).map((e) => `  - ${e.slice(0, 200)}`).join("\n")
  );
});
