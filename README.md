# Thai Airspace Sim — Bangkok (Phase 1)

A single-page web app that teaches Thai airspace around Bangkok by letting you fly a virtual drone through 3D extruded airspace volumes. No build step — open `index.html` in a browser and go.

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

## Controls

| Input | Action |
|---|---|
| Click on the scene | Capture mouse (pointer-lock) |
| `W` / `A` / `S` / `D` | Move forward / strafe |
| `Q` / `E` | Descend / ascend |
| `Shift` | Boost 3× on top of the selected sim-speed multiplier |
| HUD 1× / 5× / 25× / 50× / 100× | Set sim-speed multiplier (default 1×) |
| `Space` | Toggle hover (freezes position — mouse-look still works) |
| Mouse | Look around (pointer-locked, or click-and-drag) |
| `Esc` | Release pointer-lock |
| `↓` / `←` / `→` | Down / left / right camera view (press again to return to forward) |
| `I` | Identify mode — center-ray pick, bottom cards show each volume with distance to nearest point |
| `U` | Toggle units (metric ↔ aeronautical kt/ft/NM) |
| `M` | Toggle map-primary view (orthographic radar fills viewport; 3D scene becomes a bottom-right inset) |
| `+` / `-` | Zoom map in/out (alongside mouse scroll) |
| `V` | Toggle 1st ↔ 3rd-person view. In 3rd-person you see your aircraft from behind. **Model auto-swaps with the speed preset:** 1× = Mavic 3 drone, Cessna 172 = light GA, Learjet = bizjet, 777 = airliner (scaled down to "cute"), 100× = **UFO** (flying saucer). |
| `P` | Pause / resume the simulation (also the **Pause** button in the HUD). |
| **Airplane mode** (Cessna 172 / Learjet / Boeing 777) | Always moving forward — cannot stop or reverse. `A`/`D` = **bank with ailerons** (roll → coordinated turn via level-turn equation). `W`/`S` = throttle up/down between **stall+10%** and cruise×3. `Q`/`E` = pitch down/up. Stall floors: Cessna 130 km/h, Learjet 240 km/h, B777 370 km/h. |
| **Drone / UFO mode** (1× / 100×) | Free 6-DoF strafe — `W/A/S/D` translate, `Q/E` descend/ascend, `Space` hover. |
| Altitude tape (HUD-right, toggleable from **Altitude** button) | Auto-zooming vertical bar **glued to right edge of HUD at equal height** — red dashed line at the **90 m drone limit (CAAT)**, ticks every 100 m / 1 000 m, reference bands for drone / helicopter ops / GA / jet climb / airliner cruise. Scale top auto-rescales as the aircraft climbs (200 m near the deck → 45 km at FL400). |
| Attitude indicator (center, toggleable from **Attitude** button) | Classic 6-pack artificial horizon — brown earth / blue sky split, rotates with bank, slides with pitch, yellow aircraft-symbol bars + bezel bank scale (0/±10/±20/±30/±45/±60°). |
| Settings → **Ground detail** | Tile-zoom preset: Low (z10) / Med (z11) / High (z12) / Ultra (z13) / **Auto** (alt-adaptive: high <500 m, med 500–3000 m, low above). |
| Panel → **Express tour (~5 min)** | Guided flight: Bangkok takeoff → capital-region CTR/TMA/R/P/D highlights → Welcome to Explore. Slow camera **orbit at each stop**. |
| Panel → **Full country tour (~22 min)** | Nationwide rotorcraft-relevant volumes (major airports, royal zones, islands, training areas, rules recap). Slow camera orbit at each stop. |
| **Skip stop** / **End tour** (overlay) | Advance or exit the tour |

Cruise speed is 30 m/s (108 km/h) at 1×. Use the HUD sim-speed buttons (up to 100×) to traverse the 300 km area faster; Shift still adds a 3× boost on top.

## What you see

- **Ground:** zoom-8 base grid plus zoom-11 detail tiles that follow the drone (`DynamicGround` in `src/ground.js`). Bangkok (13.7563°N, 100.5018°E) is at the origin.
- **Sky:** a vertical gradient on a back-side sphere, plus distance fog for depth.
- **Airspaces:** wireframe cages (top/bottom rings, vertical ribs, top-cap disc) between each volume's lower and upper altitude — optional 3D sprite labels (toggle in panel). Colored by category — red CTR, orange TMA, yellow Class D, solid-red Prohibited, purple Restricted, deep-orange Danger.
- **Compass:** N/S/E/W marker poles at ±200 km (5× larger horizon labels than original build).
- **HUD (top-left):** drone lat/lon, **Amphoe + Province** (Nominatim), altitude, heading, speed, sim-speed buttons, and inside-airspace chips.
- **Minimap (bottom-left):** top-down 300 km view with optional OSM map underlay, FOV cone, range rings, airspace outlines, drone arrow. Toggles above the minimap.
- **Educational panel (top-right):** **Airspace Tour Guide** (5-minute express from Bangkok, or full country tour), legend, Thailand drone rules summary, and a clickable list of every airspace that teleports the drone to an external vantage point.
- **Tour overlay (bottom-center):** scripted narration, progress bar, skip/end controls — takeoff climb, smooth warps between volumes, ends with **Welcome to Explore**.

## Phase-1 scope and simplifications

This is a flat-earth, equirectangular projection scaled by `cos(13.7563°)` for longitude — accurate to a fraction of a percent within the 300 km area we care about, *not* suitable for anything bigger.

- Ground is a flat plane. No elevation data (Thailand is flat-ish near Bangkok, but the western danger areas overlap real hills the sim doesn't show).
- AGL and AMSL are treated identically (no terrain), so Hua Hin CTR's "2000 ft AGL" upper is rendered as 2000 ft AMSL.
- Polygons that the AIP defines with *arc segments* (e.g. Kanchanaburi/Suphan Buri/Hua Hin training areas) are approximated as straight-line polygons — flagged with `"approximate": true` in `data/airspaces.json` and marked **approx** in the UI.

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
├── index.html         # entry — UI shell, importmap, styles
├── src/
│   ├── main.js        # Three.js scene, ground tiles, compass, bootstrap loop
│   ├── drone.js       # 6DoF flight controls, pointer-lock, hover/boost
│   ├── airspace.js    # JSON loader, extruded mesh builder, point-in-volume tests
│   ├── coords.js      # lat/lon ↔ world XZ (equirectangular + cos(lat) scale)
│   └── ui.js          # HUD, minimap, educational panel, teleport buttons
├── data/
│   └── airspaces.json # the airspace catalog (sourced + approximate)
├── README.md
└── LICENSE            # MIT
```

## Audience

Built for a Bangkok-based hobbyist or teenager learning what those colored shapes on aeronautical charts actually mean. English UI. Phase 1 focuses on Bangkok and the immediate ~300 km around it.

## Disclaimer

**Educational visualization only. Not for flight planning. Data may be approximate or out of date. Consult CAAT and current AIP Thailand.**

## License

MIT — see `LICENSE`.
