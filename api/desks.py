import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from wire import build_desks, send_json


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            send_json(self, build_desks(), cache=120)
        except Exception as exc:  # noqa: BLE001
            send_json(self, {"error": str(exc)}, code=500, cache=0)
