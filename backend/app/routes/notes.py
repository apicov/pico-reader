"""The reader's notes (app/notes_service.py)."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import Reader, get_current_reader
from app.db import get_db
from app.notes_service import KEEP, Note, change_note, create_note, get_note, list_notes

router = APIRouter(prefix="/api/notes", tags=["notes"])


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


@router.get("", response_model=list[Note])
def notes(book: str | None = None, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    return list_notes(db, reader.email, book)


@router.post("", response_model=Note, status_code=201)
def add(body: NoteIn, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    if body.book_id and db.execute(text("SELECT 1 FROM books WHERE id = :b"), {"b": body.book_id}).fetchone() is None:
        raise HTTPException(404, "No such book")
    return create_note(db, reader.email, body.title, body.markdown, body.book_id, [], body.origin, body.project_id)


@router.get("/{note_id}", response_model=Note)
def note(note_id: str, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    return get_note(db, reader.email, note_id)


@router.patch("/{note_id}", response_model=Note)
def edit(note_id: str, body: NoteChange, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    if body.updated_at_was is not None:
        current = get_note(db, reader.email, note_id).updated_at
        if current != body.updated_at_was:
            raise HTTPException(409, {"message": "The note changed meanwhile", "updated_at": current})
    return change_note(db, reader.email, note_id, body.title, body.markdown,
                       project_id=body.project_id if "project_id" in body.model_fields_set else KEEP)


@router.delete("/{note_id}", status_code=204)
def delete(note_id: str, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    get_note(db, reader.email, note_id)
    db.execute(text("DELETE FROM notes WHERE id = :id AND reader_email = :e"), {"id": note_id, "e": reader.email})
    db.commit()
