#!/usr/bin/env python3
"""
Server locale per provare il sito.

A differenza di "python3 -m http.server" supporta le richieste HTTP Range:
servono per spostarsi in un punto del mix non ancora scaricato e a Safari,
che senza Range non riproduce l'audio. Usa solo la libreria standard.

Uso:
  python3 scripts/serve.py          → http://localhost:8000
  python3 scripts/serve.py 8080     → su un'altra porta
  python3 scripts/serve.py --lan    → raggiungibile anche da altri dispositivi
                                      della stessa rete (es. per provare su iPhone)
"""

import argparse
import http.server
import os
import re
import socket
from functools import partial

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RANGE = re.compile(r"^bytes=(\d*)-(\d*)$")


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".json": "application/json",
        ".mp3": "audio/mpeg",
        ".svg": "image/svg+xml",
        ".woff2": "font/woff2",
    }

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_head(self):
        self.range_length = None
        match = RANGE.match(self.headers.get("Range", "").strip())
        path = self.translate_path(self.path)
        if not match or not any(match.groups()) or not os.path.isfile(path):
            return super().send_head()  # richiesta normale: risposta completa

        f = open(path, "rb")
        size = os.fstat(f.fileno()).st_size
        first, last = match.groups()
        if first:
            start, end = int(first), min(int(last) if last else size - 1, size - 1)
        else:  # "bytes=-N": gli ultimi N byte
            start, end = max(0, size - int(last)), size - 1
        if start >= size or start > end:
            f.close()
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None

        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Last-Modified", self.date_time_string(int(os.fstat(f.fileno()).st_mtime)))
        self.end_headers()
        f.seek(start)
        self.range_length = end - start + 1
        return f

    def copyfile(self, source, outputfile):
        try:
            if self.range_length is None:
                super().copyfile(source, outputfile)
                return
            remaining = self.range_length
            while remaining > 0:
                chunk = source.read(min(64 * 1024, remaining))
                if not chunk:
                    break
                outputfile.write(chunk)
                remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass  # il browser ha interrotto la richiesta (normale durante il seek)


def lan_address():
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        try:
            s.connect(("10.255.255.255", 1))  # nessun pacchetto viene inviato
            return s.getsockname()[0]
        except OSError:
            return "IP-del-computer"


def main():
    parser = argparse.ArgumentParser(description="Server locale con supporto alle richieste Range.")
    parser.add_argument("port", nargs="?", type=int, default=8000, help="porta (default 8000)")
    parser.add_argument("--lan", action="store_true", help="accetta connessioni dalla rete locale")
    args = parser.parse_args()

    host = "0.0.0.0" if args.lan else "127.0.0.1"
    handler = partial(Handler, directory=ROOT)
    with http.server.ThreadingHTTPServer((host, args.port), handler) as server:
        print(f"Sito su http://localhost:{args.port}/  (Ctrl+C per fermare)")
        if args.lan:
            print(f"Dagli altri dispositivi della rete: http://{lan_address()}:{args.port}/")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nServer fermato.")


if __name__ == "__main__":
    main()
