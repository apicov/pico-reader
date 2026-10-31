"""The study computer's API: the app sends things to it, the desktop tool collects them and keeps the projects
(app/computer_service.py)."""


from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import Reader, get_current_reader
from app.computer_service import Drop, DropIn, Project, create_drop, list_projects, pending_drops
from app.db import get_db

router = APIRouter(prefix="/api", tags=["computer"])

MAX_PROJECTS = 50


class Created(BaseModel):
    id: str


class Poll(BaseModel):
    drops: list[Drop]
    projects: list[Project]
    notes_stamp: str  # changes whenever a note does


class ComputerStatus(BaseModel):
    seen_at: str | None  # when it last synced; None: never
    waiting: int


@router.post("/drops", status_code=201, response_model=Created)
def send(body: DropIn, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    return {"id": create_drop(db, reader.email, body)}


@router.get("/drops", response_model=list[Drop])
def pending(reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    """What waits for the computer, oldest first."""
    return pending_drops(db, reader.email)


@router.get("/computer/poll", response_model=Poll)
def poll(reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    """The desktop tool's call every few seconds, kept small: what waits for it, the projects, and a stamp that
    changes whenever a note is added, changed, moved or deleted (only then does it fetch the notes)."""
    stamp = db.execute(text("SELECT count(*), max(updated_at) FROM notes WHERE reader_email = :e"), {"e": reader.email}).fetchone()
    return {"drops": pending_drops(db, reader.email), "projects": list_projects(db, reader.email),
            "notes_stamp": f"{stamp[0]}:{stamp[1].isoformat() if stamp[1] else ''}"}


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)


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


@router.get("/computer", response_model=ComputerStatus)
def status(reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    """When the computer last synced (null: never) and how much waits for it."""
    seen = db.execute(text("SELECT seen_at FROM computers WHERE reader_email = :e"), {"e": reader.email}).scalar()
    waiting = db.execute(text("SELECT count(*) FROM drops WHERE reader_email = :e AND delivered_at IS NULL"),
                         {"e": reader.email}).scalar()
    return {"seen_at": seen.isoformat() if seen else None, "waiting": waiting}
