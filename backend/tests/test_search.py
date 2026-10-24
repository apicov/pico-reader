import hashlib

import numpy as np
import pytest

from app import embed
from tests.test_library import upload
from tests.test_translate import groq  # noqa: F401 (fixture)

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


@pytest.fixture(autouse=True)
def fake_embed(monkeypatch):
    monkeypatch.setattr(embed, "embed", lambda texts, kind="passage", batch=32: np.vstack([fake_vector(t) for t in texts]))


@pytest.fixture
def indexed_book(client, admin_headers, bucket):
    book_id = upload(client, admin_headers, {"pdf": (b"%PDF-1.4 x", "application/pdf")}, title="Efficient ML", language="en")
    client.post(f"/api/admin/books/{book_id}/commit", headers=admin_headers)
    r = client.post(f"/api/admin/books/{book_id}/index/start", headers=admin_headers,
                    json={"format": "reflow", "sha256": "a" * 64, "model": embed.MODEL})
    assert r.status_code == 200, r.text
    chunks = [{"seq": i, "location": f"c{i}:0.0000", "progress": i / 3, "heading": h, "text": t,
               "embedding": fake_vector(t).tolist()} for i, (h, t) in enumerate(PASSAGES)]
    assert client.post(f"/api/admin/books/{book_id}/index/chunks", headers=admin_headers, json=chunks).json() == {"added": 3}
    return book_id


def test_library_reports_the_index(client, admin_headers, indexed_book):
    [book] = client.get("/api/library", headers=admin_headers).json()["books"]
    assert book["index"] == {"sha256": "a" * 64, "chunks": 3}


def test_search_finds_meaning_and_words(client, admin_headers, indexed_book):
    hits = client.get("/api/search", headers=admin_headers, params={"q": "8-bit integer weights"}).json()
    assert hits[0]["heading"] == "2 Quantization"
    assert hits[0]["location"] == "c1:0.0000" and hits[0]["title"] == "Efficient ML"


def test_search_can_be_limited_to_books(client, admin_headers, indexed_book):
    assert client.get("/api/search", headers=admin_headers, params={"q": "pruning", "book_id": "other"}).json() == []


def test_reindexing_replaces_passages(client, admin_headers, indexed_book):
    client.post(f"/api/admin/books/{indexed_book}/index/start", headers=admin_headers,
                json={"format": "reflow", "sha256": "b" * 64, "model": embed.MODEL})
    assert client.get("/api/search", headers=admin_headers, params={"q": "pruning"}).json() == []


def test_index_refuses_another_model(client, admin_headers, indexed_book):
    r = client.post(f"/api/admin/books/{indexed_book}/index/start", headers=admin_headers,
                    json={"format": "reflow", "sha256": "c" * 64, "model": "other/model"})
    assert r.status_code == 422


@pytest.fixture(autouse=True)
def fresh_query_cache():
    from app.routes import search
    search._translated.cache_clear()


def test_ask_answers_from_sources(client, admin_headers, indexed_book, groq):
    calls, replies = groq
    replies.append({"detected_language": "en", "translations": {"en": "What does pruning remove?"}})
    replies.append({"answer": "Pruning drops the smallest weights [1].", "used": [1]})
    r = client.post("/api/ask", headers=admin_headers, json={"question": "What does pruning remove?"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["answer"].endswith("[1].")
    assert body["sources"][0]["heading"] == "1 Pruning"
    assert "[1] Efficient ML — 1 Pruning" in calls[1]["messages"][1]["content"]


def test_a_question_in_another_language_is_searched_in_the_books_language(client, admin_headers, indexed_book, groq):
    calls, replies = groq
    replies.append({"detected_language": "es", "translations": {"en": "weight as an 8-bit integer"}})
    hits = client.get("/api/search", headers=admin_headers, params={"q": "pesos enteros de ocho bits"}).json()
    assert hits[0]["heading"] == "2 Quantization"
    assert "English (en)" in calls[0]["messages"][0]["content"]


def test_search_still_works_when_groq_fails(client, admin_headers, indexed_book, groq):
    import httpx
    _, replies = groq
    replies.append(httpx.Response(500, json={"error": {"message": "down"}}))
    hits = client.get("/api/search", headers=admin_headers, params={"q": "8-bit integer weights"}).json()
    assert hits[0]["heading"] == "2 Quantization"


def test_deleting_a_book_drops_its_index(client, admin_headers, indexed_book):
    client.delete(f"/api/admin/books/{indexed_book}", headers=admin_headers)
    assert client.get("/api/search", headers=admin_headers, params={"q": "pruning"}).json() == []
