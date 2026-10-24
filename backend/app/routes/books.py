"""Books added from the app by any reader (into the shared library). The reader who added a book, or an admin,
may change or delete it; every change is kept in the books' history."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app import assets, library_service as books
from app.auth import Reader, get_current_reader
from app.db import get_db

router = APIRouter(prefix="/api", tags=["books"])


class BookUpload(BaseModel):
    id: str | None = None  # an existing book: add or replace its files
    title: str = Field(min_length=1, max_length=300)
    author: str = Field(default="", max_length=300)
    language: str = Field(pattern=r"^[a-z]{2,3}$")
    files: dict[str, assets.FileInfo]


@router.post("/books")
def upload(body: BookUpload, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    return books.start_upload(db, reader, body.id, body.title, body.author, body.language, body.files)


@router.post("/books/{book_id}/commit")
def commit(book_id: str, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    return {"id": book_id, "files": assets.public_files(books.commit_upload(db, reader, book_id))}


@router.delete("/books/{book_id}", status_code=204)
def delete(book_id: str, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    books.delete_book(db, reader, book_id)


@router.post("/books/{book_id}/reindex")
def reindex(book_id: str, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    row = books._owned(db, reader, book_id)
    job = books.queue_index(db, book_id, reader.email, force=True)
    if job:
        books.record(db, book_id, row.title, "reindexed", reader.email, {"job": job})
        db.commit()
    return {"job": job}


@router.get("/books/history")
def history(days: int = 365, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    return books.history(db, reader, days)


@router.get("/index-jobs")
def index_jobs(_: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    return books.queue_status(db)
