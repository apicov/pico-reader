"""Books added from the app by any reader (into the shared library). The reader who added a book, or an admin,
may change or delete it; every change is kept in the books' history."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import assets, categories, groq_client, library_service as books
from app.auth import Reader, get_current_reader
from app.db import get_db

router = APIRouter(prefix="/api", tags=["books"])


class BookUpload(BaseModel):
    id: str | None = None  # an existing book: add or replace its files
    title: str = Field(min_length=1, max_length=300)
    author: str = Field(default="", max_length=300)
    language: str = Field(pattern=r"^[a-z]{2,3}$")
    files: dict[str, assets.FileInfo]
    category_id: int | None = None  # chosen by the reader: the AI won't pick one for this book


class CategoryIn(BaseModel):
    category_id: int | None
    category2_id: int | None = None


@router.post("/books")
def upload(body: BookUpload, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    categories.check(db, body.category_id)
    started = books.start_upload(db, reader, body.id, body.title, body.author, body.language, body.files)
    if body.category_id is not None:
        categories.set_book(db, started["id"], body.category_id, None, "reader")
        db.commit()
    return started


@router.put("/books/{book_id}/category", status_code=204)
def set_category(book_id: str, body: CategoryIn, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    """The uploader's or an admin's choice; the AI never overwrites it. No category: the AI may pick one again."""
    books._owned(db, reader, book_id)
    categories.check(db, body.category_id)
    categories.check(db, body.category2_id)
    categories.set_book(db, book_id, body.category_id, body.category2_id if body.category_id else None, "reader")
    db.commit()


@router.post("/books/{book_id}/categorize")
def categorize(book_id: str, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    """Ask the AI again (replaces a category chosen by hand)."""
    books._owned(db, reader, book_id)
    db.execute(text("UPDATE books SET category_source = NULL WHERE id = :b"), {"b": book_id})
    db.commit()
    try:
        result = categories.classify(db, book_id, force=True)
    except groq_client.GroqError as e:
        raise HTTPException(e.status, str(e))
    if result is None:
        raise HTTPException(422, "The AI couldn't place this book (is it indexed yet?)")
    return result


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
