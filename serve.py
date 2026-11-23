"""Server lokal kantor 3D tanpa cache browser: setiap refresh selalu memuat file terbaru.

    python serve.py          # http://localhost:8080
    python serve.py 9000     # port lain
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class NoCacheHandler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".glb": "model/gltf-binary"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def log_message(self, fmt, *args):  # sunyi, kecuali error
        if args and str(args[1])[:1] in "45":
            super().log_message(fmt, *args)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    root = Path(__file__).resolve().parent
    print(f"Aranter Agent Office di http://localhost:{port}  (tanpa cache, Ctrl+C untuk berhenti)")
    ThreadingHTTPServer(("127.0.0.1", port), partial(NoCacheHandler, directory=str(root))).serve_forever()
