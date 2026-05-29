# Thai Airspace Sim — Bangkok

A single-page web app that teaches Thai airspace around Bangkok by letting you fly a virtual aircraft through 3D airspace volumes. Pick **Easy Mode** to float anywhere like a hovercraft, or **Realistic Mode** for a second-order Mavic 3 quadrotor / fixed-wing flight model with battery, return-to-home, signal loss, AGL terrain, per-aircraft altitude warnings, and tiered CAAT geofence — advisory by default, with opt-in **Strict CAAT** enforcement. No build step — serve `index.html` over HTTP and go.

> **Educational visualization only. Not for flight planning. Data may be approximate or out of date. Consult CAAT and current AIP Thailand.**

## Run

Because the app loads `./data/airspaces.json` and ES module files via `import`, you need to serve it over HTTP rather than open the file directly (browsers block `fetch` from `file://` for security).

Pick one:

```sh
# Option A — Python 3
cd kuson_thailandairspace_sim
python3 -m http.server 8000
# open http://localhost:8000

# Option B — Node (with `serve`)
npx serve .

# Option C — VS Code: install "Live Server" extension, right-click index.html → "Open with Live Server"
```

That's it. No npm, no bundler, no Three.js install — it's all pulled from a CDN via an `<script type="importmap">` block.

## Flight modes

Press **`K`** to toggle between the two control philosophies. The HUD mode chip shows which is active.

| Mode | Feel | Applies to |
|---|---|---|
| **Easy Mode** (Hovercraft) | Free 6-DoF — fly in any direction, stop and hover anywhere, no stall, no inertia to fight. The default; best for exploring the volumes. | All presets |
| **Realistic Mode** | Second-order physics. **Drone** (Mavic 3) = tilt-to-translate quadrotor with actuator lag, inertia, and a full systems stack (battery, RTH, signal loss, geofence). **Airplane** (Cessna / Learjet / 777) = lift/drag/thrust with stall + energy trade, bank-to-turn. | Mavic 3 + fixed-wing |

The **UFO** (100× preset) always hovercrafts — it's the "warp around the country" view and ignores realism.

Aircraft also drift in a **wind field** (Realistic mode only); the minimap draws both your nose vector and your ground-track so you can see the crab angle.

## Controls

| Input | Action |
|---|---|
| Click on the scene | Capture mouse (pointer-lock) |
| Mouse | Look around (pointer-locked, or click-and-drag) · `Esc` releases lock |
| `1` … `5` | Select aircraft — **1** Mavic 3 · **2** Cessna 172 · **3** Learjet · **4** Boeing 777 · **5** UFO |
| `K` | Toggle **Easy Mode (Hovercraft) ↔ Realistic** |
| `W` / `A` / `S` / `D` | Easy/Drone: forward / strafe. Airplane: `W`/`S` throttle, `A`/`D` bank (ailerons) |
| `Q` / `E` | Descend / ascend (throttle in Drone mode). Airplane: `Q`/`E` pitch down/up |
| `Space` | Toggle hover (Drone / Easy — freezes position, mouse-look still works) |
| `Shift` / `Ctrl` | Boost (×, capped per preset) / precision (÷3 fine positioning) |
| `R` | **Return-to-Home** toggle (Drone mode only) — climb to 60 m AGL, fly to launch, land |
| `P` | Pause / resume (also the **Pause** button in the HUD) |
| `V` | Toggle 1st ↔ 3rd-person chase cam. The model is the selected aircraft (`1`–`5`) |
| `↓` / `←` / `→` | Down / left / right camera view (press again to return to forward) |
| `I` | Identify mode — center-ray pick; bottom cards list each volume with distance, and floating 3D labels appear. (Disabled during a tour.) |
| `J` | Toggle the altitude tape |
| `H` | Toggle the attitude indicator (artificial horizon) |
| `U` | Toggle units (metric ↔ aeronautical kt/ft/NM) |
| `M` | Toggle map-primary view (orthographic radar fills viewport; 3D scene becomes a small inset) |
| `+` / `-` | Zoom the radar in/out (alongside mouse scroll) |
| HUD 1× / … / 100× | Sim-speed multiplier — and the aircraft-preset row doubles as the `1`–`5` selector |

> **Note on key choices:** the standard drone convention `R` = Return-to-Home is used (the playbook's draft `H` was already the horizon toggle), and `K` toggles Easy↔Realistic (`M` was already map-primary). Both are shown in the in-app help.

**Gamepad** (Realistic mode): plug in an Xbox-style controller and the sticks fly the aircraft (Mode 2 default — left stick throttle/yaw, right stick pitch/roll; Mode 1 selectable in Settings). A configurable **deadzone** hides stick drift and **expo** softens the center. Mouse sensitivity, deadzone, expo, and stick mode all live in the Settings panel and persist to `localStorage`.

**Airplane specifics:** always moving forward — can't stop or reverse. `W`/`S` throttle between the per-preset minimum and cruise; below ~1.05× stall speed the nose drops and you lose altitude. Minimum speeds: Cessna 130 km/h, Learjet 240 km/h, B777 370 km/h.

### HUD, instruments & tours

| Element | What it does |
|---|---|
| Altitude tape (`J`, or **Altitude** button) | Auto-zooming vertical bar glued to the HUD's right edge — red dashed **90 m AGL** drone limit (CAAT, terrain-relative), a brown ground line, ticks every 100 m / 1 000 m, and reference bands for drone / heli ops / GA / jet climb / airliner cruise. Rescales as you climb (200 m near the deck → 45 km at FL400). |
| Attitude indicator (`H`, or **Horizon** button) | Artificial horizon — transparent face with a faint contrast wash, rotates with bank, slides with pitch, yellow aircraft-symbol bars + bezel bank scale. |
| Battery / LINK / NEXT chips | Realistic Drone HUD — battery %, radio-link bars, and a predictive "→ AIRSPACE in Ns · floor/ceil" chip when you're heading toward a volume. |
| Altitude warnings | Each aircraft has an **operational** (service ceiling) and **regulated** (legal) limit. The advisor shows a single banner + a chip on the altitude tape: amber *approaching* a ceiling, red *over* it (`OUT OF REGULATED RANGE — descend to …`). Edit per-aircraft limits in Settings → **Altitude limits**. Warnings always show; they don't push you down (see CAAT toggle). |
| **CAAT: OFF/ON** toggle (HUD, bottom of telemetry) | Strict CAAT enforcement. **Default OFF** = advisory only, so the tour and jets fly unrestricted. **ON** = the Mavic 3 is clamped to 120 m AGL in controlled airspace and no-fly zones snap you back. Persists across reloads. |
| Settings → **Ground detail** | Tile-zoom preset: Low (z10) / Med (z12) / High (z12) / Ultra (z13) / **Auto** (alt-adaptive). |
| **▶ FLIGHT HISTORY** strip | Collapsible (default collapsed) — a count badge; expand for the last 100 course/location/mode/preset/RTH/boundary changes (newest first). A camera view change is **not** logged. Undo/redo jumps between logged points. |
| Panel → **Express tour (~5 min)** | Guided Bangkok takeoff → capital-region CTR/TMA/R/P/D highlights → Welcome to Explore, with a slow camera orbit at each stop. |
| Panel → **Full country tour (~22 min)** | Nationwide rotorcraft-relevant volumes (major airports, royal zones, islands, training areas, rules recap). |
| **Skip stop** / **End tour** (overlay) | Advance or exit the tour |

At 1× the Mavic cruises ~50 km/h; use the sim-speed buttons (up to 100×, the UFO) to cross the 300 km area faster, with `Shift` boost on top (capped per preset).

## Drone systems (Realistic Mode)

When you fly the Mavic 3 in Realistic Mode, a full CAAT-flavoured systems stack comes alive (`src/failures.js`, `src/terrain.js`):

- **Battery** — drains by activity (hover ~22 min, cruise ~28 min, max-throttle ~15 min to empty); HUD chip goes green → yellow → red; resets on a 2 s ground contact ("battery swap").
- **Return-to-Home** — auto-engages below 25 % battery or after 3 s of signal loss, or manually with `R`. State machine: ascend to 60 m AGL → fly to launch → descend → land.
- **Signal loss** — link quality falls with distance from launch (zero at ~10 km); random dropouts below 50 % freeze pilot input, and >3 s of contiguous loss triggers RTH.
- **AGL terrain** — ground elevation comes from a 30 arc-sec SRTM-baked grid (`data/terrain.bin`), so the altitude tape's 90 m limit and the geofence ceiling are height-above-ground, not above sea level. Fly over Doi Inthanon (2 565 m) at 2 600 m AMSL and the AGL chip reads ~40 m.
- **Tiered geofence** — three CAAT-style tiers surface as a single prioritized banner: *advisory* (within 5 NM of a CTR/TMA), *authorisation* (inside Class D/TMA), and *no-fly* (Prohibited or military CTR). Hidden military zones still register. **By default these are advisory only** (warnings, no physical enforcement) so the Airspace Tour and non-drone aircraft fly freely — operator decision, so the tour never gets "kicked back." Turn on the **CAAT** toggle to make enforcement real: the Mavic 3 clamps to 120 m AGL inside controlled airspace and no-fly zones snap the aircraft back to its last safe position.

## What you see

- **Ground:** zoom-9 base grid plus zoom-12 detail tiles (Medium) that follow the aircraft (`DynamicGround` in `src/ground.js`), over CARTO Positron basemap tiles; bolder province boundaries and prominence-tinted city beacon halos. Bangkok (13.7563°N, 100.5018°E) is at the origin.
- **Sky:** the three.js `Sky` shader (Rayleigh/Mie scattering) with a sun disc, **re-centred on the camera every frame** so the blue dome always surrounds you (no black void when you fly far out). Vivid blue up to ~60 km AMSL, fading to space-black by ~100 km.
- **Airspaces:** continuous **translucent extruded walls** with a floor→ceiling colour gradient and outline rings — not wireframe cages. Optional 3D sprite labels. Colored by category — red CTR, orange TMA, yellow Class D, solid-red Prohibited, purple Restricted, deep-orange Danger. Prohibited/Restricted also get a colorblind-safe pattern — diagonal hatch / dot grid — on both the 3-D walls (procedural, world-space) and the radar.
- **Cities & provinces:** Thai city beacons and a muted province-boundary overlay for spatial orientation.
- **Compass:** N/S/E/W marker poles at ±200 km.
- **HUD (top-left):** lat/lon, **Amphoe + Province** (Nominatim), AMSL + AGL altitude, heading compass, speed, vertical speed, wind, battery/link/next chips, mode chip, inside-airspace chips, the collapsible flight-history strip, and the **CAAT** toggle.
- **Alerts:** a single prioritized banner (no-fly > authorisation > RTH > over-regulated > over-operational > approaching > advisory) with lower-priority alerts shown as chips beneath it — one banner at a time, never a stack.
- **Minimap (bottom-left):** top-down radar with optional basemap underlay, FOV cone, range rings, baked airspace polygons, nose + ground-track vectors. Toggles above the minimap.
- **Educational panel (top-right):** **Airspace Tour Guide**, legend, Thailand drone rules summary, settings (mouse/gamepad/ground detail), and a clickable list of every airspace with an 8-direction compass-rose to view it from any cardinal vantage.
- **Tour overlay (bottom-center):** scripted narration, progress bar, skip/end controls.

## Projection & simplifications

This is a flat-earth, equirectangular projection scaled by `cos(13.7563°)` for longitude — accurate to a fraction of a percent within the ~300 km area we care about, *not* suitable for anything bigger.

- **Terrain** is now a 30 arc-sec SRTM-baked elevation grid (`data/terrain.bin`, built by `scripts/bake_terrain.py` from AWS Terrain Tiles) covering 5.6–20.5°N × 97.3–105.7°E. AGL is computed against it. (Earlier phases treated AGL = AMSL on a flat plane.)
- Polygons that the AIP defines with *arc segments* (e.g. Kanchanaburi/Suphan Buri/Hua Hin training areas) are approximated as straight-line polygons — flagged with `"approximate": true` in `data/airspaces.json` and marked **approx** in the UI.
- Airspace volumes use vertical prisms (the lower/upper altitudes); circular zones are tessellated to 64-gons.

## Airspace data — sourced vs. approximate

Sources: AIP Thailand ENR 2.1 (FIR/UIR/TMA, 2021-08-12 AIRAC) and ENR 5.1 (Prohibited/Restricted/Danger, 2020-11-05 AIRAC) at <https://aip.caat.or.th/>.

### Sourced from AIP (boundaries authoritative)

| ID | Name | Boundary type |
|---|---|---|
| VTBD-CTR | Bangkok Control Zone (35 NM around VTBD ARP) | Circle, exact |
| VTBD-TMA | Bangkok Terminal Control Area (50 NM around VTBD ARP) | Circle, exact |
| KPS-CTR | Kamphaeng Saen Control Zone (25 NM around KPS TACAN) | Circle, exact |
| VTBP-CTR | Hua Hin (VTBP) Control Zone (10 NM around HHN DVOR/DME) | Circle, exact |
| VTP4 | Muang Kom prohibited | Polygon, exact |
| VTP7 | Sattahip Naval Base prohibited | Circle, exact |
| VTR1 | Bangkok City restricted | Circle, exact |
| VTR2 | Chitralada Palace restricted | Circle, exact |
| VTR11 | Ko Hin Chalam (Sattahip) restricted | Circle, exact |
| VTR13 | Ko Samet (Rayong) restricted | Circle, exact |
| VTR80 | Srapathum Palace restricted | Circle, exact |
| VTD21-1 | Sattahip Bay Area 1 (Danger) | Polygon, exact |

### Approximate (flagged in UI)

| ID | Name | Why approximated |
|---|---|---|
| VTBU-CTR | U-Tapao (Rayong/Pattaya) Control Zone | Approximate CTR centered on VTBU ARP — verify with current AD 2.VTBU. **Note:** VTBU is U-Tapao, ~140 km SE of Bangkok — well within the 300 km Phase 1 ring. (Khon Kaen is VTUK, not VTBU.) |
| VTBU-TMA | U-Tapao Terminal Area | Approximate, not from a primary source in the scope we pulled |
| VTR8 | Kamphaeng Saen Jettison polygon | Vertices interpreted from DDMMSS, please re-verify |
| VTD16-1 | Ratchaburi Area 1 (Danger) | Coastline-following segment approximated as straight line |
| VTD17 | Kanchanaburi (Danger) | AIP defines with a 45 NM arc around BKK VOR — approximated as polygon |
| VTD18 | Suphan Buri (Danger) | Same arc approximation |
| VTD20 | Hua Hin civil training (Danger) | Coastal + arc segment approximated |

## How to add an airspace

Open `data/airspaces.json` and append an entry to the `airspaces` array. Minimum fields:

```json
{
  "id": "VTR99",
  "name": "Example Airspace",
  "shortName": "Example",
  "category": "Restricted",
  "class": "R",
  "lowerFt": 0,
  "upperFt": 5000,
  "lowerRef": "GND",
  "upperRef": "AMSL",
  "shape": "circle",
  "center": [13.5, 100.5],
  "radiusNM": 5,
  "approximate": false,
  "source": "AIP ENR 5.1 (YYYY-MM-DD)",
  "description": "Short blurb shown in the UI."
}
```

For a polygon, use `"shape": "polygon"` and `"points": [[lat, lon], ...]` in decimal degrees.

Categories the renderer knows about: `CTR` (red), `TMA` (orange), `Class D` (yellow), `Prohibited` (solid red, higher opacity), `Restricted` (purple), `Danger` (deep orange).

Set `approximate: true` whenever you've interpolated arcs into polygons, dropped a coastline-following segment, or otherwise simplified — the UI marks these with an `approx` badge so a reader knows not to trust them.

## File layout

```
kuson_thailandairspace_sim/
├── index.html          # entry — UI shell, importmap, styles
├── src/
│   ├── main.js         # Three.js scene, render loop, bootstrap, DPR adapt, touch gate
│   ├── drone.js        # flight controls, aircraft models, mode dispatch, systems wiring
│   ├── physics.js      # QuadrotorModel + FixedWingModel (second-order flight models)
│   ├── modes.js        # FlightMode enum + Easy/Realistic resolution
│   ├── simMode.js      # SimMode state machine (free/flyingTo/touring/paused/replay)
│   ├── failures.js     # battery, return-to-home, radio link, tiered geofence
│   ├── terrain.js      # SRTM-baked AGL lookup (loads data/terrain.bin)
│   ├── wind.js         # wind field for ground-track crab
│   ├── input.js        # deadzone / expo / gamepad polling
│   ├── airspace.js     # JSON loader, translucent wall meshes, AABB point-in-volume, predict
│   ├── identify.js     # analytical ray-vs-prism center pick
│   ├── ground.js       # dynamic ground tiles + minimap tile cache
│   ├── sky.js          # three.js Sky shader + sun (camera-following dome)
│   ├── cities.js / provinces.js  # Thai city beacons (halos) + province overlay
│   ├── coords.js       # lat/lon ↔ world XZ (equirectangular + cos(lat) scale)
│   ├── simState.js     # Strict-CAAT flag + isStrictCaat() seam
│   ├── ceilings.js     # per-aircraft op/reg altitude ceilings + overrides
│   ├── altitudeAdvisor.js  # per-preset ceiling warning state machine
│   ├── alerts.js       # single-banner alert priority queue
│   ├── flyto.js / tourGuide.js / flightHistory.js  # fly-to ({ok,reason}), tours, event-log + undo
│   ├── geolocation.js / geocode.js               # start location, Amphoe/Province lookup
│   └── ui.js           # HUD, minimap (offscreen-baked), panel, settings, instruments, alerts
├── data/
│   ├── airspaces.json  # the airspace catalog (sourced + approximate)
│   ├── terrain.bin     # 30 arc-sec SRTM elevation grid (Uint16) + terrain.json metadata
│   ├── airspaceTour.json
│   └── provinces.geojson
├── scripts/
│   ├── build_airspaces.py  # AIP → airspaces.json
│   └── bake_terrain.py     # AWS Terrain Tiles → terrain.bin
├── README.md · spec.md
└── LICENSE             # MIT
```

## Audience

Built for a Bangkok-based hobbyist or teenager learning what those colored shapes on aeronautical charts actually mean, and what CAAT drone rules feel like in practice. English UI. Focused on Bangkok and the ~300 km around it; terrain coverage extends nationwide.

## Disclaimer

**Educational visualization only. Not for flight planning. Data may be approximate or out of date. Consult CAAT and current AIP Thailand.**

## License

MIT — see `LICENSE`.
