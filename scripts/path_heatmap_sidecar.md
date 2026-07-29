# Path heatmap sidecar

Optional Python writer for traffic-heat shards when the browser tab is not recording (`writer: sidecar` in heat settings).

## Run

```bash
# One poll (dry-run / smoke)
python3 scripts/path_heatmap_sidecar.py --once

# Continuous (default 60s interval)
python3 scripts/path_heatmap_sidecar.py --interval 60 --out data/path_heatmap_shards
```

Reads `scripts/path_heatmap_config.json` (bbox, cell size, bucket, FL bins, query centers). Polls `airplanes.live` point API for both centers, splats like the browser collector, appends to `data/path_heatmap_shards/YYYY-MM-DD.jsonl`.

## Import in UI

1. Set heat **writer** to **sidecar** and turn recording off in the browser.
2. Run the sidecar on a machine with network access.
3. In the sim UI → Traffic heat → **Import shards**, pick one or more `.jsonl` files.

Status line shows imported record count and skipped bad lines.
