"""Workspaces: a reader's named sets of books open at the same time (the reader's tabs), synced between devices.
The device makes the id and stamps every change; per workspace the newest stamp wins, as with reading positions,
and a deleted one stays as a tombstone (not listed) so an older change from another device can't bring it back."""

import json

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import AwareDatetime, BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import Reader, get_current_reader
from app.db import get_db

router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])

MAX_WORKSPACES = 50
MAX_BOOKS = 8
WORKSPACE_ID = r"^ws-[a-z0-9-]{8,60}$"


class Workspace(BaseModel):
    id: str
    name: str
    book_ids: list[str]
    position: int
    updated_at: AwareDatetime
    deleted: bool


class WorkspaceIn(BaseModel):
    name: str = Field(min_length=1, max_length=60, pattern=r"\S")
    book_ids: list[str] = Field(max_length=MAX_BOOKS)
    position: int = 0
    updated_at: AwareDatetime
    deleted: bool = False


def _row(r) -> Workspace:
    return Workspace(id=r.id, name=r.name, book_ids=r.book_ids, position=r.position, updated_at=r.updated_at,
                     deleted=r.deleted)


@router.get("")
def workspaces(reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)) -> list[Workspace]:
    rows = db.execute(text("""SELECT id, name, book_ids, position, updated_at, deleted FROM workspaces
                              WHERE reader_email = :e AND NOT deleted ORDER BY position, id"""), {"e": reader.email})
    return [_row(r) for r in rows]


@router.put("/{workspace_id}")
def save_workspace(body: WorkspaceIn, workspace_id: str = Path(pattern=WORKSPACE_ID),
                   reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)) -> Workspace:
    """Create, change or delete (`deleted`). Returns what the server keeps: the change sent, or a newer one from
    another device; its `updated_at` is the device's, unless that was ahead of the server's clock."""
    owner = db.execute(text("SELECT reader_email FROM workspaces WHERE id = :id"), {"id": workspace_id}).scalar()
    if owner is not None and owner != reader.email:
        raise HTTPException(404, "No such workspace")
    if owner is None:
        count = db.execute(text("SELECT count(*) FROM workspaces WHERE reader_email = :e AND NOT deleted"),
                           {"e": reader.email}).scalar()
        if count >= MAX_WORKSPACES and not body.deleted:
            raise HTTPException(422, f"At most {MAX_WORKSPACES} workspaces")
    books = list(dict.fromkeys(body.book_ids))  # each once, in order
    db.execute(text("""
        INSERT INTO workspaces (id, reader_email, name, book_ids, position, deleted, updated_at)
        VALUES (:id, :e, :n, CAST(:b AS jsonb), :p, :d, least(CAST(:u AS timestamptz), now()))
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, book_ids = EXCLUDED.book_ids,
            position = EXCLUDED.position, deleted = EXCLUDED.deleted, updated_at = EXCLUDED.updated_at
            WHERE workspaces.updated_at < EXCLUDED.updated_at AND NOT workspaces.deleted"""),
        {"id": workspace_id, "e": reader.email, "n": body.name.strip(), "b": json.dumps(books), "p": body.position,
         "d": body.deleted, "u": body.updated_at})
    db.commit()
    row = db.execute(text("SELECT id, name, book_ids, position, updated_at, deleted FROM workspaces WHERE id = :id"),
                     {"id": workspace_id}).fetchone()
    return _row(row)
