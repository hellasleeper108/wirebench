#!/usr/bin/env python3
"""WIREBENCH 1.3 — local Workbench station + public RSS proxy."""

from __future__ import annotations

import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from wire import (
    FEEDS,
    HOST,
    PORT,
    build_desks,
    build_status,
    build_wire,
    cached_feed,
    refresh_all,
    search_all,
    send_json,
)

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "public"
if not STATIC.exists():
    STATIC = ROOT / "static"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC), **kwargs)

    def log_message(self, fmt, *args):
        import sys

        sys.stderr.write("[wirebench] " + (fmt % args) + "\n")

    def _err(self, message, code=500):
        send_json(self, {"error": message}, code=code, cache=0)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        q = parse_qs(parsed.query)
        try:
            if path == "/api/status":
                return send_json(self, build_status(), cache=30)
            if path == "/api/desks":
                return send_json(self, build_desks(), cache=120)
            if path == "/api/wire":
                return send_json(self, build_wire(), cache=120)
            if path == "/api/search":
                return send_json(self, search_all((q.get("q") or [""])[0]), cache=60)
            if path in ("/", "/index.html"):
                self.path = "/index.html"
            return super().do_GET()
        except Exception as exc:  # noqa: BLE001
            self._err(str(exc), 500)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/refresh":
            try:
                return send_json(self, refresh_all(), cache=0)
            except Exception as exc:  # noqa: BLE001
                return self._err(str(exc), 500)
        self._err("not found", 404)


def warm():
    def _run():
        for name in FEEDS:
            try:
                cached_feed(name)
            except Exception:
                pass

    threading.Thread(target=_run, daemon=True).start()


def main():
    warm()
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"WIREBENCH 1.3  http://{HOST}:{PORT}/")
    print("Feeds: BBC · Guardian · NPR · Al Jazeera · NASA · Texas Tribune · HPM · Defense.gov")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nDF0: motor off")
        httpd.server_close()


if __name__ == "__main__":
    main()
