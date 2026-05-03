"""
Space Jay – local HTTP server with no-cache headers.
GET /quit  →  kills Chrome (which unblocks the bat's Chrome line),
              then kills this Python process.
              The bat then cleans up port 8765 and calls exit — closing the terminal tab.
"""
import http.server, socketserver, os, signal, threading, subprocess, time

PORT = 8765
DIR  = os.path.dirname(os.path.abspath(__file__))

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)

    def do_GET(self):
        if self.path == '/quit':
            self.send_response(200)
            self.send_header('Content-Type',                'text/plain')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(b'bye')
            threading.Thread(target=_shutdown, daemon=True).start()
        else:
            super().do_GET()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma',        'no-cache')
        self.send_header('Expires',       '0')
        super().end_headers()

    def log_message(self, format, *args):
        pass


def _shutdown():
    time.sleep(0.4)  # let the HTTP response reach the browser

    # Kill Chrome — this unblocks the bat file's blocking Chrome call,
    # which then runs the cleanup lines and calls exit to close the terminal tab
    subprocess.call(
        ['powershell', '-NoProfile', '-NonInteractive', '-Command',
         'Stop-Process -Name chrome -Force -ErrorAction SilentlyContinue'],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )

    # Kill this Python server process
    time.sleep(0.2)
    os.kill(os.getpid(), signal.SIGTERM)


with socketserver.TCPServer(('', PORT), NoCacheHandler) as httpd:
    print(f'Space Jay server on http://localhost:{PORT}')
    httpd.serve_forever()
