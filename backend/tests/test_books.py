import gzip
import json

from sqlalchemy import text
from sqlalchemy.orm import sessionmaker

from app import indexer
from app.db import get_engine
from tests.conftest import add_reader, sign_in
from tests.helpers import EPUB, info, run_queue, tiny_epub, upload_epub


def test_a_reader_uploads_and_the_server_indexes(client, auth_headers, bucket):
    book_id = upload_epub(client, auth_headers)
    jobs = client.get("/api/index-jobs", headers=auth_headers).json()
    assert [(j["book_id"], j["status"], j["position"]) for j in jobs] == [(book_id, "queued", 1)]
    run_queue()
    [book] = client.get("/api/library", headers=auth_headers).json()["books"]
    assert book["index"]["chunks"] > 0 and book["search"]["size"] > 0
    assert set(book["formats"]) == {"epub"}  # the search file isn't a reading format
    hits = client.get("/api/search", headers=auth_headers, params={"q": "Wolke Land Kinder"}).json()
    assert hits and hits[0]["book_id"] == book_id
    # the offline search file: passages + float16 vectors
    key = next(o["Key"] for o in bucket.list_objects_v2(Bucket="test-library")["Contents"] if "/search-" in o["Key"])
    payload = json.loads(gzip.decompress(bucket.get_object(Bucket="test-library", Key=key)["Body"].read()))
    import base64

    import numpy as np
    vectors = np.frombuffer(base64.b64decode(payload["vectors"]), dtype=np.float16).reshape(len(payload["passages"]), -1)
    assert vectors.shape[1] == 384 and payload["passages"][0]["heading"] == "Erstes Kapitel"
    assert client.get("/api/index-jobs", headers=auth_headers).json() == []


def test_history_keeps_who_and_when_even_after_deletion(client, auth_headers, admin_headers, bucket):
    book_id = upload_epub(client, auth_headers)
    run_queue()
    assert client.delete(f"/api/books/{book_id}", headers=auth_headers).status_code == 204
    mine = client.get("/api/books/history", headers=auth_headers).json()
    assert [(e["action"], e["actor"]) for e in mine] == [("deleted", "me@example.com"), ("uploaded", "me@example.com")]
    assert mine[0]["title"] == "Kleines Buch" and mine[0]["created_at"]
    everything = client.get("/api/books/history", headers=admin_headers).json()
    assert {e["action"] for e in everything} == {"uploaded", "indexed", "deleted"}  # admins also see the indexer


def test_only_the_uploader_or_an_admin_may_change_a_book(client, auth_headers, admin_headers, sent_codes, bucket):
    book_id = upload_epub(client, auth_headers)
    add_reader("other@example.com", "Other")
    other = sign_in(client, sent_codes, "other@example.com")
    assert client.delete(f"/api/books/{book_id}", headers=other).status_code == 403
    assert client.post("/api/books", headers=other, json={"id": book_id, "title": "Mine now", "language": "de",
                       "files": {"epub": info(EPUB, "application/epub+zip")}}).status_code == 403
    assert client.post(f"/api/books/{book_id}/reindex", headers=other).status_code == 403
    assert client.delete(f"/api/books/{book_id}", headers=admin_headers).status_code == 204


def test_a_new_file_queues_again_and_same_file_does_not(client, auth_headers, bucket):
    book_id = upload_epub(client, auth_headers)
    run_queue()
    upload_epub(client, auth_headers, EPUB, id=book_id)  # same bytes: index is current
    assert client.get("/api/index-jobs", headers=auth_headers).json() == []
    changed = tiny_epub().replace(b"Absatz", b"Teil  ")
    upload_epub(client, auth_headers, changed, id=book_id)
    assert len(client.get("/api/index-jobs", headers=auth_headers).json()) == 1
    assert client.post(f"/api/books/{book_id}/reindex", headers=auth_headers).json()["job"]


def test_a_failing_job_is_retried_then_failed(client, auth_headers, bucket):
    book_id = upload_epub(client, auth_headers, b"not an epub at all")
    run_queue()
    [job] = client.get("/api/index-jobs", headers=auth_headers).json()
    assert job["status"] == "failed" and job["error"]
    with get_engine().connect() as c:
        assert c.execute(text("SELECT attempts FROM index_jobs")).scalar() == indexer.MAX_ATTEMPTS
    actions = [e["action"] for e in client.get("/api/books/history", headers=auth_headers).json()]
    assert actions == ["uploaded"]  # failures are the indexer's: visible to admins
    assert book_id


def test_interrupted_jobs_are_requeued(client, auth_headers, bucket):
    upload_epub(client, auth_headers)
    db = sessionmaker(bind=get_engine())()
    indexer.claim(db)  # running, then the service "restarts"
    assert indexer.requeue_interrupted(db) == 1
    assert client.get("/api/index-jobs", headers=auth_headers).json()[0]["status"] == "queued"
    db.close()


def test_search_file_kind_cannot_be_uploaded(client, auth_headers, bucket):
    r = client.post("/api/books", headers=auth_headers, json={"title": "x", "language": "de",
                    "files": {"search": info(b"x", "application/gzip")}})
    assert r.status_code == 422


def test_committing_before_the_upload_says_what_is_missing(client, auth_headers, bucket):
    r = client.post("/api/books", headers=auth_headers, json={"title": "Kleines Buch", "language": "de",
                                                              "files": {"epub": info(EPUB, "application/epub+zip")}})
    commit = client.post(f"/api/books/{r.json()['id']}/commit", headers=auth_headers)
    assert commit.status_code == 409
    assert commit.json()["detail"] == {"message": "Upload incomplete", "missing": ["epub"]}
