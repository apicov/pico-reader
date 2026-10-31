"""Tools about the library and the reader's books: what there is, a book's details, its passages, translations,
highlights, a link into a book, an Anki export, My shelf."""


from sqlalchemy import text

from app import categories
from app.agent.registry import Context, book_or_error, stats_of
from app.search_service import fold_accents, retrieve


def list_books(ctx: Context, category: str | None = None) -> dict:
    paths = {n["id"]: n["path"] for n in categories.tree(ctx.db)}
    rows = ctx.db.execute(text("""
        SELECT b.id, b.title, b.author, b.language, b.files, b.word_count, i.chunks, rs.progress, rs.updated_at,
               sh.status AS shelf, ms.book_id IS NOT NULL AS on_my_shelf, b.category_id, b.category2_id,
               (SELECT array_agg(c.name ORDER BY c.position) FROM collection_books cb JOIN collections c ON c.id = cb.collection_id
                WHERE cb.book_id = b.id AND c.reader_email = :e) AS collections
        FROM books b LEFT JOIN book_index i ON i.book_id = b.id
        LEFT JOIN reading_state rs ON rs.book_id = b.id AND rs.reader_email = :e
        LEFT JOIN shelf sh ON sh.book_id = b.id AND sh.reader_email = :e
        LEFT JOIN my_shelf ms ON ms.book_id = b.id AND ms.reader_email = :e
        WHERE b.status = 'ready' ORDER BY lower(b.title)"""), {"e": ctx.reader.email}).fetchall()
    wanted = fold_accents(category) if category else None

    def in_category(r) -> bool:
        return not wanted or any(wanted in fold_accents(paths.get(c) or "") for c in (r.category_id, r.category2_id))

    return {"books": [{"id": r.id, "title": r.title, "author": r.author, "language": r.language,
                       "category": paths.get(r.category_id), "second_category": paths.get(r.category2_id),
                       "formats": sorted(k for k in r.files if k not in ("cover", "search")), "words": r.word_count,
                       "searchable": bool(r.chunks), "progress_percent": round((r.progress or 0) * 100),
                       "last_opened": r.updated_at.isoformat() if r.updated_at else None,
                       "shelf": r.shelf or "not started",
                       "on_my_shelf": r.on_my_shelf,
                       "collections": list(r.collections or [])} for r in rows if in_category(r)]}

def book_details(ctx: Context, book: str) -> dict:
    found, error = book_or_error(ctx, book)
    if error:
        return error
    s = stats_of(ctx, "all", found["id"])
    per_book = s["books"][0] if s["books"] else {}
    highlights = ctx.db.execute(text("""SELECT count(*) FILTER (WHERE kind = 'highlight') AS h,
                                           count(*) FILTER (WHERE kind = 'bookmark') AS b FROM annotations
                                        WHERE reader_email = :e AND book_id = :b AND NOT deleted"""),
                                {"e": ctx.reader.email, "b": found["id"]}).fetchone()
    return {"id": found["id"], "title": found["title"], "author": found["author"], "language": found["language"],
            "words": found["word_count"], "progress_percent": round(per_book.get("progress", 0) * 100),
            "minutes_read": round(per_book.get("seconds", 0) / 60), "words_per_minute": per_book.get("wpm"),
            "minutes_left": per_book.get("minutes_left"), "lookups": s["totals"]["lookups"],
            "highlights": highlights.h, "bookmarks": highlights.b}

def search_passages(ctx: Context, query: str, book: str | None = None) -> dict:
    found, error = book_or_error(ctx, book)
    if error:
        return error
    passages = retrieve(ctx.db, query, [found["id"]] if found else None, 6, who=(ctx.reader.email, "search"))
    out = []
    for p in passages:
        ctx.sources.append(p)
        out.append({"source": len(ctx.sources), "book": p.title, "section": p.heading, "text": p.text})
    return {"passages": out, "cite_as": "[n] with n = source"}

def translations(ctx: Context, query: str | None = None, book: str | None = None, limit: int = 10) -> dict:
    found, error = book_or_error(ctx, book)
    if error:
        return error
    rows = ctx.db.execute(text("""
        SELECT t.source_text, t.result, t.target_lang, t.created_at, coalesce(b.title, '') AS title
        FROM translations t LEFT JOIN books b ON b.id = t.book_id
        WHERE t.reader_email = :e AND (CAST(:b AS text) IS NULL OR t.book_id = :b)
          AND (CAST(:q AS text) IS NULL OR t.source_text ILIKE '%' || :q || '%' OR t.result->>'translation' ILIKE '%' || :q || '%')
        ORDER BY t.id DESC LIMIT :n"""), {"e": ctx.reader.email, "b": found["id"] if found else None, "q": query,
                                          "n": max(1, min(limit, 30))}).fetchall()
    return {"translations": [{"text": r.source_text, "translation": r.result.get("translation"),
                              "vocabulary": r.result.get("vocabulary", []), "book": r.title,
                              "date": r.created_at.date().isoformat()} for r in rows]}

def highlights(ctx: Context, book: str | None = None) -> dict:
    found, error = book_or_error(ctx, book)
    if error:
        return error
    rows = ctx.db.execute(text("""
        SELECT a.kind, a.text, a.note, a.progress, b.title FROM annotations a JOIN books b ON b.id = a.book_id
        WHERE a.reader_email = :e AND NOT a.deleted AND (CAST(:b AS text) IS NULL OR a.book_id = :b)
        ORDER BY b.title, a.progress LIMIT 60"""), {"e": ctx.reader.email, "b": found["id"] if found else None})
    return {"items": [{"kind": r.kind, "book": r.title, "text": r.text, "note": r.note,
                       "at_percent": round(r.progress * 100)} for r in rows]}

def open_book_at(ctx: Context, book: str, percent: float | None = None, source: int | None = None) -> dict:
    """A button in the chat that opens the book (at a share of it, or at a found passage)."""
    if source and 1 <= source <= len(ctx.sources):
        p = ctx.sources[source - 1]
        return {"link": {"kind": "open", "label": f"Open {p.title}", "book_id": p.book_id, "format": p.format,
                         "location": p.location, "progress": p.progress}}
    found, error = book_or_error(ctx, book)
    if error:
        return error
    link = {"kind": "open", "label": f"Open {found['title']}", "book_id": found["id"]}
    if percent is not None:
        link.update(progress=max(0, min(100, percent)) / 100, location="", format="")
    return {"link": link}

def export_anki(ctx: Context, book: str | None = None) -> dict:
    found, error = book_or_error(ctx, book)
    if error:
        return error
    path = "/api/vocabulary.apkg" + (f"?book_id={found['id']}" if found else "")
    return {"link": {"kind": "download", "label": "Download the Anki deck", "path": path,
                     "filename": "pico-reader-vocabulary.apkg"}}

def my_shelf(ctx: Context) -> dict:
    """The books on My shelf, by collection, with where the reader is in each."""
    rows = ctx.db.execute(text("""
        SELECT b.id, b.title, b.author, sh.status, coalesce(rs.progress, 0) AS progress, ms.added_at,
               (SELECT array_agg(c.name ORDER BY c.position) FROM collection_books cb JOIN collections c ON c.id = cb.collection_id
                WHERE cb.book_id = b.id AND c.reader_email = :e) AS collections
        FROM my_shelf ms JOIN books b ON b.id = ms.book_id AND b.status = 'ready'
        LEFT JOIN shelf sh ON sh.book_id = b.id AND sh.reader_email = :e
        LEFT JOIN reading_state rs ON rs.book_id = b.id AND rs.reader_email = :e
        WHERE ms.reader_email = :e ORDER BY ms.added_at DESC"""), {"e": ctx.reader.email}).fetchall()
    collections = [c for (c,) in ctx.db.execute(text("SELECT name FROM collections WHERE reader_email = :e ORDER BY position, created_at"),
                                               {"e": ctx.reader.email})]
    book = lambda r: {"title": r.title, "author": r.author, "status": r.status or "not started",
                      "progress_percent": round(r.progress * 100)}
    return {"collections": {c: [book(r) for r in rows if c in (r.collections or [])] for c in collections},
            "not_in_a_collection": [book(r) for r in rows if not r.collections]}
