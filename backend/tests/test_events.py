from sqlalchemy import text

from app.db import get_engine
from tests.test_library import upload

SESSION = {"id": "sess-00000001", "book_id": "b", "format": "epub", "started_at": "2026-10-24T08:00:00Z",
           "ended_at": "2026-10-24T08:20:00Z", "seconds": 1200, "progress_start": 0.10, "progress_end": 0.15}
LOOKUP = {"id": "look-00000001", "book_id": "b", "language": "de", "word": "Häuser", "matched": "haus",
          "dictionaries": ["duden"], "found": True, "location": "epubcfi(/6/8)", "created_at": "2026-10-24T08:05:00Z"}


def rows(table):
    with get_engine().connect() as c:
        return c.execute(text(f"SELECT * FROM {table}")).fetchall()


def test_batch_is_stored_and_a_resend_is_harmless(client, auth_headers):
    body = {"sessions": [SESSION], "lookups": [LOOKUP]}
    assert client.post("/api/events", headers=auth_headers, json=body).json() == {"sessions": 1, "lookups": 1}
    client.post("/api/events", headers=auth_headers, json=body)
    assert len(rows("reading_sessions")) == 1 and len(rows("lookups")) == 1
    assert rows("lookups")[0].dictionaries == ["duden"]


def test_a_growing_session_updates(client, auth_headers):
    client.post("/api/events", headers=auth_headers, json={"sessions": [SESSION]})
    client.post("/api/events", headers=auth_headers, json={"sessions": [{**SESSION, "seconds": 1500, "progress_end": 0.2}]})
    [s] = rows("reading_sessions")
    assert s.seconds == 1500 and abs(s.progress_end - 0.2) < 1e-6


def test_words_read_from_the_books_word_count(client, admin_headers, bucket):
    book_id = upload(client, admin_headers, {"pdf": (b"%PDF x", "application/pdf")}, title="Die Wolke", language="de")
    client.post(f"/api/admin/books/{book_id}/commit", headers=admin_headers)
    with get_engine().begin() as c:
        c.execute(text("UPDATE books SET word_count = 40000 WHERE id = :id"), {"id": book_id})
    client.post("/api/events", headers=admin_headers, json={"sessions": [{**SESSION, "book_id": book_id}]})
    assert rows("reading_sessions")[0].words == 2000  # 5% of 40 000


def test_another_reader_cannot_overwrite_a_session(client, auth_headers, admin_headers):
    client.post("/api/events", headers=auth_headers, json={"sessions": [SESSION]})
    client.post("/api/events", headers=admin_headers, json={"sessions": [{**SESSION, "seconds": 5}]})
    assert rows("reading_sessions")[0].seconds == 1200


def test_a_batch_at_the_limit_is_taken_and_one_over_is_refused(client, auth_headers):
    # the app sends at most 500 sessions per batch (events.ts), well inside the server's 1,000
    def sessions(n):
        return [{"id": f"sess-{i:06d}", "book_id": "b1", "format": "epub", "started_at": "2026-10-24T10:00:00Z",
                 "ended_at": "2026-10-24T10:01:00Z", "seconds": 60, "progress_start": 0.1, "progress_end": 0.11}
                for i in range(n)]
    assert client.post("/api/events", headers=auth_headers, json={"sessions": sessions(1000)}).status_code == 200
    assert client.post("/api/events", headers=auth_headers, json={"sessions": sessions(1001)}).status_code == 422
