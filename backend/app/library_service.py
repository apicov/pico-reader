"""Adding, changing and deleting books, from the app (any reader) and the desktop tool (admins): owner checks,
the books' history, the indexing queue, and writing a book's search index and offline search file."""

import base64
import gzip
import json
import tempfile
from pathlib import Path

import numpy as np
from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import assets, embed, r2
from app.auth import Reader

TEXT_FORMATS = ["reflow", "epub", "pdf"]  # the best text first: what the index is built from


# --- history ---

def record(db: Session, book_id: str, title: str, action: str, actor: str, details: dict | None = None) -> None:
    db.execute(text("""INSERT INTO book_events (book_id, title, action, actor, details)
                       VALUES (:b, :t, :a, :w, CAST(:d AS jsonb))"""),
               {"b": book_id, "t": title, "a": action, "w": actor, "d": json.dumps(details or {})})


def history(db: Session, reader: Reader, days: int = 365, limit: int = 300) -> list[dict]:
    """Admins see everything; readers see what they did."""
    rows = db.execute(text("""
        SELECT id, book_id, title, action, actor, details, created_at FROM book_events
        WHERE created_at >= now() - make_interval(days => :d) AND (:admin OR actor = :e)
        ORDER BY id DESC LIMIT :n"""), {"d": days, "admin": reader.is_admin, "e": reader.email, "n": limit})
    return [dict(r._mapping) for r in rows]


# --- uploads ---

def _owned(db: Session, reader: Reader, book_id: str):
    row = db.execute(text("SELECT id, title, uploaded_by, files, status FROM books WHERE id = :id"), {"id": book_id}).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such book")
    if not reader.is_admin and row.uploaded_by != reader.email:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the reader who added this book (or an admin) can change it")
    return row


def start_upload(db: Session, reader: Reader, book_id: str | None, title: str, author: str, language: str,
                 files: dict[str, assets.FileInfo]) -> dict:
    """Create the book (or update an existing one the reader may change); signed upload links for its files."""
    if "search" in files:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The search file is made by the server")
    if book_id:
        assets.check_id(book_id)
        if db.execute(text("SELECT 1 FROM books WHERE id = :id"), {"id": book_id}).fetchone():
            _owned(db, reader, book_id)
    else:
        book_id = assets.new_id(title)
    pending, links = assets.plan_uploads("books", book_id, assets.BOOK_KINDS, files)
    db.execute(text("""
        INSERT INTO books (id, title, author, language, pending, uploaded_by) VALUES (:id, :t, :a, :l, CAST(:p AS jsonb), :u)
        ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, author = EXCLUDED.author,
            language = EXCLUDED.language, pending = EXCLUDED.pending, updated_at = now()
    """), {"id": book_id, "t": title, "a": author, "l": language, "p": json.dumps(pending), "u": reader.email})
    db.commit()
    return {"id": book_id, "uploads": links}


def commit_upload(db: Session, reader: Reader, book_id: str) -> dict:
    """Make the uploaded files visible, write the history, queue indexing when the text changed."""
    before = _owned(db, reader, book_id)
    pending = db.execute(text("SELECT pending FROM books WHERE id = :id"), {"id": book_id}).scalar() or {}
    files = assets.commit(db, "books", book_id)
    new_book = before.status == "pending" and not before.files
    record(db, book_id, before.title, "uploaded" if new_book else "files_changed", reader.email,
           {"files": {k: {"size": f["size"], "sha256": f["sha256"]} for k, f in pending.items()}})
    db.commit()
    if any(k in pending for k in TEXT_FORMATS):
        queue_index(db, book_id, reader.email)
    return files


def delete_book(db: Session, reader: Reader, book_id: str) -> None:
    row = _owned(db, reader, book_id)
    record(db, book_id, row.title, "deleted", reader.email,
           {"files": {k: {"size": f["size"], "sha256": f["sha256"]} for k, f in (row.files or {}).items()}})
    db.commit()
    assets.delete(db, "books", book_id)


# --- the indexing queue ---

def queue_index(db: Session, book_id: str, actor: str, force: bool = False) -> int | None:
    """Queue (or refresh) the book's indexing job; None when its index is already current."""
    row = db.execute(text("""SELECT b.files, i.sha256 AS indexed FROM books b LEFT JOIN book_index i ON i.book_id = b.id
                             WHERE b.id = :id"""), {"id": book_id}).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such book")
    fmt = next((f for f in TEXT_FORMATS if f in row.files), None)
    if fmt is None:
        return None
    sha = row.files[fmt]["sha256"]
    if row.indexed == sha and not force:
        return None
    waiting = db.execute(text("SELECT id FROM index_jobs WHERE book_id = :b AND status = 'queued'"), {"b": book_id}).scalar()
    if waiting:
        db.execute(text("UPDATE index_jobs SET format = :f, sha256 = :s WHERE id = :id"), {"f": fmt, "s": sha, "id": waiting})
        db.commit()
        return waiting
    job = db.execute(text("""INSERT INTO index_jobs (book_id, format, sha256, requested_by) VALUES (:b, :f, :s, :r)
                             RETURNING id"""), {"b": book_id, "f": fmt, "s": sha, "r": actor}).scalar()
    db.commit()
    return job


def queue_status(db: Session) -> list[dict]:
    """Waiting and running jobs (with their place in the queue) and recent failures, for the library."""
    rows = db.execute(text("""
        SELECT j.id, j.book_id, b.title, j.status, j.error, j.created_at, j.started_at, j.finished_at
        FROM index_jobs j JOIN books b ON b.id = j.book_id
        WHERE j.status IN ('queued', 'running') OR (j.status = 'failed' AND j.finished_at > now() - interval '7 days')
        ORDER BY j.id"""))
    out, place = [], 0
    for r in rows:
        d = dict(r._mapping)
        if r.status == "queued":
            place += 1
            d["position"] = place
        out.append(d)
    return out


# --- writing an index (from the indexer, or the desktop tool's chunks) ---

def vector_literal(values) -> str:
    return "[" + ",".join(f"{float(v):.6f}" for v in values) + "]"


def start_index(db: Session, book_id: str, fmt: str, sha: str, model: str, word_count: int | None) -> None:
    db.execute(text("DELETE FROM book_chunks WHERE book_id = :id"), {"id": book_id})
    db.execute(text("""
        INSERT INTO book_index (book_id, format, sha256, model, chunks) VALUES (:id, :f, :s, :m, 0)
        ON CONFLICT (book_id) DO UPDATE SET format = EXCLUDED.format, sha256 = EXCLUDED.sha256,
            model = EXCLUDED.model, chunks = 0, indexed_at = now()
    """), {"id": book_id, "f": fmt, "s": sha, "m": model})
    if word_count:
        db.execute(text("UPDATE books SET word_count = :n WHERE id = :id"), {"n": word_count, "id": book_id})


def add_chunks(db: Session, book_id: str, chunks: list[dict]) -> None:
    """chunks: {seq, location, progress, heading, text, embedding}"""
    fmt = db.execute(text("SELECT format FROM book_index WHERE book_id = :id"), {"id": book_id}).scalar()
    if fmt is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Start the index first")
    if chunks:
        db.execute(text("""
            INSERT INTO book_chunks (book_id, seq, format, location, progress, heading, text, embedding)
            VALUES (:b, :seq, :f, :loc, :p, :h, :t, CAST(:e AS vector))
        """), [{"b": book_id, "seq": c["seq"], "f": fmt, "loc": c["location"], "p": c["progress"], "h": c["heading"],
                "t": c["text"], "e": vector_literal(c["embedding"])} for c in chunks])
        db.execute(text("UPDATE book_index SET chunks = chunks + :n WHERE book_id = :id"), {"n": len(chunks), "id": book_id})


def write_search_file(db: Session, book_id: str) -> dict | None:
    """The book's passages and vectors (float16) as one gzip'd JSON file in R2, for searching offline on a
    device; recorded as the book's `search` file. None when the book has no index."""
    rows = db.execute(text("""SELECT c.location, c.progress, c.heading, c.text, c.embedding::text AS e, c.format
                              FROM book_chunks c WHERE c.book_id = :b ORDER BY c.seq"""), {"b": book_id}).fetchall()
    meta = db.execute(text("SELECT sha256, model FROM book_index WHERE book_id = :b"), {"b": book_id}).fetchone()
    if not rows or meta is None:
        return None
    vectors = np.array([json.loads(r.e) for r in rows], dtype=np.float16)
    payload = {"format": 1, "model": meta.model, "dimensions": vectors.shape[1], "source_sha256": meta.sha256,
               "text_format": rows[0].format,
               "passages": [{"location": r.location, "progress": r.progress, "heading": r.heading, "text": r.text} for r in rows],
               "vectors": base64.b64encode(vectors.tobytes()).decode()}
    data = gzip.compress(json.dumps(payload, ensure_ascii=False).encode(), compresslevel=9)
    import hashlib
    sha = hashlib.sha256(data).hexdigest()
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "search.json.gz"
        path.write_bytes(data)
        key = f"books/{book_id}/search-{sha[:12]}.json.gz"
        r2.get_client().upload_file(str(path), r2.get_settings().r2_bucket, key, ExtraArgs={"ContentType": "application/gzip"})
    old = db.execute(text("SELECT files->'search'->>'key' FROM books WHERE id = :b"), {"b": book_id}).scalar()
    entry = {"key": key, "size": len(data), "sha256": sha, "content_type": "application/gzip"}
    db.execute(text("""UPDATE books SET files = files || jsonb_build_object('search', CAST(:f AS jsonb)), updated_at = now()
                       WHERE id = :b"""), {"f": json.dumps(entry), "b": book_id})
    db.commit()
    if old and old != key:
        r2.delete_key(old)
    return entry
