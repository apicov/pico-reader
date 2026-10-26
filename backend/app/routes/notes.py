"""Notes: Markdown documents (summaries, outlines, Mermaid diagrams) a reader keeps, alone or about a book.
The chat agent writes them when asked, after the reader confirms (agent_tools.save_note); the reader reads,
edits and deletes them in the app, and the desktop tool keeps them as .md files on their computer (`origin`
says where a note was made). Private: nobody else sees a reader's notes."""

import json
import uuid

from fastapi import APIRouter, Depends, HTTPException
from typing import Literal

from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import Reader, get_current_reader
from app.db import get_db

router = APIRouter(prefix="/api/notes", tags=["notes"])

MAX_CHARS = 30_000
MAX_NOTES = 300
MAX_TITLE = 200


class Note(BaseModel):
    id: str
    title: str
    markdown: str
    book_id: str | None
    book_title: str | None
    sources: list[dict]
    origin: str
    project_id: str | None = None  # a project on the study computer: the note's file is in its notes/ folder
    project: str | None = None  # its name
    created_at: str
    updated_at: str


class NoteIn(BaseModel):
    title: str
    markdown: str
    book_id: str | None = None
    origin: Literal["app", "computer"] = "app"
    project_id: str | None = None


class NoteChange(BaseModel):
    title: str | None = None
    markdown: str | None = None
    project_id: str | None = None  # sent (even as null) to move the note to a project, or out of it
    # the version the change was made on (the desktop tool sends it): a newer one on the server is a conflict
    updated_at_was: str | None = None


class NoteLimit(ValueError):
    pass


SELECT = """SELECT n.id, n.title, n.markdown, n.book_id, b.title AS book_title, n.sources, n.origin, n.project_id,
                   p.name AS project, n.created_at, n.updated_at
            FROM notes n LEFT JOIN books b ON b.id = n.book_id LEFT JOIN projects p ON p.id = n.project_id"""


def _note(r) -> Note:
    return Note(id=r.id, title=r.title, markdown=r.markdown, book_id=r.book_id, book_title=r.book_title,
                sources=r.sources, origin=r.origin, project_id=r.project_id, project=r.project, created_at=r.created_at.isoformat(), updated_at=r.updated_at.isoformat())


def _check(title: str, markdown: str) -> tuple[str, str]:
    title = " ".join(title.split())[:MAX_TITLE]
    if not title:
        raise NoteLimit("A note needs a title")
    if len(markdown) > MAX_CHARS:
        raise NoteLimit(f"A note can have at most {MAX_CHARS:,} characters (this one has {len(markdown):,})")
    return title, markdown


def list_notes(db: Session, email: str, book_id: str | None = None) -> list[Note]:
    rows = db.execute(text(f"{SELECT} WHERE n.reader_email = :e AND (CAST(:b AS text) IS NULL OR n.book_id = :b)"
                           " ORDER BY n.updated_at DESC"), {"e": email, "b": book_id})
    return [_note(r) for r in rows]


def get_note(db: Session, email: str, note_id: str) -> Note:
    r = db.execute(text(f"{SELECT} WHERE n.id = :id AND n.reader_email = :e"), {"id": note_id, "e": email}).fetchone()
    if r is None:
        raise HTTPException(404, "Not found")
    return _note(r)


def check_project(db: Session, email: str, project_id: str | None) -> None:
    if project_id and db.execute(text("SELECT 1 FROM projects WHERE id = :p AND reader_email = :e"),
                                 {"p": project_id, "e": email}).fetchone() is None:
        raise HTTPException(404, "No such project")


def create_note(db: Session, email: str, title: str, markdown: str, book_id: str | None, sources: list[dict],
                origin: str = "chat", project_id: str | None = None) -> Note:
    title, markdown = _check(title, markdown)
    check_project(db, email, project_id)
    count = db.execute(text("SELECT count(*) FROM notes WHERE reader_email = :e"), {"e": email}).scalar()
    if count >= MAX_NOTES:
        raise NoteLimit(f"You have {MAX_NOTES} notes, the most there can be: delete some first")
    note_id = f"note-{uuid.uuid4()}"
    db.execute(text("""INSERT INTO notes (id, reader_email, book_id, title, markdown, sources, origin, project_id)
                       VALUES (:id, :e, :b, :t, :m, CAST(:s AS jsonb), :o, :p)"""),
               {"id": note_id, "e": email, "b": book_id, "t": title, "m": markdown, "s": json.dumps(sources), "o": origin,
                "p": project_id})
    db.commit()
    return get_note(db, email, note_id)


KEEP = object()  # change_note: leave the project as it is


def change_note(db: Session, email: str, note_id: str, title: str | None = None, markdown: str | None = None,
                sources: list[dict] | None = None, project_id: str | None | object = KEEP) -> Note:
    old = get_note(db, email, note_id)
    title, markdown = _check(old.title if title is None else title, old.markdown if markdown is None else markdown)
    if project_id is KEEP:
        project_id = old.project_id
    check_project(db, email, project_id)
    db.execute(text("""UPDATE notes SET title = :t, markdown = :m, sources = CAST(:s AS jsonb), project_id = :p,
                       updated_at = now() WHERE id = :id AND reader_email = :e"""),
               {"t": title, "m": markdown, "s": json.dumps(old.sources if sources is None else sources),
                "p": project_id, "id": note_id, "e": email})
    db.commit()
    return get_note(db, email, note_id)


@router.get("", response_model=list[Note])
def notes(book: str | None = None, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    return list_notes(db, reader.email, book)


@router.post("", response_model=Note, status_code=201)
def add(body: NoteIn, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    if body.book_id and db.execute(text("SELECT 1 FROM books WHERE id = :b"), {"b": body.book_id}).fetchone() is None:
        raise HTTPException(404, "No such book")
    try:
        return create_note(db, reader.email, body.title, body.markdown, body.book_id, [], body.origin, body.project_id)
    except NoteLimit as e:
        raise HTTPException(422, str(e))


@router.get("/{note_id}", response_model=Note)
def note(note_id: str, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    return get_note(db, reader.email, note_id)


@router.patch("/{note_id}", response_model=Note)
def edit(note_id: str, body: NoteChange, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    if body.updated_at_was is not None:
        current = get_note(db, reader.email, note_id).updated_at
        if current != body.updated_at_was:
            raise HTTPException(409, {"message": "The note changed meanwhile", "updated_at": current})
    try:
        return change_note(db, reader.email, note_id, body.title, body.markdown,
                           project_id=body.project_id if "project_id" in body.model_fields_set else KEEP)
    except NoteLimit as e:
        raise HTTPException(422, str(e))


@router.delete("/{note_id}", status_code=204)
def delete(note_id: str, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    get_note(db, reader.email, note_id)
    db.execute(text("DELETE FROM notes WHERE id = :id AND reader_email = :e"), {"id": note_id, "e": reader.email})
    db.commit()
