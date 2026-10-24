"""The library the app shows (and caches for offline use) and signed download links for its files."""

import hashlib
import json

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import assets, r2
from app.auth import Reader, get_current_reader
from app.db import get_db

router = APIRouter(prefix="/api", tags=["library"])


@router.get("/library")
def library(request: Request, response: Response, _: Reader = Depends(get_current_reader),
            db: Session = Depends(get_db)):
    """Books and dictionaries. The ETag covers the data, not the cover links (they're re-signed on every
    call), so a 304 means the app's cached manifest and covers are still right."""
    rows = db.execute(text("""SELECT b.id, b.title, b.author, b.language, b.files, b.updated_at,
                                      i.sha256 AS index_sha, i.chunks AS index_chunks
                               FROM books b LEFT JOIN book_index i ON i.book_id = b.id
                               WHERE b.status = 'ready' ORDER BY lower(b.title)""")).fetchall()
    cover_keys = {r.id: r.files["cover"]["key"] for r in rows if "cover" in r.files}
    books = [
        {"id": r.id, "title": r.title, "author": r.author, "language": r.language,
         "updated_at": r.updated_at.isoformat(),
         "formats": assets.public_files({k: f for k, f in r.files.items() if k != "cover"}),
         "cover": assets.public_files(r.files)["cover"] if r.id in cover_keys else None,
         # the file the search index was built from (the desktop tool re-indexes when it changes)
         "index": {"sha256": r.index_sha, "chunks": r.index_chunks} if r.index_sha else None}
        for r in rows
    ]
    dictionaries = [
        {"id": r.id, "name": r.name, "from_lang": r.from_lang, "to_lang": r.to_lang,
         "entry_count": r.entry_count, "updated_at": r.updated_at.isoformat(), "files": assets.public_files(r.files)}
        for r in db.execute(text("""SELECT id, name, from_lang, to_lang, entry_count, files, updated_at
                                     FROM dictionaries WHERE status = 'ready' ORDER BY from_lang, to_lang, name"""))
    ]
    body = {"books": books, "dictionaries": dictionaries}
    etag = '"' + hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()[:32] + '"'
    response.headers["ETag"] = etag
    response.headers["Cache-Control"] = "private, no-cache"
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    for book in books:
        if book["cover"]:
            book["cover"]["url"] = r2.download_url(cover_keys[book["id"]])
    return body


def _signed(response: Response, link: dict) -> dict:
    # Well under the link's expiry, so a cached reply never hands out a link about to expire
    response.headers["Cache-Control"] = "private, max-age=300"
    return link


@router.get("/books/{book_id}/download")
def book_download(book_id: str, kind: str, response: Response, _: Reader = Depends(get_current_reader),
                  db: Session = Depends(get_db)):
    return _signed(response, assets.download(db, "books", book_id, kind))


@router.get("/dictionaries/{dict_id}/download")
def dictionary_download(dict_id: str, kind: str, response: Response, _: Reader = Depends(get_current_reader),
                        db: Session = Depends(get_db)):
    return _signed(response, assets.download(db, "dictionaries", dict_id, kind))
