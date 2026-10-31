"""What every tool gets (the reader, the database, their time zone, the passages found so far) and the tool's
description; finding a book by name."""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app import stats_service
from app.auth import Reader
from app.search_service import fold_accents


@dataclass
class Context:
    db: Session
    reader: Reader
    tz: str
    sources: list  # passages found during this answer, numbered from 1 in order

@dataclass
class Tool:
    name: str
    description: str
    parameters: dict
    run: Callable[..., Any]
    changes: bool = False  # proposed in the chat, run only after the reader confirms
    label: Callable[[dict], str] = lambda args: ""  # what a proposed change is, for the reader
    shown_as: str = ""  # what the chat shows the agent used ("searched the books"); the name when empty
    cites_sources: bool = False  # keeps the passages its [n] cite (a note)
    preview: str = ""  # the argument shown before the reader confirms (a note's text)

    def schema(self) -> dict:
        return {"type": "function", "function": {"name": self.name, "description": self.description,
                                                 "parameters": self.parameters}}

def resolve_book(ctx: Context, book: str | None) -> dict | None:
    """A book by id or (part of) its title, accents and case ignored."""
    if not book:
        return None
    rows = ctx.db.execute(text("SELECT id, title, author, language, files, word_count FROM books WHERE status = 'ready'")).fetchall()
    for r in rows:
        if r.id == book:
            return dict(r._mapping)
    wanted = fold_accents(book)
    matches = [r for r in rows if wanted in fold_accents(r.title) or fold_accents(r.title) in wanted]
    if not matches:
        return None
    # the closest title: the same one, then one that starts with it, then the shortest (ties by id: always the same)
    best = min(matches, key=lambda r: (fold_accents(r.title) != wanted, not fold_accents(r.title).startswith(wanted), len(r.title), r.id))
    return dict(best._mapping)

def book_or_error(ctx: Context, book: str | None):
    found = resolve_book(ctx, book)
    if book and not found:
        return None, {"error": f"No book matches {book!r}. Use list_books."}
    return found, None


def stats_of(ctx: Context, period: str, book_id: str | None = None) -> dict:
    """The reader's statistics, as the stats page gets them"""
    return stats_service.reading_stats(ctx.db, ctx.reader.email, period, ctx.tz, book_id)
