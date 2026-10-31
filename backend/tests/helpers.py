"""What the tests build their data with: books uploaded, reading sessions and lookups, a highlight, a review card, a
translation request; the fake AIs' replies (agent steps), and deterministic embeddings."""

import hashlib
import io
import json
import zipfile
from datetime import UTC, datetime, timedelta

import httpx
import numpy as np
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker

from app import indexer
from app.db import get_engine
from pico_core import embed


def info(data: bytes, content_type: str) -> dict:
    return {"size": len(data), "sha256": hashlib.sha256(data).hexdigest(), "content_type": content_type}

def upload(client, headers, files: dict[str, tuple[bytes, str]], **meta):
    body = {"title": "Der Prozess", "author": "Franz Kafka", "language": "de", **meta,
            "files": {kind: info(data, ct) for kind, (data, ct) in files.items()}}
    r = client.post("/api/admin/books", headers=headers, json=body)
    assert r.status_code == 200, r.text
    for kind, url in r.json()["uploads"].items():
        data, ct = files[kind]
        assert httpx.put(url, content=data, headers={"Content-Type": ct}).status_code == 200
    return r.json()["id"]

def tiny_epub() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("mimetype", "application/epub+zip")
        z.writestr("META-INF/container.xml", """<?xml version="1.0"?><container version="1.0"
            xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles>
            <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>""")
        z.writestr("OEBPS/content.opf", """<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0">
            <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Kleines Buch</dc:title><dc:language>de</dc:language></metadata>
            <manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>
            <spine><itemref idref="c1"/></spine></package>""")
        z.writestr("OEBPS/c1.xhtml", "<html><body><h1>Erstes Kapitel</h1>"
                   + "".join(f"<p>Die Wolke zog über das Land, Absatz {i}, und die Kinder liefen nach Hause.</p>" for i in range(30))
                   + "</body></html>")
    return buf.getvalue()

EPUB = tiny_epub()

def upload_epub(client, headers, data=EPUB, **meta) -> str:
    r = client.post("/api/books", headers=headers, json={"title": "Kleines Buch", "language": "de", **meta,
                                                         "files": {"epub": info(data, "application/epub+zip")}})
    assert r.status_code == 200, r.text
    assert httpx.put(r.json()["uploads"]["epub"], content=data, headers={"Content-Type": "application/epub+zip"}).status_code == 200
    assert client.post(f"/api/books/{r.json()['id']}/commit", headers=headers).status_code == 200
    return r.json()["id"]

def run_queue():
    db = sessionmaker(bind=get_engine())()
    while (job := indexer.claim(db)) is not None:
        indexer.run_job(db, job)
    db.close()

TZ = "Europe/Berlin"

def today_at(hour: int, days_ago: int = 0) -> str:
    from zoneinfo import ZoneInfo
    local = datetime.now(ZoneInfo(TZ)).replace(hour=hour, minute=0, second=0, microsecond=0) - timedelta(days=days_ago)
    return local.astimezone(UTC).isoformat()

def session(sid, book_id, days_ago, seconds, start=0.1, end=0.2, hour=9):
    return {"id": f"sess-{sid:08d}", "book_id": book_id, "format": "epub", "started_at": today_at(hour, days_ago),
            "ended_at": today_at(hour, days_ago), "seconds": seconds, "progress_start": start, "progress_end": end}

def lookup(lid, book_id, word, days_ago=0, found=True, matched=""):
    return {"id": f"look-{lid:08d}", "book_id": book_id, "language": "de", "word": word, "matched": matched,
            "dictionaries": ["duden"] if found else [], "found": found, "created_at": today_at(10, days_ago)}

def make_book(client, headers, words=10000):
    book_id = upload(client, headers, {"pdf": (b"%PDF x", "application/pdf")}, title="Die Wolke", language="de")
    client.post(f"/api/admin/books/{book_id}/commit", headers=headers)
    with get_engine().begin() as c:
        c.execute(text("UPDATE books SET word_count = :n WHERE id = :id"), {"n": words, "id": book_id})
    return book_id

HL = {"book_id": "b1", "kind": "highlight", "format": "epub", "location": "epubcfi(/6/8!/4/2,/1:0,/1:20)",
      "progress": 0.12, "text": "Sie hatten Mühe", "color": "yellow", "client_updated_at": "2026-10-24T10:00:00Z"}

CARD = {"language": "de", "term": "die Mühe", "meaning": "el esfuerzo", "example": "Sie hatten Mühe.",
        "state": {"stability": 1.2, "reps": 1}, "due": "2026-10-25T10:00:00Z", "client_updated_at": "2026-10-24T10:00:00Z"}

def call(name, args, cid="call_1"):
    return {"role": "assistant", "content": "", "tool_calls": [
        {"id": cid, "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}]}

def say(text_):
    return {"role": "assistant", "content": text_}

class FakeAgentAI:
    """Agent steps (requests with tools) come from `steps`; other JSON calls (titles, query translation)
    answer from `json_replies` or a default."""

    def __init__(self):
        self.steps, self.json_replies, self.agent_calls, self.json_calls = [], [], [], []

    def post(self, url, json=None, headers=None, timeout=None):
        import httpx
        if "tools" in json:
            self.agent_calls.append(json)
            step = self.steps.pop(0) if self.steps else say("Pruning removes **small** weights [1].")
            if isinstance(step, httpx.Response):
                return step
            return httpx.Response(200, json={"choices": [{"message": step}], "model": "agent-model",
                                             "usage": {"prompt_tokens": 900, "completion_tokens": 50}})
        self.json_calls.append(json)
        reply = self.json_replies.pop(0) if self.json_replies else {"title": "Pruning chat", "translations": {}}
        return httpx.Response(200, json={"choices": [{"message": {"content": __import__("json").dumps(reply)}}],
                                         "usage": {"prompt_tokens": 40, "completion_tokens": 8}})

def events(response) -> list[tuple[str, object]]:
    out = []
    for block in response.text.strip().split("\n\n"):
        name = block.split("\n")[0].removeprefix("event: ")
        out.append((name, json.loads(block.split("\n", 1)[1].removeprefix("data: "))))
    return out

def new(client, headers, cid="conv-00000001", **body):
    r = client.post("/api/conversations", headers=headers, json={"id": cid, **body})
    assert r.status_code == 200, r.text
    return cid

def ask(client, headers, cid, content):
    return events(client.post(f"/api/conversations/{cid}/messages", headers=headers, json={"content": content, "tz": "Europe/Berlin"}))

PASSAGES = [
    ("1 Pruning", "Pruning removes the weights with the smallest magnitude from the network."),
    ("2 Quantization", "Quantization stores each weight as an 8-bit integer instead of a float."),
    ("3 Distillation", "A small student network learns to imitate the outputs of a large teacher."),
]

def fake_vector(text: str) -> np.ndarray:
    """Letter trigrams hashed into 384 dimensions: texts sharing words get close vectors."""
    v = np.zeros(embed.DIMENSIONS)
    t = text.lower()
    for i in range(len(t) - 2):
        v[int(hashlib.md5(t[i:i + 3].encode()).hexdigest(), 16) % embed.DIMENSIONS] += 1
    return v / (np.linalg.norm(v) or 1)

GOOD = {"translation": "Janna-Berta vio cómo le hablaba a su marido.", "notes": "«einreden»: insistir.",
        "vocabulary": [{"term": "einreden", "meaning": "hablar con insistencia"}], "detected_language": "de"}

BODY = {"text": "Janna-Berta sah noch, wie sie auf ihren Mann einredete.", "context": "…", "source_lang": "de",
        "target_lang": "es", "book_id": "die-wolke", "location": "epubcfi(/6/8)"}
