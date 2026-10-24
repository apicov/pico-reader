"""Each reader's shelf in the shared library: the books they're reading, have finished, or took off their list.
The library itself (books) is the same for everyone; the shelf is per reader.
"My shelf" (/mine) is apart from that: the books a reader picks to keep in sight, read or not."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import Reader, get_current_reader
from app.db import get_db

router = APIRouter(prefix="/api/shelf", tags=["shelf"])


class ShelfEntry(BaseModel):
    book_id: str
    status: Literal["reading", "finished", "removed"]
    progress: float = 0
    started_at: str | None = None
    updated_at: str | None = None
    last_read: str | None = None


class StatusIn(BaseModel):
    status: Literal["reading", "finished", "removed"]
    # opening a book sends "reading" with only_if_new: it starts the book (or brings a removed one back), but a
    # finished book stays finished
    only_if_new: bool = False


@router.get("", response_model=list[ShelfEntry])
def shelf(reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    rows = db.execute(text("""
        SELECT s.book_id, s.status, coalesce(rs.progress, 0) AS progress, s.started_at, s.updated_at,
               greatest(rs.updated_at, (SELECT max(ended_at) FROM reading_sessions x
                                        WHERE x.reader_email = s.reader_email AND x.book_id = s.book_id)) AS last_read
        FROM shelf s LEFT JOIN reading_state rs ON rs.reader_email = s.reader_email AND rs.book_id = s.book_id
        WHERE s.reader_email = :e ORDER BY last_read DESC NULLS LAST, s.updated_at DESC"""), {"e": reader.email})
    return [ShelfEntry(book_id=r.book_id, status=r.status, progress=r.progress,
                       started_at=r.started_at.isoformat(), updated_at=r.updated_at.isoformat(),
                       last_read=r.last_read.isoformat() if r.last_read else None) for r in rows]


class MyShelfEntry(BaseModel):
    book_id: str
    added_at: str


def _require_book(db: Session, book_id: str) -> None:
    if db.execute(text("SELECT 1 FROM books WHERE id = :id"), {"id": book_id}).fetchone() is None:
        raise HTTPException(404, "No such book")


@router.get("/mine", response_model=list[MyShelfEntry])
def my_shelf(reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    rows = db.execute(text("SELECT book_id, added_at FROM my_shelf WHERE reader_email = :e ORDER BY added_at DESC"),
                      {"e": reader.email})
    return [MyShelfEntry(book_id=r.book_id, added_at=r.added_at.isoformat()) for r in rows]


@router.put("/mine/{book_id}", status_code=204)
def add_to_my_shelf(book_id: str, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    _require_book(db, book_id)
    db.execute(text("INSERT INTO my_shelf (reader_email, book_id) VALUES (:e, :b) ON CONFLICT DO NOTHING"),
               {"e": reader.email, "b": book_id})
    db.commit()


@router.delete("/mine/{book_id}", status_code=204)
def remove_from_my_shelf(book_id: str, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    db.execute(text("DELETE FROM my_shelf WHERE reader_email = :e AND book_id = :b"), {"e": reader.email, "b": book_id})
    db.commit()


@router.put("/{book_id}", response_model=ShelfEntry)
def set_status(book_id: str, body: StatusIn, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    _require_book(db, book_id)
    only = "WHERE shelf.status = 'removed'" if body.only_if_new else ""
    db.execute(text(f"""INSERT INTO shelf (reader_email, book_id, status) VALUES (:e, :b, :s)
                        ON CONFLICT (reader_email, book_id) DO UPDATE SET status = EXCLUDED.status, updated_at = now()
                        {only}"""),
               {"e": reader.email, "b": book_id, "s": body.status})
    db.commit()
    return next(e for e in shelf(reader=reader, db=db) if e.book_id == book_id)
