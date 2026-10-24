"""The tools the chat agent can use: fixed functions with typed parameters (never free SQL), each answering for
the signed-in reader only, with compact JSON results.

Tools marked `changes=True` don't run when the model calls them: the chat proposes them, and they run only
after the reader confirms (chat.py)."""

import json
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable

from sqlalchemy import text
from sqlalchemy.orm import Session

from app import categories, community
from app.auth import Reader
from app.routes import stats as stats_routes
from app.routes.search import retrieve


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
    changes: bool = False
    label: Callable[[dict], str] = lambda args: ""

    def schema(self) -> dict:
        return {"type": "function", "function": {"name": self.name, "description": self.description,
                                                 "parameters": self.parameters}}


def _plain(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s.lower()) if not unicodedata.combining(c))


def resolve_book(ctx: Context, book: str | None) -> dict | None:
    """A book by id or (part of) its title, accents and case ignored."""
    if not book:
        return None
    rows = ctx.db.execute(text("SELECT id, title, author, language, files, word_count FROM books WHERE status = 'ready'")).fetchall()
    for r in rows:
        if r.id == book:
            return dict(r._mapping)
    wanted = _plain(book)
    matches = [r for r in rows if wanted in _plain(r.title) or _plain(r.title) in wanted]
    return dict(matches[0]._mapping) if matches else None


def _book_or_error(ctx: Context, book: str | None):
    found = resolve_book(ctx, book)
    if book and not found:
        return None, {"error": f"No book matches {book!r}. Use list_books."}
    return found, None


def _stats(ctx: Context, period: str, book_id: str | None = None) -> dict:
    return stats_routes.stats(period=period, tz=ctx.tz, book_id=book_id, reader=ctx.reader, db=ctx.db)


# --- read-only tools ---

def list_books(ctx: Context, category: str | None = None) -> dict:
    paths = {n["id"]: n["path"] for n in categories.tree(ctx.db)}
    rows = ctx.db.execute(text("""
        SELECT b.id, b.title, b.author, b.language, b.files, b.word_count, i.chunks, rs.progress, rs.updated_at,
               sh.status AS shelf, b.category_id, b.category2_id
        FROM books b LEFT JOIN book_index i ON i.book_id = b.id
        LEFT JOIN reading_state rs ON rs.book_id = b.id AND rs.reader_email = :e
        LEFT JOIN shelf sh ON sh.book_id = b.id AND sh.reader_email = :e
        WHERE b.status = 'ready' ORDER BY lower(b.title)"""), {"e": ctx.reader.email}).fetchall()
    wanted = _plain(category) if category else None

    def in_category(r) -> bool:
        return not wanted or any(wanted in _plain(paths.get(c) or "") for c in (r.category_id, r.category2_id))

    return {"books": [{"id": r.id, "title": r.title, "author": r.author, "language": r.language,
                       "category": paths.get(r.category_id), "second_category": paths.get(r.category2_id),
                       "formats": sorted(k for k in r.files if k not in ("cover", "search")), "words": r.word_count,
                       "searchable": bool(r.chunks), "progress_percent": round((r.progress or 0) * 100),
                       "last_opened": r.updated_at.isoformat() if r.updated_at else None,
                       "shelf": r.shelf or "not started"} for r in rows if in_category(r)]}


def book_details(ctx: Context, book: str) -> dict:
    found, error = _book_or_error(ctx, book)
    if error:
        return error
    s = _stats(ctx, "all", found["id"])
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
    found, error = _book_or_error(ctx, book)
    if error:
        return error
    passages = retrieve(ctx.db, query, [found["id"]] if found else None, 6, who=(ctx.reader.email, "search"))
    out = []
    for p in passages:
        ctx.sources.append(p)
        out.append({"source": len(ctx.sources), "book": p.title, "section": p.heading, "text": p.text})
    return {"passages": out, "cite_as": "[n] with n = source"}


def reading_stats(ctx: Context, period: str = "week", book: str | None = None) -> dict:
    found, error = _book_or_error(ctx, book)
    if error:
        return error
    s = _stats(ctx, period, found["id"] if found else None)
    return {"period": period, "unit": s["bucket"],
            "minutes": round(s["totals"]["seconds"] / 60), "words": s["totals"]["words"], "lookups": s["totals"]["lookups"],
            "today_minutes": round(s["today_seconds"] / 60), "streak_days": s["streak"],
            "goal": s["goal"], "per_" + s["bucket"]: [{"start": b["start"], "minutes": round(b["seconds"] / 60),
                                                       "words": b["words"]} for b in s["buckets"]],
            "books": [{"title": b["title"], "minutes": round(b["seconds"] / 60), "words_per_minute": b["wpm"],
                       "progress_percent": round(b["progress"] * 100), "minutes_left": b["minutes_left"]} for b in s["books"]]}


def lookup_stats(ctx: Context, period: str = "month", language: str | None = None) -> dict:
    s = _stats(ctx, period)
    density = {lang: {"lookups": d["lookups"], "words_read": d["words"], "lookups_per_1000_words": d["per_1000"],
                      "trend": [p for p in d["series"] if p["value"] is not None][-12:]}
               for lang, d in s["density"].items() if not language or lang == language}
    keep = lambda rows: [r for r in rows if not language or r["language"] == language][:15]
    return {"period": period, "by_language": density,
            "words_looked_up_repeatedly": [{"word": r["word"], "times": r["times"]} for r in keep(s["repeated"])],
            "not_found_in_dictionaries": [{"word": r["word"], "times": r["times"]} for r in keep(s["not_found"])],
            "known_words": s["known_words"], "review_due": s["review_due"]}


def translations(ctx: Context, query: str | None = None, book: str | None = None, limit: int = 10) -> dict:
    found, error = _book_or_error(ctx, book)
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
    found, error = _book_or_error(ctx, book)
    if error:
        return error
    rows = ctx.db.execute(text("""
        SELECT a.kind, a.text, a.note, a.progress, b.title FROM annotations a JOIN books b ON b.id = a.book_id
        WHERE a.reader_email = :e AND NOT a.deleted AND (CAST(:b AS text) IS NULL OR a.book_id = :b)
        ORDER BY b.title, a.progress LIMIT 60"""), {"e": ctx.reader.email, "b": found["id"] if found else None})
    return {"items": [{"kind": r.kind, "book": r.title, "text": r.text, "note": r.note,
                       "at_percent": round(r.progress * 100)} for r in rows]}


def vocabulary_due(ctx: Context, language: str | None = None) -> dict:
    rows = ctx.db.execute(text("""
        SELECT term, language, due FROM review_cards WHERE reader_email = :e AND NOT deleted
          AND (CAST(:l AS text) IS NULL OR language = :l) ORDER BY due LIMIT 200"""),
        {"e": ctx.reader.email, "l": language}).fetchall()
    now = datetime.now(timezone.utc)
    due = [r for r in rows if r.due <= now]
    return {"cards": len(rows), "due_now": len(due), "due_terms": [r.term for r in due[:20]],
            "next_due": min((r.due for r in rows if r.due > now), default=None)}


def reading_goal(ctx: Context) -> dict:
    return stats_routes.load_settings(ctx.db, ctx.reader.email).reading_goal.model_dump()


def open_book_at(ctx: Context, book: str, percent: float | None = None, source: int | None = None) -> dict:
    """A button in the chat that opens the book (at a share of it, or at a found passage)."""
    if source and 1 <= source <= len(ctx.sources):
        p = ctx.sources[source - 1]
        return {"link": {"kind": "open", "label": f"Open {p.title}", "book_id": p.book_id, "format": p.format,
                         "location": p.location, "progress": p.progress}}
    found, error = _book_or_error(ctx, book)
    if error:
        return error
    link = {"kind": "open", "label": f"Open {found['title']}", "book_id": found["id"]}
    if percent is not None:
        link.update(progress=max(0, min(100, percent)) / 100, location="", format="")
    return {"link": link}


def export_anki(ctx: Context, book: str | None = None) -> dict:
    found, error = _book_or_error(ctx, book)
    if error:
        return error
    path = "/api/vocabulary.apkg" + (f"?book_id={found['id']}" if found else "")
    return {"link": {"kind": "download", "label": "Download the Anki deck", "path": path,
                     "filename": "pico-reader-vocabulary.apkg"}}


def ai_usage(ctx: Context, period: str = "month") -> dict:
    return stats_routes.usage_summary(ctx.db, ctx.reader.email, period if period in ("week", "month", "year", "all") else "month", ctx.tz)


def book_opinions(ctx: Context, book: str) -> dict:
    found, error = _book_or_error(ctx, book)
    if error:
        return error
    summary = community.rating_summary(ctx.db, [found["id"]]).get(found["id"], {"review_count": 0})
    reviews = [{"by": r["author"]["display_name"], "score": r["score"], "recommend": r["recommend"],
                "text": "(spoiler)" if r["spoiler"] else r["body"][:400]}
               for r in community.reviews(ctx.db, ctx.reader, book_id=found["id"], limit=20) if not r["hidden"]]
    posts = [{"title": p["title"], "by": p["author"]["display_name"], "comments": p["comment_count"]}
             for p in community.list_posts(ctx.db, ctx.reader, book_id=found["id"], limit=10) if not p["hidden"]]
    return {"title": found["title"], **summary, "reviews": reviews, "discussions": posts}


def member_lists(ctx: Context, handle: str | None = None) -> dict:
    owner = None
    if handle:
        owner = ctx.db.execute(text("SELECT reader_email FROM profiles WHERE handle = :h OR lower(display_name) = :h"),
                               {"h": handle.lower().lstrip("@")}).scalar()
        if owner is None:
            return {"error": f"No reader called {handle!r}"}
    return {"lists": [{"title": l["title"], "by": l["author"]["display_name"],
                       "books": [i["book"]["title"] for i in l["items"] if i["book"]["available"]]}
                      for l in community.lists(ctx.db, ctx.reader, owner_email=owner) if not l["hidden"]][:20]}


# --- tools that change something (run after the reader confirms) ---

def set_reading_goal(ctx: Context, enabled: bool, minutes: int | None = None, days: list[int] | None = None) -> dict:
    settings = stats_routes.load_settings(ctx.db, ctx.reader.email)
    goal = settings.reading_goal
    goal.enabled = enabled
    if minutes:
        goal.minutes = max(1, min(600, int(minutes)))
    if days:
        goal.days = sorted({d for d in days if 0 <= d <= 6})
    stats_routes.put_settings(stats_routes.ReaderSettings(reading_goal=goal), reader=ctx.reader, db=ctx.db)
    return {"reading_goal": goal.model_dump()}


def mark_known(ctx: Context, words: list[str], language: str) -> dict:
    for w in words[:100]:
        ctx.db.execute(text("""INSERT INTO known_words (reader_email, language, word) VALUES (:e, :l, :w)
                               ON CONFLICT DO NOTHING"""), {"e": ctx.reader.email, "l": language, "w": w.strip().lower()})
        ctx.db.execute(text("""UPDATE review_cards SET deleted = true, client_updated_at = now(), updated_at = clock_timestamp()
                               WHERE reader_email = :e AND language = :l AND lower(term) = :w AND NOT deleted"""),
                       {"e": ctx.reader.email, "l": language, "w": w.strip().lower()})
    ctx.db.commit()
    return {"marked_known": len(words[:100])}


def add_review_cards(ctx: Context, language: str, words: list[str] | None = None, repeated: bool = False) -> dict:
    """Cards for the given words, or for the words looked up repeatedly. The device schedules them (FSRS)."""
    import uuid

    terms = [w.strip() for w in (words or []) if w.strip()]
    if repeated:
        terms += [r["word"] for r in _stats(ctx, "all")["repeated"] if r["language"] == language]
    added = 0
    for term in dict.fromkeys(terms):
        exists = ctx.db.execute(text("""SELECT 1 FROM review_cards WHERE reader_email = :e AND language = :l
                                        AND lower(term) = lower(:t) AND NOT deleted"""),
                                {"e": ctx.reader.email, "l": language, "t": term}).fetchone()
        if exists:
            continue
        context = ctx.db.execute(text("""SELECT context FROM lookups WHERE reader_email = :e AND language = :l
                                         AND (lower(word) = lower(:t) OR lower(matched) = lower(:t)) AND context <> ''
                                         ORDER BY created_at DESC LIMIT 1"""),
                                 {"e": ctx.reader.email, "l": language, "t": term}).scalar() or ""
        ctx.db.execute(text("""INSERT INTO review_cards (id, reader_email, language, term, example, source, client_updated_at)
                               VALUES (:id, :e, :l, :t, :x, 'manual', now())"""),
                       {"id": f"card-{uuid.uuid4()}", "e": ctx.reader.email, "l": language, "t": term, "x": context[:500]})
        added += 1
    ctx.db.commit()
    return {"added": added, "skipped_existing": len(dict.fromkeys(terms)) - added}


BOOK = {"type": "string", "description": "a book's id or (part of) its title"}
PERIOD = {"type": "string", "enum": ["week", "month", "year", "all"]}
LANGUAGE = {"type": "string", "description": "ISO 639-1 code, e.g. de"}


def _obj(props: dict, required: list[str] | None = None) -> dict:
    return {"type": "object", "properties": props, "required": required or []}


TOOLS = {t.name: t for t in [
    Tool("list_books", "Books in the (shared) library with their category (e.g. 'Literature > Science fiction > "
         "Space opera'), the reader's own shelf status (reading, finished, removed, not started), language, formats, "
         "size, whether searchable, reading progress. `category`: only books in categories whose path contains it "
         "(e.g. 'Academic', 'Science fiction').",
         _obj({"category": {"type": "string"}}), list_books),
    Tool("book_details", "One book: progress, time spent, reading speed, time left, lookups, highlights.",
         _obj({"book": BOOK}, ["book"]), book_details),
    Tool("search_passages", "Find passages in the books (meaning and words). Use for any question about a book's "
         "content. Cite the passages it returns as [n].", _obj({"query": {"type": "string"}, "book": BOOK}, ["query"]),
         search_passages),
    Tool("reading_stats", "Reading time, words read, today, streak, goal, per day/week, per book (speed, time left).",
         _obj({"period": PERIOD, "book": BOOK}), reading_stats),
    Tool("lookup_stats", "Dictionary lookups: per language, lookups per 1000 words (a difficulty measure; falling = "
         "improving), words looked up repeatedly, words not found, known words, review cards due.",
         _obj({"period": PERIOD, "language": LANGUAGE}), lookup_stats),
    Tool("translations", "Saved translations of passages (newest first), optionally filtered by words or book.",
         _obj({"query": {"type": "string"}, "book": BOOK, "limit": {"type": "integer"}}), translations),
    Tool("book_opinions", "What the readers' community thinks of a book: average score 0-10, how many recommend it, "
         "their reviews and discussion posts. Use for 'what did my friends think of …'.",
         _obj({"book": BOOK}, ["book"]), book_opinions),
    Tool("member_lists", "The readers' top lists of favourite books (all, or one reader's by handle or name).",
         _obj({"handle": {"type": "string"}}), member_lists),
    Tool("highlights", "The reader's highlights, notes and bookmarks.", _obj({"book": BOOK}), highlights),
    Tool("vocabulary_due", "Review cards (spaced repetition): how many, which are due.", _obj({"language": LANGUAGE}),
         vocabulary_due),
    Tool("ai_usage", "The reader's own AI use (Groq tokens): calls and tokens in/out per purpose (translate, define, "
         "chat, chat_title, search, ask) and per day.", _obj({"period": PERIOD}), ai_usage),
    Tool("reading_goal", "The daily reading goal setting (on/off, minutes, days 0=Monday).", _obj({}), reading_goal),
    Tool("open_book_at", "Offer a button that opens a book: at a percentage, or at a found passage (source number).",
         _obj({"book": BOOK, "percent": {"type": "number"}, "source": {"type": "integer"}}, ["book"]), open_book_at),
    Tool("export_anki", "Offer a download of the vocabulary as an Anki deck (all, or one book).", _obj({"book": BOOK}),
         export_anki),
    Tool("set_reading_goal", "Turn the daily reading goal on or off, or change its minutes or days (0=Monday). "
         "Runs after the reader confirms.", _obj({"enabled": {"type": "boolean"}, "minutes": {"type": "integer"},
                                                  "days": {"type": "array", "items": {"type": "integer"}}}, ["enabled"]),
         set_reading_goal, changes=True,
         label=lambda a: (f"Turn the reading goal on: {a.get('minutes') or 'same'} min a day" if a.get("enabled")
                          else "Turn the reading goal off")),
    Tool("mark_known", "Mark words as known (they leave review and the repeated-words list). Runs after the reader "
         "confirms.", _obj({"words": {"type": "array", "items": {"type": "string"}}, "language": LANGUAGE},
                           ["words", "language"]), mark_known, changes=True,
         label=lambda a: f"Mark as known: {', '.join(a.get('words', [])[:8])}"),
    Tool("add_review_cards", "Add review cards for words, or for the words looked up repeatedly (repeated=true). "
         "Runs after the reader confirms.", _obj({"language": LANGUAGE, "words": {"type": "array", "items": {"type": "string"}},
                                                  "repeated": {"type": "boolean"}}, ["language"]),
         add_review_cards, changes=True,
         label=lambda a: ("Add review cards for the words you keep looking up" if a.get("repeated")
                          else f"Add review cards: {', '.join(a.get('words', [])[:8])}")),
]}


def run(ctx: Context, name: str, raw_args: str | dict) -> Any:
    tool = TOOLS.get(name)
    if tool is None:
        return {"error": f"No tool {name!r}"}
    try:
        args = json.loads(raw_args) if isinstance(raw_args, str) else dict(raw_args or {})
    except json.JSONDecodeError:
        return {"error": "Arguments must be JSON"}
    try:
        return tool.run(ctx, **args)
    except TypeError as e:
        return {"error": f"Bad arguments: {e}"}
