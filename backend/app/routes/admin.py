"""Adding books and dictionaries, used by the desktop tool (tools/reader). Two steps per upload:
POST gives signed PUT links for the files, PUT goes straight to R2, then /commit makes them visible.
Posting an existing id adds or replaces files (e.g. a reflow copy) and updates the metadata."""

import json

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import assets, dictionary_service as dicts, library_service as books
from app.auth import Reader, get_current_admin
from app.db import get_db

router = APIRouter(prefix="/api/admin", tags=["admin"])

_LANG = Field(pattern=r"^[a-z]{2,3}$")


class BookUpload(BaseModel):
    id: str | None = None
    title: str = Field(min_length=1)
    author: str = ""
    language: str = _LANG
    files: dict[str, assets.FileInfo]


_VISIBILITY = Literal["everyone", "private"]


class DictionaryUpload(BaseModel):
    id: str | None = None
    name: str = Field(min_length=1)
    from_lang: str = _LANG
    to_lang: str = _LANG
    entry_count: int = 0
    visibility: _VISIBILITY | None = None  # None: a new one is for everyone, an update keeps its setting
    files: dict[str, assets.FileInfo]


class StarDictUpload(BaseModel):
    """From the app: one StarDict zip the server converts (dictionary_service.convert)."""
    id: str | None = None
    name: str = Field(min_length=1, max_length=200)
    from_lang: str = _LANG
    to_lang: str = _LANG
    visibility: _VISIBILITY = "private"
    source: assets.FileInfo


class DictionaryEdit(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    from_lang: str | None = Field(default=None, pattern=r"^[a-z]{2,3}$")
    to_lang: str | None = Field(default=None, pattern=r"^[a-z]{2,3}$")
    visibility: _VISIBILITY | None = None


# Books: the same service as the app's uploads (history, indexing queue); an admin may change any book.
# The desktop tool indexes on its own (`reader index`), or queues the server (`reader index --server`).

@router.post("/books")
def add_book(body: BookUpload, admin: Reader = Depends(get_current_admin), db: Session = Depends(get_db)):
    return books.start_upload(db, admin, body.id, body.title, body.author, body.language, body.files)


@router.post("/books/{book_id}/commit")
def commit_book(book_id: str, admin: Reader = Depends(get_current_admin), db: Session = Depends(get_db)):
    return {"id": book_id, "files": assets.public_files(books.commit_upload(db, admin, book_id))}


@router.delete("/books/{book_id}", status_code=204)
def delete_book(book_id: str, admin: Reader = Depends(get_current_admin), db: Session = Depends(get_db)):
    books.delete_book(db, admin, book_id)


@router.post("/dictionaries")
def add_dictionary(body: DictionaryUpload, admin: Reader = Depends(get_current_admin), db: Session = Depends(get_db)):
    """From the desktop tool, which converts on the computer and uploads the packages."""
    if "source" in body.files:
        raise HTTPException(422, "Upload a StarDict for conversion with /dictionaries/upload")
    dict_id = assets.check_id(body.id) if body.id else assets.new_id(body.name)
    pending, links = assets.plan_uploads("dictionaries", dict_id, assets.DICT_KINDS, body.files)
    db.execute(text("""
        INSERT INTO dictionaries (id, name, from_lang, to_lang, entry_count, pending, visibility, uploaded_by)
        VALUES (:id, :n, :f, :t, :c, CAST(:p AS jsonb), coalesce(:v, 'everyone'), :u)
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, from_lang = EXCLUDED.from_lang,
            to_lang = EXCLUDED.to_lang, entry_count = EXCLUDED.entry_count, pending = EXCLUDED.pending,
            visibility = coalesce(:v, dictionaries.visibility), uploaded_by = coalesce(dictionaries.uploaded_by, EXCLUDED.uploaded_by),
            updated_at = now()
    """), {"id": dict_id, "n": body.name, "f": body.from_lang, "t": body.to_lang, "c": body.entry_count,
           "p": json.dumps(pending), "v": body.visibility, "u": admin.email})
    db.commit()
    return {"id": dict_id, "uploads": links}


@router.post("/dictionaries/upload")
def upload_stardict(body: StarDictUpload, admin: Reader = Depends(get_current_admin), db: Session = Depends(get_db)):
    return dicts.start_upload(db, admin, body.name, body.from_lang, body.to_lang, body.visibility, body.source, body.id)


@router.post("/dictionaries/{dict_id}/convert")
def convert_stardict(dict_id: str, admin: Reader = Depends(get_current_admin), db: Session = Depends(get_db)):
    """After the source zip's PUT: queue its conversion."""
    return {"id": dict_id, "job": dicts.commit_source(db, admin, dict_id)}


@router.get("/dict-jobs")
def dict_jobs(_: Reader = Depends(get_current_admin), db: Session = Depends(get_db)):
    return dicts.jobs(db)


@router.put("/dictionaries/{dict_id}", status_code=204)
def edit_dictionary(dict_id: str, body: DictionaryEdit, admin: Reader = Depends(get_current_admin),
                    db: Session = Depends(get_db)):
    dicts.edit(db, admin, dict_id, body.model_dump(exclude_none=True))


@router.post("/dictionaries/{dict_id}/commit")
def commit_dictionary(dict_id: str, _: Reader = Depends(get_current_admin), db: Session = Depends(get_db)):
    return {"id": dict_id, "files": assets.public_files(assets.commit(db, "dictionaries", dict_id))}


@router.delete("/dictionaries/{dict_id}", status_code=204)
def delete_dictionary(dict_id: str, _: Reader = Depends(get_current_admin), db: Session = Depends(get_db)):
    assets.delete(db, "dictionaries", dict_id)
