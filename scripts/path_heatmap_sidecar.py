#!/usr/bin/env python3
"""Poll airplanes.live and append path-heatmap JSONL shards."""

import argparse
import json
import math
import sys
import time
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

FT_TO_M = 0.3048
FL100_M = 10000 * FT_TO_M
FL290_M = 29000 * FT_TO_M

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_CONFIG = SCRIPT_DIR / "path_heatmap_config.json"


def load_config(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def alt_bin_from_alt_m(alt_m, on_ground):
    if on_ground or not isinstance(alt_m, (int, float)) or not math.isfinite(alt_m):
        return 0
    if alt_m < FL100_M:
        return 1
    if alt_m < FL290_M:
        return 2
    return 3


def lat_lon_to_cell(lat, lon, bbox, cell_deg):
    if lat < bbox["lamin"] or lat >= bbox["lamax"] or lon < bbox["lomin"] or lon >= bbox["lomax"]:
        return None
    return {
        "cellX": int(math.floor((lon - bbox["lomin"]) / cell_deg)),
        "cellY": int(math.floor((lat - bbox["lamin"]) / cell_deg)),
    }


def bucket_id(epoch_ms, bucket_sec):
    return int(epoch_ms // 1000 // bucket_sec)


def normalize_ac(ac):
    if ac is None or not isinstance(ac.get("lat"), (int, float)) or not isinstance(ac.get("lon"), (int, float)):
        return None
    on_ground = ac.get("alt_baro") == "ground"
    if on_ground:
        alt_ft = 0
    elif isinstance(ac.get("alt_baro"), (int, float)):
        alt_ft = ac["alt_baro"]
    else:
        alt_ft = ac.get("alt_geom") or 0
    return {"lat": ac["lat"], "lon": ac["lon"], "altM": alt_ft * FT_TO_M, "onGround": on_ground}


def splat_positions(ac_list, config, now_ms):
    bbox = config["bbox"]
    cell_deg = config["cellDeg"]
    bucket_sec = config["bucketSec"]
    b_id = bucket_id(now_ms, bucket_sec)
    records = []
    for ac in ac_list:
        nf = normalize_ac(ac)
        if not nf:
            continue
        alt_bin = alt_bin_from_alt_m(nf["altM"], nf["onGround"])
        if alt_bin == 0:
            continue
        cell = lat_lon_to_cell(nf["lat"], nf["lon"], bbox, cell_deg)
        if not cell:
            continue
        records.append({
            "bucketId": b_id,
            "cellX": cell["cellX"],
            "cellY": cell["cellY"],
            "altBin": alt_bin,
            "count": 1,
        })
    return records


def fetch_center(base, lat, lon, radius_nm):
    url = f"{base}/v2/point/{lat}/{lon}/{radius_nm}"
    req = urllib.request.Request(url, headers={"User-Agent": "kuson-path-heatmap-sidecar/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def poll_once(config):
    base = config["adsbxBase"]
    radius = config["queryRadiusNm"]
    by_hex = {}
    for center in config["queryCenters"]:
        try:
            data = fetch_center(base, center["lat"], center["lon"], radius)
            for ac in data.get("ac") or []:
                hex_id = ac.get("hex")
                if hex_id and hex_id not in by_hex:
                    by_hex[hex_id] = ac
        except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError, TimeoutError) as err:
            print(f"fetch {center['lat']},{center['lon']}: {err}", file=sys.stderr)
    return list(by_hex.values())


def append_records(out_dir, records):
    if not records:
        return None
    path = Path(out_dir) / f"{date.today().isoformat()}.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        for rec in records:
            f.write(json.dumps(rec, separators=(",", ":")) + "\n")
    return path


def run_once(config, out_dir):
    now_ms = int(time.time() * 1000)
    ac_list = poll_once(config)
    records = splat_positions(ac_list, config, now_ms)
    path = append_records(out_dir, records)
    print(f"{len(ac_list)} aircraft → {len(records)} splats" + (f" → {path}" if path else ""))
    return len(records)


def main():
    parser = argparse.ArgumentParser(description="Path heatmap sidecar — poll ADS-B and write JSONL shards")
    parser.add_argument("--interval", type=int, default=60, help="Poll interval in seconds (default 60)")
    parser.add_argument("--out", default="data/path_heatmap_shards", help="Output directory for JSONL shards")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG), help="Path to path_heatmap_config.json")
    parser.add_argument("--once", action="store_true", help="Poll once and exit")
    args = parser.parse_args()

    config = load_config(args.config)
    if args.once:
        run_once(config, args.out)
        return

    print(f"Sidecar polling every {args.interval}s → {args.out}", file=sys.stderr)
    while True:
        run_once(config, args.out)
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
