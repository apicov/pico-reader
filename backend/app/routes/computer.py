"""The reader's study computer: things sent from the app (or by the chat agent) wait here, in a per-reader mailbox
(`drops`), until the desktop tool (`reader sync`, tools/readertool/sync.py) collects them into files. The tool's
visits are recorded so the app can say when the computer last synced."""

import json
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import Reader, get_current_reader
from app.db import get_db

router = APIRouter(prefix="/api", tags=["computer"])

MAX_WAITING = 500
KEEP_DELIVERED_DAYS = 30


class DropMeta(BaseModel):
    book_id: str | None = None
    book_title: str = ""
    heading: str = ""  # the chapter
    location: str = ""
    progress: float | None = None


class DropIn(BaseModel):
    id: str | None = Field(default=None, pattern=r"^drop-[a-z0-9-]{8,60}$")  # made on the device: a resend is harmless
    kind: Literal["highlight", "snippet", "note", "text"]
    title: str = Field(default="", max_length=200)
    language: str = Field(default="", max_length=30)  # a snippet's programming language
    body: str = Field(min_length=1, max_length=200_000)
    meta: DropMeta = DropMeta()


class Drop(DropIn):
    id: str
    created_at: str


def create_drop(db: Session, email: str, body: DropIn) -> str:
    waiting = db.execute(text("SELECT count(*) FROM drops WHERE reader_email = :e AND delivered_at IS NULL"),
                         {"e": email}).scalar()
    if waiting >= MAX_WAITING:
        raise HTTPException(422, f"{MAX_WAITING} items are waiting for your computer: start `reader sync` there first")
    meta = body.meta.model_dump()
    if body.meta.book_id and not body.meta.book_title:
        meta["book_title"] = db.execute(text("SELECT title FROM books WHERE id = :b"), {"b": body.meta.book_id}).scalar() or ""
    drop_id = body.id or f"drop-{uuid.uuid4()}"
    owner = db.execute(text("SELECT reader_email FROM drops WHERE id = :id"), {"id": drop_id}).scalar()
    if owner and owner != email:
        raise HTTPException(409, "That id is taken")
    db.execute(text("""INSERT INTO drops (id, reader_email, kind, title, language, body, meta)
                       VALUES (:id, :e, :k, :t, :l, :b, CAST(:m AS jsonb)) ON CONFLICT (id) DO NOTHING"""),
               {"id": drop_id, "e": email, "k": body.kind, "t": body.title.strip(), "l": body.language.strip().lower(),
                "b": body.body, "m": json.dumps(meta)})
    db.commit()
    return drop_id


@router.post("/drops", status_code=201)
def send(body: DropIn, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    return {"id": create_drop(db, reader.email, body)}


@router.get("/drops", response_model=list[Drop])
def pending(reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    """What waits for the computer, oldest first (the desktop tool calls this every few seconds)."""
    db.execute(text("""INSERT INTO computers (reader_email) VALUES (:e)
                       ON CONFLICT (reader_email) DO UPDATE SET seen_at = now()"""), {"e": reader.email})
    db.execute(text(f"""DELETE FROM drops WHERE reader_email = :e
                        AND delivered_at < now() - interval '{KEEP_DELIVERED_DAYS} days'"""), {"e": reader.email})
    rows = db.execute(text("""SELECT id, kind, title, language, body, meta, created_at FROM drops
                              WHERE reader_email = :e AND delivered_at IS NULL ORDER BY created_at LIMIT 100"""),
                      {"e": reader.email}).fetchall()
    db.commit()
    return [Drop(id=r.id, kind=r.kind, title=r.title, language=r.language, body=r.body, meta=DropMeta(**r.meta),
                 created_at=r.created_at.isoformat()) for r in rows]


@router.post("/drops/{drop_id}/delivered", status_code=204)
def delivered(drop_id: str, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    done = db.execute(text("""UPDATE drops SET delivered_at = coalesce(delivered_at, now())
                              WHERE id = :id AND reader_email = :e"""), {"id": drop_id, "e": reader.email}).rowcount
    db.commit()
    if not done:
        raise HTTPException(404, "Not found")


@router.get("/computer")
def status(reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    """When the computer last synced (null: never) and how much waits for it."""
    seen = db.execute(text("SELECT seen_at FROM computers WHERE reader_email = :e"), {"e": reader.email}).scalar()
    waiting = db.execute(text("SELECT count(*) FROM drops WHERE reader_email = :e AND delivered_at IS NULL"),
                         {"e": reader.email}).scalar()
    return {"seen_at": seen.isoformat() if seen else None, "waiting": waiting}
