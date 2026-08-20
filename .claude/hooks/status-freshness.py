#!/usr/bin/env python3
"""Non-blocking Stop hook: remind /status-update when STATUS.yaml is stale (SPEC §7)."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def find_root(start: Path) -> Path | None:
    cur = start.resolve()
    for candidate in [cur, *cur.parents]:
        if (candidate / "STATUS.yaml").is_file():
            return candidate
    return None


def parse_updated(value: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        try:
            parsed = datetime.strptime(value[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def main() -> int:
    raw = sys.stdin.read().strip()
    payload: dict = {}
    if raw:
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {}

    cwd = Path(payload.get("cwd") or os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd())
    root = find_root(cwd)
    if root is None:
        return 0

    text = (root / "STATUS.yaml").read_text(encoding="utf-8")

    # R-28: a seeded template is worse than a stale file — say so first.
    if "Initialized by kstat init" in text or "Fill in STATUS.yaml" in text:
        print(
            "STATUS.yaml is still the kstat init template. "
            "Run /status-update to write genuine status before stopping.",
            file=sys.stderr,
        )
        return 0

    # R-31: an active project should always leave next prompts for the next session.
    status_value = None
    has_next_prompts = False
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("status:") and status_value is None:
            status_value = stripped.split(":", 1)[1].split("#", 1)[0].strip().strip("'\"")
        if stripped.startswith("next_prompts:"):
            has_next_prompts = not stripped.endswith("[]")
    if status_value not in ("shipped", "archived") and not has_next_prompts:
        print(
            "STATUS.yaml has no next_prompts. "
            "Run /status-update and leave 1-3 prompts for the next session.",
            file=sys.stderr,
        )

    updated = None
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("updated:"):
            updated = stripped.split(":", 1)[1].strip().strip("'\"")
            break
    if not updated:
        return 0

    updated_dt = parse_updated(updated)
    if updated_dt is None:
        return 0

    try:
        out = subprocess.check_output(
            ["git", "status", "--porcelain"],
            cwd=root,
            text=True,
            stderr=subprocess.DEVNULL,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        return 0

    dirty: list[Path] = []
    for line in out.splitlines():
        if len(line) < 4:
            continue
        rel = line[3:].strip()
        if " -> " in rel:
            rel = rel.split(" -> ", 1)[1]
        path = root / rel
        if path.is_file():
            dirty.append(path)

    if not dirty:
        return 0

    earliest = min(datetime.fromtimestamp(p.stat().st_mtime, tz=timezone.utc) for p in dirty)
    if updated_dt <= earliest:
        print(
            "STATUS.yaml is stale relative to modified files. "
            "Run /status-update before stopping.",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
