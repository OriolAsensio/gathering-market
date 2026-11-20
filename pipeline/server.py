"""Servidor de pruebas: sirve la app (carpeta app/) para abrirla en el navegador del PC.

Toda la lógica vive ahora en la propia app (app/engine.js) y los datos llegan en el
"paquete" de app/pack/ (lo genera pipeline/export_pack.py). En el móvil no hace falta
este servidor: la app de Android lleva todo dentro.

Uso:  python pipeline/server.py          -> http://localhost:8000
      python pipeline/server.py --lan    -> también desde el móvil en la misma wifi
"""
import socket
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from db import ROOT

APP_DIR = ROOT / "app"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(APP_DIR), **kw)

    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def main():
    lan = "--lan" in sys.argv
    port = int(sys.argv[sys.argv.index("--port") + 1]) if "--port" in sys.argv else 8000
    server = ThreadingHTTPServer(("0.0.0.0" if lan else "127.0.0.1", port), Handler)
    print(f"App en http://localhost:{port}")
    if lan:
        print(f"Desde el móvil (misma wifi): http://{socket.gethostbyname(socket.gethostname())}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
