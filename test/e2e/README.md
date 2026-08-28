# test/e2e — headless browser smoke tests

Plain `node:test` specs that boot the real app in headless Chromium
(SwiftShader WebGL) with **zero** external network: everything the page
requests is served locally, stubbed, or aborted.

## Run

```sh
node --test test/e2e/*.test.mjs
```

First run downloads the three.js vendor cache (see below), so it is slower;
after that a boot spec takes ~10–20 s.

## Vendor cache (`test/e2e/.cache/` — gitignored)

The app's importmap pins `https://unpkg.com/three@0.170.0/…`. The browser has
no internet in test, so `ensureThreeVendor()` downloads the npm tarball
`three-0.170.0.tgz` from registry.npmjs.org once, extracts it to
`test/e2e/.cache/three/` (pruned to `build/` + `examples/jsm/`), and the
harness fulfills unpkg requests from that copy. The download is atomic
(temp dir + rename), so concurrent test runs don't race. Delete the `.cache/`
dir to force a re-download.

## Playwright resolution

The harness uses the Playwright **library** (not `@playwright/test`), resolved
in this order:

1. `import("playwright")` — if it's on the module path;
2. `$PLAYWRIGHT_LIB` — set this env var to the library's `index.mjs` on other
   machines (e.g. `PLAYWRIGHT_LIB=/path/to/node_modules/playwright/index.mjs`);
3. `/opt/node22/lib/node_modules/playwright/index.mjs` — this container's
   global install.

Chromium binaries must already be installed (`PLAYWRIGHT_BROWSERS_PATH` is
preset in the container). Never run `playwright install` here.

## Writing specs

Import from `./harness.mjs` — specs need no knowledge of servers, routes, or
ports:

```js
import { launchSim, waitForSim, dismissStartScreen, pressKey } from "./harness.mjs";

const sim = await launchSim();          // static server + chromium + routes
await waitForSim(sim.page);             // window.__sim.drone ready (≤60 s)
await dismissStartScreen(sim.page);     // click Explore, wait until hidden
await pressKey(sim.page, "m");          // keydown+keyup on document.body
// assert via sim.page.evaluate(...); console errors are in sim.consoleErrors
await sim.close();                      // always: closes browser AND server
```
