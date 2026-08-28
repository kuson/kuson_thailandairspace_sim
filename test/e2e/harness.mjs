// test/e2e/harness.mjs — shared plumbing for headless-browser smoke tests.
//
// Specs should only need:
//   const sim = await launchSim();
//   await waitForSim(sim.page);
//   await dismissStartScreen(sim.page);
//   ... assertions via sim.page.evaluate ...
//   await sim.close();
//
// The browser gets NO real network: a catch-all abort route blocks every
// non-localhost request, then three@0.170.0 CDN URLs are fulfilled from a
// vendored copy of the npm package (test/e2e/.cache/three/) and carto
// basemap tiles are stubbed with a 1×1 transparent PNG. The repo root is
// served by a throwaway node:http server on an ephemeral port so concurrent
// runs never collide.

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(E2E_DIR, "..", "..");
const VENDOR_DIR = path.join(E2E_DIR, ".cache", "three");
const THREE_TGZ_URL = "https://registry.npmjs.org/three/-/three-0.170.0.tgz";

// 1×1 transparent PNG for basemap-tile stubs.
const BLANK_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * Resolve the Playwright *library* (not @playwright/test).
 * Order: normal import → $PLAYWRIGHT_LIB → the container's global install.
 */
export async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    /* not on the module path — fall through */
  }
  const fallback =
    process.env.PLAYWRIGHT_LIB || "/opt/node22/lib/node_modules/playwright/index.mjs";
  return import(fallback);
}

/**
 * Ensure test/e2e/.cache/three/ holds the npm three@0.170.0 package, pruned
 * to build/ + examples/jsm/ (all the importmap ever asks for). Idempotent and
 * atomic: work happens in a per-process temp dir that is rename()d into place,
 * so concurrent test runs can race safely — first rename wins, losers reuse it.
 * Returns the vendor dir path.
 */
export async function ensureThreeVendor() {
  const marker = path.join(VENDOR_DIR, "build", "three.module.js");
  if (fs.existsSync(marker)) return VENDOR_DIR;

  const cacheRoot = path.dirname(VENDOR_DIR);
  const tmpRoot = path.join(
    cacheRoot,
    `.tmp-three-${process.pid}-${Math.random().toString(36).slice(2)}`,
  );
  fs.mkdirSync(tmpRoot, { recursive: true });
  try {
    const tgz = path.join(tmpRoot, "three.tgz");
    const res = await fetch(THREE_TGZ_URL);
    if (!res.ok) throw new Error(`three tarball download failed: HTTP ${res.status}`);
    fs.writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
    execFileSync("tar", ["-xzf", tgz, "-C", tmpRoot]); // → tmpRoot/package/

    // Prune: keep only what the importmap can request.
    const pruned = path.join(tmpRoot, "three");
    fs.mkdirSync(path.join(pruned, "examples"), { recursive: true });
    fs.renameSync(path.join(tmpRoot, "package", "build"), path.join(pruned, "build"));
    fs.renameSync(
      path.join(tmpRoot, "package", "examples", "jsm"),
      path.join(pruned, "examples", "jsm"),
    );

    try {
      fs.renameSync(pruned, VENDOR_DIR);
    } catch (e) {
      // A concurrent run beat us to it — fine, as long as theirs is complete.
      if (!fs.existsSync(marker)) throw e;
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
  if (!fs.existsSync(marker)) throw new Error("three vendor cache incomplete after extract");
  return VENDOR_DIR;
}

/** Serve the repo root on an ephemeral port. Returns { server, port, baseURL }. */
function startStaticServer() {
  const server = http.createServer((req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p.endsWith("/")) p += "index.html";
      const file = path.normalize(path.join(REPO_ROOT, p));
      if (!file.startsWith(REPO_ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      });
      res.end(fs.readFileSync(file));
    } catch {
      res.writeHead(500).end("error");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, port, baseURL: `http://127.0.0.1:${port}` });
    });
  });
}

/**
 * Boot the sim in headless Chromium (SwiftShader WebGL) with all external
 * network blocked/stubbed. Navigates to `url` (default: the served
 * /index.html) and resolves once the DOM is loaded — call waitForSim() for
 * full app readiness.
 *
 * Returns { browser, page, consoleErrors, baseURL, close }.
 * consoleErrors collects console.error text plus "pageerror: …" entries as
 * the page produces them. Always await close() (closes browser AND server).
 */
export async function launchSim({ url } = {}) {
  const vendorDir = await ensureThreeVendor();
  const { chromium } = await loadPlaywright();
  const { server, baseURL } = await startStaticServer();

  const browser = await chromium.launch({
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + String(e)));

  // Route order matters: Playwright tries LATER-registered routes first, so
  // the catch-all abort goes in FIRST and the specific fulfills after it.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  await page.route(/^https:\/\/unpkg\.com\/three@0\.170\.0\//, (route) => {
    const rel = route.request().url().match(/three@0\.170\.0\/([^?]+)/)?.[1] ?? "";
    const file = path.normalize(path.join(vendorDir, rel));
    if (file.startsWith(vendorDir + path.sep) && fs.existsSync(file)) {
      route.fulfill({ body: fs.readFileSync(file), contentType: "text/javascript" });
    } else {
      route.abort();
    }
  });
  await page.route(/^https:\/\/[a-z0-9]+\.basemaps\.cartocdn\.com\/.*\.png/, (route) => {
    route.fulfill({ body: BLANK_PNG, contentType: "image/png" });
  });

  await page.goto(url ?? `${baseURL}/index.html`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  let closed = false;
  return {
    browser,
    page,
    consoleErrors,
    baseURL,
    async close() {
      if (closed) return;
      closed = true;
      await browser.close().catch(() => {});
      await new Promise((r) => server.close(r));
    },
  };
}

/** Wait for the app readiness signal (window.__sim.drone). Boot takes a few seconds. */
export async function waitForSim(page, { timeout = 60_000 } = {}) {
  await page.waitForFunction(() => window.__sim && window.__sim.drone, null, { timeout });
}

/**
 * Dismiss the start-screen overlay (src/startScreen.js) by clicking Explore.
 * Waits for the launch buttons to appear first (they show only after every
 * load step finishes), then waits until the overlay is actually hidden.
 */
export async function dismissStartScreen(page, { timeout = 60_000 } = {}) {
  const explore = page.locator('#startScreen .ss-btn[data-idx="0"]');
  await explore.waitFor({ state: "visible", timeout });
  await explore.click();
  await page.waitForFunction(() => {
    const el = document.getElementById("startScreen");
    return !el || getComputedStyle(el).display === "none";
  }, null, { timeout });
}

/**
 * Synthesize a key press the sim can see. The app's key handlers listen at
 * the document level in the capture phase, so events are dispatched on
 * document.body (window-level dispatch misses them). Sends keydown then keyup.
 */
export async function pressKey(page, key) {
  await page.evaluate((k) => {
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
    for (const type of ["keydown", "keyup"]) {
      document.body.dispatchEvent(
        new KeyboardEvent(type, { key: k, code, bubbles: true, cancelable: true }),
      );
    }
  }, key);
}
