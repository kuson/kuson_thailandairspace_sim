#!/usr/bin/env python3
"""PostToolUse hook: docs/**/*.md (except 90-archive) must start with KDS frontmatter."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def main() -> int:
    raw = sys.stdin.read().strip()
    payload: dict = {}
    if raw:
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            return 0

    tool_input = payload.get("tool_input") or {}
    file_path = tool_input.get("file_path") or tool_input.get("path")
    if not file_path:
        return 0

    path = Path(file_path)
    if not path.is_absolute():
        root = Path(os.environ.get("CLAUDE_PROJECT_DIR") or payload.get("cwd") or os.getcwd())
        path = (root / path).resolve()

    if path.suffix.lower() != ".md":
        return 0

    parts = path.parts
    try:
        docs_idx = parts.index("docs")
    except ValueError:
        return 0

    rel_after_docs = parts[docs_idx + 1 :]
    if not rel_after_docs or rel_after_docs[0] == "90-archive":
        return 0
    if not path.is_file():
        return 0

    text = path.read_text(encoding="utf-8")
    if text.startswith("---\n") and "\nid:" in text[:400]:
        return 0

    print(
        f"KDS frontmatter missing in {path}. Add the §3 YAML block before the title.",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
