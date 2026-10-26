"""The reader's study computer: things sent from the app (or by the chat agent) wait here, in a per-reader mailbox
(`drops`), until the desktop tool (`reader sync`, tools/readertool/sync.py) collects them into files. The tool's
visits are recorded so the app can say when the computer last synced.

Projects are folders on that computer (`reader project add`), each with its own notes/ and inbox/: a note or a
drop with a project goes there instead of the general ~/pico folders."""

import json
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import Reader, get_current_reader
from app.db import get_db

router = APIRouter(prefix="/api", tags=["computer"])

MAX_WAITING = 500
KEEP_DELIVERED_DAYS = 30
MAX_PROJECTS = 50


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
        raise HTTPException(422, f"{MAX_WAITING} items are waiting for your computer: start `reader sync` there first")
    meta = body.meta.model_dump()
    if body.meta.book_id and not body.meta.book_title:
        meta["book_title"] = db.execute(text("SELECT title FROM books WHERE id = :b"), {"b": body.meta.book_id}).scalar() or ""
    if body.project_id and db.execute(text("SELECT 1 FROM projects WHERE id = :p AND reader_email = :e"),
                                      {"p": body.project_id, "e": email}).fetchone() is None:
        raise HTTPException(404, "No such project")
    drop_id = body.id or f"drop-{uuid.uuid4()}"
    owner = db.execute(text("SELECT reader_email FROM drops WHERE id = :id"), {"id": drop_id}).scalar()
    if owner and owner != email:
        raise HTTPException(409, "That id is taken")
    db.execute(text("""INSERT INTO drops (id, reader_email, kind, title, language, body, meta, project_id, append)
                       VALUES (:id, :e, :k, :t, :l, :b, CAST(:m AS jsonb), :p, :a) ON CONFLICT (id) DO NOTHING"""),
               {"id": drop_id, "e": email, "k": body.kind, "t": body.title.strip(), "l": body.language.strip().lower(),
                "b": body.body, "m": json.dumps(meta), "p": body.project_id, "a": body.append})
    db.commit()
    return drop_id


@router.post("/drops", status_code=201)
def send(body: DropIn, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    return {"id": create_drop(db, reader.email, body)}


def _pending(db: Session, email: str) -> list[Drop]:
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


@router.get("/drops", response_model=list[Drop])
def pending(reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    """What waits for the computer, oldest first."""
    return _pending(db, reader.email)


@router.get("/computer/poll")
def poll(reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    """The desktop tool's call every few seconds, kept small: what waits for it, the projects, and a stamp that
    changes whenever a note is added, changed, moved or deleted (only then does it fetch the notes)."""
    stamp = db.execute(text("SELECT count(*), max(updated_at) FROM notes WHERE reader_email = :e"), {"e": reader.email}).fetchone()
    return {"drops": _pending(db, reader.email), "projects": list_projects(db, reader.email),
            "notes_stamp": f"{stamp[0]}:{stamp[1].isoformat() if stamp[1] else ''}"}


class Project(BaseModel):
    id: str
    name: str
    notes: int


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)


def list_projects(db: Session, email: str) -> list[Project]:
    rows = db.execute(text("""SELECT p.id, p.name, count(n.id) AS notes FROM projects p
                              LEFT JOIN notes n ON n.project_id = p.id WHERE p.reader_email = :e
                              GROUP BY p.id ORDER BY lower(p.name)"""), {"e": email})
    return [Project(id=r.id, name=r.name, notes=r.notes) for r in rows]


@router.get("/projects", response_model=list[Project])
def projects(reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    return list_projects(db, reader.email)


@router.put("/projects/{project_id}", response_model=Project)
def put_project(body: ProjectIn, project_id: str = Path(pattern=r"^proj-[a-z0-9-]{8,60}$"),
                reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    """Creates the project (the desktop tool makes the id) or renames it."""
    name = " ".join(body.name.split())
    owner = db.execute(text("SELECT reader_email FROM projects WHERE id = :id"), {"id": project_id}).scalar()
    if owner and owner != reader.email:
        raise HTTPException(404, "Not found")
    clash = db.execute(text("SELECT id FROM projects WHERE reader_email = :e AND lower(name) = lower(:n) AND id <> :id"),
                       {"e": reader.email, "n": name, "id": project_id}).scalar()
    if clash:
        raise HTTPException(409, f"You have a project called {name!r} already")
    if not owner and db.execute(text("SELECT count(*) FROM projects WHERE reader_email = :e"),
                                {"e": reader.email}).scalar() >= MAX_PROJECTS:
        raise HTTPException(422, f"At most {MAX_PROJECTS} projects")
    db.execute(text("""INSERT INTO projects (id, reader_email, name) VALUES (:id, :e, :n)
                       ON CONFLICT (id) DO UPDATE SET name = :n"""), {"id": project_id, "e": reader.email, "n": name})
    db.execute(text("UPDATE notes SET updated_at = now() WHERE project_id = :id"), {"id": project_id})  # the files say it
    db.commit()
    return next(p for p in list_projects(db, reader.email) if p.id == project_id)


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(project_id: str, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    """Its notes stay, in no project (back to ~/pico/notes on the computer)."""
    db.execute(text("UPDATE notes SET updated_at = now() WHERE project_id = :id AND reader_email = :e"),
               {"id": project_id, "e": reader.email})
    done = db.execute(text("DELETE FROM projects WHERE id = :id AND reader_email = :e"),
                      {"id": project_id, "e": reader.email}).rowcount
    db.commit()
    if not done:
        raise HTTPException(404, "Not found")


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
