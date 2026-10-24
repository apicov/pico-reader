"""Highlights and bookmarks, synced between devices. Devices create them offline with their own ids and
push changes when online; each pulls what changed since its last sync (deletions included)."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import AwareDatetime, BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import Reader, get_current_reader
from app.db import get_db

router = APIRouter(prefix="/api/annotations", tags=["annotations"])


class AnnotationIn(BaseModel):
    book_id: str = Field(min_length=1)
    kind: str = Field(pattern="^(highlight|bookmark)$")
    format: str
    location: str = ""
    progress: float = Field(default=0, ge=0, le=1)
    text: str = Field(default="", max_length=5000)
    note: str = Field(default="", max_length=5000)
    color: str = Field(default="", max_length=20)
    deleted: bool = False
    client_updated_at: AwareDatetime


class Annotation(AnnotationIn):
    id: str
    updated_at: datetime


_COLUMNS = "id, book_id, kind, format, location, progress, text, note, color, deleted, client_updated_at, updated_at"


@router.get("")
def changes(since: datetime | None = None, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    """What changed after `since` (all when absent), and the cursor for the next call."""
    rows = db.execute(text(f"""SELECT {_COLUMNS} FROM annotations WHERE reader_email = :e
                               AND (CAST(:since AS timestamptz) IS NULL OR updated_at > :since) ORDER BY updated_at"""),
                      {"e": reader.email, "since": since}).fetchall()
    cursor = rows[-1].updated_at if rows else since
    return {"annotations": [Annotation(**r._mapping) for r in rows], "cursor": cursor}


@router.put("/{annotation_id}", response_model=Annotation)
def save(annotation_id: str, body: AnnotationIn, reader: Reader = Depends(get_current_reader),
         db: Session = Depends(get_db)):
    """Create or change; an older change than the stored one is ignored (the stored one is returned)."""
    if not 8 <= len(annotation_id) <= 64:
        raise HTTPException(422, "Bad id")
    owner = db.execute(text("SELECT reader_email FROM annotations WHERE id = :id"), {"id": annotation_id}).scalar()
    if owner and owner != reader.email:
        raise HTTPException(404, "Not found")
    db.execute(text("""
        INSERT INTO annotations (id, reader_email, book_id, kind, format, location, progress, text, note, color,
                                 deleted, client_updated_at)
        VALUES (:id, :e, :book_id, :kind, :format, :location, :progress, :text, :note, :color, :deleted, :client_updated_at)
        ON CONFLICT (id) DO UPDATE SET book_id = EXCLUDED.book_id, kind = EXCLUDED.kind, format = EXCLUDED.format,
            location = EXCLUDED.location, progress = EXCLUDED.progress, text = EXCLUDED.text, note = EXCLUDED.note,
            color = EXCLUDED.color, deleted = EXCLUDED.deleted, client_updated_at = EXCLUDED.client_updated_at,
            updated_at = clock_timestamp()
            WHERE annotations.client_updated_at < EXCLUDED.client_updated_at
    """), {"id": annotation_id, "e": reader.email, **body.model_dump()})
    row = db.execute(text(f"SELECT {_COLUMNS} FROM annotations WHERE id = :id"), {"id": annotation_id}).fetchone()
    db.commit()
    return Annotation(**row._mapping)
