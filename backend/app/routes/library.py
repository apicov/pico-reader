"""The library the app shows (and caches for offline use) and signed download links for its files."""

import hashlib
import json

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import assets, r2
from app import dictionary_service as dicts
from app.auth import Reader, get_current_reader
from app.db import get_db

router = APIRouter(prefix="/api", tags=["library"])


class CoverOut(assets.PublicFile):
    url: str  # signed, short-lived


class IndexInfo(BaseModel):
    sha256: str  # of the file it was built from
    chunks: int


class LibraryBook(BaseModel):
    id: str
    title: str
    author: str
    language: str
    updated_at: str
    can_change: bool
    category_id: int | None
    category2_id: int | None
    category_reason: str
    formats: dict[str, assets.PublicFile]
    search: assets.PublicFile | None
    cover: CoverOut | None
    index: IndexInfo | None


class LibraryDictionary(BaseModel):
    id: str
    name: str
    from_lang: str
    to_lang: str
    entry_count: int
    updated_at: str
    visibility: str
    can_change: bool
    files: dict[str, assets.PublicFile]


class Library(BaseModel):
    books: list[LibraryBook]
    dictionaries: list[LibraryDictionary]


class Download(BaseModel):
    url: str
    expiresIn: int  # noqa: N815 (what the app reads)
    size: int
    sha256: str


@router.get("/library", response_model=Library)
def library(request: Request, response: Response, reader: Reader = Depends(get_current_reader),
            db: Session = Depends(get_db)):
    """Books and dictionaries. The ETag covers the data, not the cover links (they're re-signed on every
    call), so a 304 means the app's cached manifest and covers are still right."""
    rows = db.execute(text("""SELECT b.id, b.title, b.author, b.language, b.files, b.updated_at, b.uploaded_by,
                                      b.category_id, b.category2_id, b.category_reason,
                                      i.sha256 AS index_sha, i.chunks AS index_chunks
                               FROM books b LEFT JOIN book_index i ON i.book_id = b.id
                               WHERE b.status = 'ready' ORDER BY lower(b.title)""")).fetchall()
    cover_keys = {r.id: r.files["cover"]["key"] for r in rows if "cover" in r.files}
    books = [
        {"id": r.id, "title": r.title, "author": r.author, "language": r.language,
         "updated_at": r.updated_at.isoformat(),
         # who added a book stays private (the library is shared): only whether this reader may change it
         "can_change": reader.is_admin or r.uploaded_by == reader.email,
         "category_id": r.category_id, "category2_id": r.category2_id, "category_reason": r.category_reason,
         "formats": assets.public_files({k: f for k, f in r.files.items() if k not in ("cover", "search")}),
         # passages + vectors for searching offline (written by the indexer)
         "search": assets.public_files({"s": r.files["search"]})["s"] if "search" in r.files else None,
         "cover": assets.public_files(r.files)["cover"] if r.id in cover_keys else None,
         # the file the search index was built from (the desktop tool re-indexes when it changes)
         "index": {"sha256": r.index_sha, "chunks": r.index_chunks} if r.index_sha else None}
        for r in rows
    ]
    dictionaries = [
        {"id": r.id, "name": r.name, "from_lang": r.from_lang, "to_lang": r.to_lang,
         "entry_count": r.entry_count, "updated_at": r.updated_at.isoformat(), "visibility": r.visibility,
         "can_change": reader.is_admin,
         "files": assets.public_files({k: f for k, f in r.files.items() if k != "source"})}
        for r in db.execute(text(f"""SELECT d.id, d.name, d.from_lang, d.to_lang, d.entry_count, d.files, d.updated_at,
                                            d.visibility
                                     FROM dictionaries d WHERE d.status = 'ready' AND {dicts.visible()}
                                     ORDER BY d.from_lang, d.to_lang, d.name"""), {"e": reader.email, "admin": reader.is_admin})
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


@router.get("/books/{book_id}/download", response_model=Download)
def book_download(book_id: str, kind: str, response: Response, _: Reader = Depends(get_current_reader),
                  db: Session = Depends(get_db)):
    return _signed(response, assets.download(db, "books", book_id, kind))


@router.get("/dictionaries/{dict_id}/download", response_model=Download)
def dictionary_download(dict_id: str, kind: str, response: Response, reader: Reader = Depends(get_current_reader),
                        db: Session = Depends(get_db)):
    dicts.check_visible(db, reader, dict_id)
    if kind == "source":
        raise HTTPException(404, "Not found")
    return _signed(response, assets.download(db, "dictionaries", dict_id, kind))
