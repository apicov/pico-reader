"""The reader's study computer: things sent from the app (or by the chat agent) wait here, in a per-reader mailbox
(`drops`), until the desktop tool (`reader sync`, tools/readertool/sync.py) collects them into files. The tool's
visits are recorded so the app can say when the computer last synced.

Projects are folders on that computer (`reader project add`), each with its own notes/ and inbox/: a note or a
drop with a project goes there instead of the general ~/pico folders."""

import json
import uuid
from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.errors import Conflict, Invalid, NotFound

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
    project_id: str | None = None  # lands in that project's inbox/
    append: bool = False  # added to the end of the inbox's running file (journal.md) instead of a file of its own


class Drop(DropIn):
    id: str
    created_at: str


def create_drop(db: Session, email: str, body: DropIn) -> str:
    waiting = db.execute(text("SELECT count(*) FROM drops WHERE reader_email = :e AND delivered_at IS NULL"),
                         {"e": email}).scalar()
    if waiting >= MAX_WAITING:
        raise Invalid(f"{MAX_WAITING} items are waiting for your computer: start `reader sync` there first")
    meta = body.meta.model_dump()
    if body.meta.book_id and not body.meta.book_title:
        meta["book_title"] = db.execute(text("SELECT title FROM books WHERE id = :b"), {"b": body.meta.book_id}).scalar() or ""
    if body.project_id and db.execute(text("SELECT 1 FROM projects WHERE id = :p AND reader_email = :e"),
                                      {"p": body.project_id, "e": email}).fetchone() is None:
        raise NotFound("No such project")
    drop_id = body.id or f"drop-{uuid.uuid4()}"
    owner = db.execute(text("SELECT reader_email FROM drops WHERE id = :id"), {"id": drop_id}).scalar()
    if owner and owner != email:
        raise Conflict("That id is taken")
    db.execute(text("""INSERT INTO drops (id, reader_email, kind, title, language, body, meta, project_id, append)
                       VALUES (:id, :e, :k, :t, :l, :b, CAST(:m AS jsonb), :p, :a) ON CONFLICT (id) DO NOTHING"""),
               {"id": drop_id, "e": email, "k": body.kind, "t": body.title.strip(), "l": body.language.strip().lower(),
                "b": body.body, "m": json.dumps(meta), "p": body.project_id, "a": body.append})
    db.commit()
    return drop_id


def pending_drops(db: Session, email: str) -> list[Drop]:
    """What waits for the computer, oldest first; the computer's visit is recorded, old delivered ones go"""
    db.execute(text("""INSERT INTO computers (reader_email) VALUES (:e)
                       ON CONFLICT (reader_email) DO UPDATE SET seen_at = now()"""), {"e": email})
    db.execute(text(f"""DELETE FROM drops WHERE reader_email = :e
                        AND delivered_at < now() - interval '{KEEP_DELIVERED_DAYS} days'"""), {"e": email})
    rows = db.execute(text("""SELECT id, kind, title, language, body, meta, project_id, append, created_at FROM drops
                              WHERE reader_email = :e AND delivered_at IS NULL ORDER BY created_at LIMIT 100"""),
                      {"e": email}).fetchall()
    db.commit()
    return [Drop(id=r.id, kind=r.kind, title=r.title, language=r.language, body=r.body, meta=DropMeta(**r.meta),
                 project_id=r.project_id, append=r.append, created_at=r.created_at.isoformat()) for r in rows]


class Project(BaseModel):
    id: str
    name: str
    notes: int


def list_projects(db: Session, email: str) -> list[Project]:
    rows = db.execute(text("""SELECT p.id, p.name, count(n.id) AS notes FROM projects p
                              LEFT JOIN notes n ON n.project_id = p.id WHERE p.reader_email = :e
                              GROUP BY p.id ORDER BY lower(p.name)"""), {"e": email})
    return [Project(id=r.id, name=r.name, notes=r.notes) for r in rows]
