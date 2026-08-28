// test/e2e/debug-flag.test.mjs — ?debug=1 frame-budget logger (state_TODO §3).
// With the flag: at least one "[frame-budget] avg … | p95 … | worst …" line
// lands on console.info within a couple of emit intervals. Without it: none.
import test from "node:test";
import assert from "node:assert/strict";
import { launchSim, waitForSim } from "./harness.mjs";

const BUDGET_RE = /^\[frame-budget\] avg \d+(\.\d+)?ms \| p95 \d+(\.\d+)?ms \| worst \d+(\.\d+)?ms /;

function collectBudgetLines(page) {
  const lines = [];
  page.on("console", (m) => {
    if (m.text().includes("[frame-budget]")) lines.push(m.text());
  });
  return lines;
}

test("?debug=1 boots and emits frame-budget lines", { timeout: 180_000 }, async (t) => {
  const sim = await launchSim();
  t.after(() => sim.close());
  const lines = collectBudgetLines(sim.page);
  // launchSim's baseURL is only known post-launch, so re-navigate with the
  // flag; routes and the console listener survive navigation.
  await sim.page.goto(`${sim.baseURL}/index.html?debug=1`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await waitForSim(sim.page);
  // First emission comes ~5 s after the render loop starts; poll generously.
  const deadline = Date.now() + 45_000;
  while (lines.length === 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(lines.length >= 1, "expected at least one [frame-budget] console line");
  assert.match(lines[0], BUDGET_RE);
});

test("without ?debug=1 no frame-budget lines are emitted", { timeout: 180_000 }, async (t) => {
  const sim = await launchSim();
  t.after(() => sim.close());
  const lines = collectBudgetLines(sim.page);
  await waitForSim(sim.page);
  // Observe well past one emit interval (5 s) of running frames.
  await new Promise((r) => setTimeout(r, 8_000));
  assert.equal(lines.length, 0, `unexpected frame-budget output: ${lines[0] ?? ""}`);
});
