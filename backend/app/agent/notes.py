"""Tools about the reader's notes and study computer (saving, adding to and sending notes run after the reader
confirms)."""

import re

from app import computer_service, notes_service
from app.agent.registry import Context, book_or_error
from app.search_service import fold_accents


def _find_note(ctx: Context, note: str) -> notes_service.Note | None:
    """One of the reader's notes by id or (part of) its title."""
    mine = notes_service.list_notes(ctx.db, ctx.reader.email)
    wanted = fold_accents(note)
    return next((n for n in mine if n.id == note), None) or next((n for n in mine if wanted in fold_accents(n.title)), None)

def _project(ctx: Context, name: str | None) -> tuple[str | None, dict | None]:
    """(project id, error) for a project on the study computer named (in part) `name`; (None, None) for none."""
    if not name:
        return None, None
    projects = computer_service.list_projects(ctx.db, ctx.reader.email)
    wanted = fold_accents(name)
    found = next((p for p in projects if fold_accents(p.name) == wanted), None) or \
        next((p for p in projects if wanted in fold_accents(p.name)), None)
    if found is None:
        return None, {"error": f"No project {name!r}. The reader's projects: {[p.name for p in projects] or 'none yet'}"}
    return found.id, None

def list_notes(ctx: Context, book: str | None = None, project: str | None = None) -> dict:
    found, error = book_or_error(ctx, book)
    if error:
        return error
    project_id, error = _project(ctx, project)
    if error:
        return error
    notes = notes_service.list_notes(ctx.db, ctx.reader.email, found["id"] if found else None)
    return {"notes": [{"id": n.id, "title": n.title, "book": n.book_title, "project": n.project,
                       "updated": n.updated_at[:10], "characters": len(n.markdown), "made_in": n.origin}
                      for n in notes if not project_id or n.project_id == project_id],
            "projects": [p.name for p in computer_service.list_projects(ctx.db, ctx.reader.email)]}

def read_note(ctx: Context, note: str) -> dict:
    found = _find_note(ctx, note)
    if found is None:
        return {"error": f"No note {note!r}; list_notes shows them"}
    # its [n] belong to the note's own sources, not to this answer's: left out so they aren't cited by mistake
    return {"id": found.id, "title": found.title, "book": found.book_title, "project": found.project, "made_in": found.origin,
            "markdown": re.sub(r"\s?\[\d+\]", "", found.markdown)}


# --- tools that change something (run after the reader confirms) ---

def _cited(markdown: str, sources: list[dict], first: int = 1) -> tuple[str, list[dict]]:
    """The note's own copy of the passages it cites, numbered from `first` in the order they appear; [n] that
    point at no passage are dropped."""
    numbers: dict[int, int] = {}

    def renumber(m: re.Match) -> str:
        n = int(m.group(2))
        if not 1 <= n <= len(sources):
            return ""
        numbers.setdefault(n, first + len(numbers))
        return f"{m.group(1)}[{numbers[n]}]"

    out = re.sub(r"(\s?)\[(\d+)\]", renumber, markdown)
    return out, [sources[n - 1] for n in numbers]

def save_note(ctx: Context, title: str, markdown: str, book: str | None = None, project: str | None = None,
              _sources: list[dict] | None = None) -> dict:
    found, error = book_or_error(ctx, book)
    if error:
        return error
    project_id, error = _project(ctx, project)
    if error:
        return error
    markdown, sources = _cited(markdown, _sources or [])
    try:
        n = notes_service.create_note(ctx.db, ctx.reader.email, title, markdown, found["id"] if found else None, sources,
                                     project_id=project_id)
    except notes_service.NoteLimit as e:
        return {"error": str(e)}
    return {"saved": n.title, "id": n.id}

def send_to_computer(ctx: Context, title: str, text: str, kind: str = "text", language: str = "",
                     project: str | None = None, append: bool = False) -> dict:
    """Into the reader's study computer's inbox folder, or a project's (the desktop tool writes it as a file)."""
    project_id, error = _project(ctx, project)
    if error:
        return error
    drop = computer_service.DropIn(kind=kind if kind in ("text", "snippet", "note") else "text", title=title[:200],
                                  language=language[:30], body=text, project_id=project_id, append=bool(append))
    return {"sent": title, "id": computer_service.create_drop(ctx.db, ctx.reader.email, drop)}

def append_to_note(ctx: Context, note: str, markdown: str, _sources: list[dict] | None = None) -> dict:
    found = _find_note(ctx, note)
    if found is None:
        return {"error": f"No note {note!r}"}
    added, sources = _cited(markdown, _sources or [], first=len(found.sources) + 1)
    try:
        n = notes_service.change_note(ctx.db, ctx.reader.email, found.id,
                                     markdown=f"{found.markdown.rstrip()}\n\n{added.strip()}\n",
                                     sources=found.sources + sources)
    except notes_service.NoteLimit as e:
        return {"error": str(e)}
    return {"updated": n.title, "id": n.id}
