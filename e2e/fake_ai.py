"""A stand-in for Groq's OpenAI-compatible API, for the end-to-end tests. Tests queue the agent's next replies
(POST /script: a list of assistant messages, e.g. tool calls); requests with tools take them in order, then
answer with plain text. JSON requests (chat titles, query translations) get a fixed reply."""

import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

script: list[dict] = []


class Handler(BaseHTTPRequestHandler):
    def _reply(self, body: dict, status: int = 200) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self._reply({"status": "ok"})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        if self.path == "/script":
            script[:] = body
            return self._reply({"queued": len(script)})
        if "tools" in body:
            message = script.pop(0) if script else {"role": "assistant", "content": "Done."}
        else:
            message = {"role": "assistant", "content": json.dumps({"title": "E2E chat", "translations": {},
                                                                   "detected_language": "en"})}
        self._reply({"choices": [{"message": message}], "model": "fake",
                     "usage": {"prompt_tokens": 10, "completion_tokens": 5}})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
