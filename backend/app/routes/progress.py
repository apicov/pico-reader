"""Where each book is open, synced between devices. The device stamps every position, and the newest
stamp wins, so a phone that was offline for a week can't drag a newer position on the tablet back."""

from fastapi import APIRouter, Depends
from pydantic import AwareDatetime, BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import Reader, get_current_reader
from app.db import get_db

router = APIRouter(prefix="/api/progress", tags=["progress"])

FINISHED_AT = 0.98  # reading this far moves a book on the shelf from "reading" to "finished"


class Position(BaseModel):
    book_id: str = Field(min_length=1)
    format: str = Field(min_length=1)
    location: str
    progress: float = Field(ge=0, le=1)
    updated_at: AwareDatetime


@router.get("")
def positions(reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)) -> list[Position]:
    rows = db.execute(text("""SELECT book_id, format, location, progress, updated_at FROM reading_state
                              WHERE reader_email = :e"""), {"e": reader.email})
    return [Position(**r._mapping) for r in rows]


@router.put("")
def save_position(body: Position, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)) -> Position:
    """Returns the position the server keeps: the one sent, or a newer one from another device."""
    row = db.execute(text("""
        INSERT INTO reading_state (reader_email, book_id, format, location, progress, updated_at)
        VALUES (:e, :b, :f, :l, :p, :u)
        ON CONFLICT (reader_email, book_id) DO UPDATE SET format = EXCLUDED.format,
            location = EXCLUDED.location, progress = EXCLUDED.progress, updated_at = EXCLUDED.updated_at
            WHERE reading_state.updated_at < EXCLUDED.updated_at
        RETURNING book_id
    """), {"e": reader.email, "b": body.book_id, "f": body.format, "l": body.location, "p": body.progress,
           "u": body.updated_at}).fetchone()
    if body.progress >= FINISHED_AT:
        db.execute(text("""INSERT INTO shelf (reader_email, book_id, status) VALUES (:e, :b, 'finished')
                           ON CONFLICT (reader_email, book_id) DO UPDATE SET status = 'finished', updated_at = now()
                           WHERE shelf.status = 'reading'"""), {"e": reader.email, "b": body.book_id})
    if row is None:  # the server's copy is newer
        kept = db.execute(text("""SELECT book_id, format, location, progress, updated_at FROM reading_state
                                  WHERE reader_email = :e AND book_id = :b"""),
                          {"e": reader.email, "b": body.book_id}).fetchone()
        db.commit()
        return Position(**kept._mapping)
    db.commit()
    return body

