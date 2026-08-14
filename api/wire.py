import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from wire import build_wire, send_json


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            send_json(self, build_wire(), cache=120)
        except Exception as exc:  # noqa: BLE001
            send_json(self, {"error": str(exc)}, code=500, cache=0)
