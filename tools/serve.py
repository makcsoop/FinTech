#!/usr/bin/env python3
"""Локальный сервер сайта без кэша: python3 tools/serve.py [порт]  →  http://localhost:8765"""
import functools
import http.server
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


handler = functools.partial(NoCache, directory=str(SITE))
with http.server.ThreadingHTTPServer(("", PORT), handler) as srv:
    print(f"Honey Money: http://localhost:{PORT}  (Ctrl+C — остановить)")
    srv.serve_forever()
