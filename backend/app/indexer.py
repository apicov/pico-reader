"""The indexing worker: takes queued books one at a time, cuts their text into passages, embeds them and writes
the search index and the offline search file. Runs as its own service (deploy/pico-reader-indexer.service):

    python -m app.indexer            # forever
    python -m app.indexer --once     # the jobs waiting now, then stop
"""

import argparse
import gc
import logging
import os
import tempfile
import time
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session, sessionmaker

from app import embed, library_service as books, passages, r2
from app.db import get_engine

logger = logging.getLogger("indexer")
MAX_ATTEMPTS = 3
IDLE_SECONDS = 5
BATCH = 64
UNLOAD_AFTER = 300  # seconds without jobs before the model leaves memory (the server has 2 GB)


def requeue_interrupted(db: Session) -> int:
    """Jobs left running by a restart go back to the queue."""
    n = db.execute(text("UPDATE index_jobs SET status = 'queued', started_at = NULL WHERE status = 'running'")).rowcount
    db.commit()
    return n


def claim(db: Session):
    row = db.execute(text("""
        UPDATE index_jobs SET status = 'running', started_at = now(), attempts = attempts + 1
        WHERE id = (SELECT id FROM index_jobs WHERE status = 'queued' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING id, book_id, format, sha256, attempts, requested_by"""))
    job = row.fetchone()
    db.commit()
    return job


def process(db: Session, job) -> int:
    """Index one book; returns the number of passages."""
    book = db.execute(text("SELECT title, files FROM books WHERE id = :id"), {"id": job.book_id}).fetchone()
    f = (book.files or {}).get(job.format) if book else None
    if f is None:
        raise RuntimeError(f"The book has no {job.format} file any more")
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / f"book.{job.format}"
        r2.get_client().download_file(r2.get_settings().r2_bucket, f["key"], str(path))
        found = passages.EXTRACTORS[job.format](path)
    if not found:
        raise RuntimeError("No text found (a scanned PDF needs a text version)")
    words = sum(len(p.text.split()) for p in found)
    books.start_index(db, job.book_id, job.format, f["sha256"], embed.MODEL, words)
    for start in range(0, len(found), BATCH):
        part = found[start:start + BATCH]
        vectors = embed.embed([p.text for p in part])
        books.add_chunks(db, job.book_id, [
            {"seq": start + i, "location": p.location, "progress": round(p.progress, 5), "heading": p.heading,
             "text": p.text, "embedding": vectors[i]} for i, p in enumerate(part)])
    db.commit()
    books.write_search_file(db, job.book_id)
    books.record(db, job.book_id, book.title, "indexed", "indexer", {"job": job.id, "passages": len(found), "words": words})
    db.commit()
    return len(found)


def run_job(db: Session, job) -> None:
    started = time.time()
    try:
        n = process(db, job)
        db.execute(text("UPDATE index_jobs SET status = 'done', finished_at = now(), error = '' WHERE id = :id"), {"id": job.id})
        db.commit()
        logger.info("Indexed %s: %d passages in %.0f s", job.book_id, n, time.time() - started)
    except Exception as e:  # any failure: retry later, then give up with the reason
        db.rollback()
        logger.exception("Indexing %s failed", job.book_id)
        final = job.attempts >= MAX_ATTEMPTS
        db.execute(text("""UPDATE index_jobs SET status = :s, error = :err, finished_at = CASE WHEN :final THEN now() END
                           WHERE id = :id"""), {"s": "failed" if final else "queued", "err": str(e)[:500], "final": final,
                                                "id": job.id})
        if final:
            title = db.execute(text("SELECT title FROM books WHERE id = :b"), {"b": job.book_id}).scalar() or ""
            books.record(db, job.book_id, title, "index_failed", "indexer", {"job": job.id, "error": str(e)[:500]})
        db.commit()


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.indexer")
    parser.add_argument("--once", action="store_true", help="process the waiting jobs, then stop")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    os.environ.setdefault("EMBED_THREADS", "1")  # leave the small server's CPU to the API
    db = sessionmaker(bind=get_engine())()
    if (n := requeue_interrupted(db)):
        logger.info("Requeued %d interrupted jobs", n)
    idle_since = time.time()
    while True:
        job = claim(db)
        if job is None:
            if args.once:
                return
            if embed._model.cache_info().currsize and time.time() - idle_since > UNLOAD_AFTER:
                embed._model.cache_clear()
                gc.collect()
                logger.info("Idle: embedding model unloaded")
            time.sleep(IDLE_SECONDS)
            continue
        run_job(db, job)
        idle_since = time.time()


if __name__ == "__main__":
    main()
