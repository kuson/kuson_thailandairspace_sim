#!/usr/bin/env python3
"""Dev static server. Sends Cache-Control: no-store so edited ES modules are
never served stale from the browser cache (plain `python -m http.server`
sends no cache headers and old-mtime files get ~1 day heuristic freshness)."""
import http.server
import os
import sys

os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
http.server.ThreadingHTTPServer(("", port), NoCacheHandler).serve_forever()
