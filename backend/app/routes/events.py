"""Reading sessions and dictionary lookups, recorded on the device and sent in batches. Upserting by id makes
a batch sent twice (a retry after a lost reply) harmless."""

import json

from fastapi import APIRouter, Depends
from pydantic import AwareDatetime, BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import Reader, get_current_reader
from app.db import get_db

router = APIRouter(prefix="/api/events", tags=["events"])

_ID = Field(min_length=8, max_length=64)


class Session_(BaseModel):
    id: str = _ID
    book_id: str = Field(min_length=1)
    format: str
    started_at: AwareDatetime
    ended_at: AwareDatetime
    seconds: int = Field(ge=0, le=24 * 3600)
    progress_start: float = Field(ge=0, le=1)
    progress_end: float = Field(ge=0, le=1)


class Lookup(BaseModel):
    id: str = _ID
    book_id: str | None = None
    language: str = Field(min_length=2, max_length=3)
    word: str = Field(min_length=1, max_length=100)
    matched: str = Field(default="", max_length=100)
    dictionaries: list[str] = []
    found: bool
    location: str = ""
    created_at: AwareDatetime


class Batch(BaseModel):
    sessions: list[Session_] = Field(default=[], max_length=1000)
    lookups: list[Lookup] = Field(default=[], max_length=5000)


@router.post("")
def record(batch: Batch, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    for s in batch.sessions:
        # words read: the progress gained times the book's words (0 when its size isn't known yet)
        db.execute(text("""
            INSERT INTO reading_sessions (id, reader_email, book_id, format, started_at, ended_at, seconds,
                                          progress_start, progress_end, words)
            VALUES (:id, :e, :book_id, :format, :started_at, :ended_at, :seconds, :progress_start, :progress_end,
                    coalesce((SELECT round(greatest(0, CAST(:progress_end AS real) - CAST(:progress_start AS real))
                                           * word_count) FROM books WHERE id = :book_id), 0))
            ON CONFLICT (id) DO UPDATE SET ended_at = EXCLUDED.ended_at, seconds = EXCLUDED.seconds,
                progress_end = EXCLUDED.progress_end, words = EXCLUDED.words
            WHERE reading_sessions.reader_email = EXCLUDED.reader_email
        """), {"e": reader.email, **s.model_dump()})
    for lk in batch.lookups:
        db.execute(text("""
            INSERT INTO lookups (id, reader_email, book_id, language, word, matched, dictionaries, found, location,
                                 created_at)
            VALUES (:id, :e, :book_id, :language, :word, :matched, CAST(:dictionaries AS jsonb), :found, :location,
                    :created_at)
            ON CONFLICT (id) DO NOTHING
        """), {"e": reader.email, **lk.model_dump(), "dictionaries": json.dumps(lk.dictionaries)})
    db.commit()
    return {"sessions": len(batch.sessions), "lookups": len(batch.lookups)}
