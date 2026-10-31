"""The tools as the model sees them (names, descriptions, parameters), and running one."""

import inspect
import json
import logging
from typing import Any

from app.agent.changes import add_review_cards, mark_known, set_reading_goal
from app.agent.community import book_opinions, community_posts, member_lists, my_reviews, read_post
from app.agent.library import book_details, export_anki, highlights, list_books, my_shelf, open_book_at, search_passages, translations
from app.agent.notes import append_to_note, list_notes, read_note, save_note, send_to_computer
from app.agent.registry import Context, Tool
from app.agent.stats import ai_usage, lookup_stats, reading_goal, reading_stats, vocabulary_due

logger = logging.getLogger(__name__)


BOOK = {"type": "string", "description": "a book's id or (part of) its title"}

PERIOD = {"type": "string", "enum": ["week", "month", "year", "all"]}

LANGUAGE = {"type": "string", "description": "ISO 639-1 code, e.g. de"}

PROJECT = {"type": "string", "description": "the name of one of the reader's projects on their study computer"}

def _obj(props: dict, required: list[str] | None = None) -> dict:
    return {"type": "object", "properties": props, "required": required or []}

TOOLS = {t.name: t for t in [
    Tool("list_books", "Books in the (shared) library with their category (e.g. 'Literature > Science fiction > "
         "Space opera'), the reader's own shelf status (reading, finished, removed, not started), whether it's on "
         "\"My shelf\" (books the reader picked to keep in sight, read or not) and in which of their collections, language, formats, "
         "size, whether searchable, reading progress. `category`: only books in categories whose path contains it "
         "(e.g. 'Academic', 'Science fiction').",
         _obj({"category": {"type": "string"}}), list_books, shown_as="library"),
    Tool("book_details", "One book: progress, time spent, reading speed, time left, lookups, highlights.",
         _obj({"book": BOOK}, ["book"]), book_details, shown_as="book details"),
    Tool("search_passages", "Find passages in the books (meaning and words). Use for any question about a book's "
         "content. Cite the passages it returns as [n].", _obj({"query": {"type": "string"}, "book": BOOK}, ["query"]),
         search_passages, shown_as="searched the books"),
    Tool("reading_stats", "Reading time, words read, today, streak, goal, per day/week, per book (speed, time left).",
         _obj({"period": PERIOD, "book": BOOK}), reading_stats, shown_as="reading statistics"),
    Tool("lookup_stats", "Dictionary lookups: per language, lookups per 1000 words (a difficulty measure; falling = "
         "improving), words looked up repeatedly, words not found, known words, review cards due.",
         _obj({"period": PERIOD, "language": LANGUAGE}), lookup_stats, shown_as="lookup statistics"),
    Tool("translations", "Saved translations of passages (newest first), optionally filtered by words or book.",
         _obj({"query": {"type": "string"}, "book": BOOK, "limit": {"type": "integer"}}), translations, shown_as="translations"),
    Tool("book_opinions", "What the readers' community thinks of a book: average score 0-10, how many recommend it, "
         "their reviews and discussion posts. Use for 'what did my friends think of …'.",
         _obj({"book": BOOK}, ["book"]), book_opinions),
    Tool("member_lists", "The readers' top lists of favourite books (all, or one reader's by handle or name).",
         _obj({"handle": {"type": "string"}}), member_lists),
    Tool("highlights", "The reader's highlights, notes and bookmarks.", _obj({"book": BOOK}), highlights, shown_as="highlights"),
    Tool("vocabulary_due", "Review cards (spaced repetition): how many, which are due.", _obj({"language": LANGUAGE}),
         vocabulary_due, shown_as="review cards"),
    Tool("ai_usage", "The reader's own AI use (tokens): calls and tokens in/out per purpose (translate, define, "
         "chat, chat_title, search, ask) and per day.", _obj({"period": PERIOD}), ai_usage, shown_as="AI usage"),
    Tool("reading_goal", "The daily reading goal setting (on/off, minutes, days 0=Monday).", _obj({}), reading_goal,
         shown_as="reading goal"),
    Tool("open_book_at", "Offer a button that opens a book: at a percentage, or at a found passage (source number).",
         _obj({"book": BOOK, "percent": {"type": "number"}, "source": {"type": "integer"}}, ["book"]), open_book_at, shown_as="book link"),
    Tool("export_anki", "Offer a download of the vocabulary as an Anki deck (all, or one book).", _obj({"book": BOOK}),
         export_anki, shown_as="Anki export"),
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
    Tool("my_shelf", "The reader's own My shelf: their collections with the books in each (and those in none), "
         "with reading status and progress. Use for 'what's in my Uni collection', 'what should I read next'.",
         _obj({}), my_shelf, shown_as="My shelf"),
    Tool("community_posts", "Recent community posts with their text (shortened), books, comments and likes. `book`: "
         "only about that book; `author`: a reader's handle or name; `mine`: the reader's own posts.",
         _obj({"book": BOOK, "author": {"type": "string"}, "mine": {"type": "boolean"}}), community_posts, shown_as="community"),
    Tool("read_post", "One community post in full with its quotes and comments. `post`: an id from community_posts or "
         "(part of) its title.", _obj({"post": {"type": "string"}}, ["post"]), read_post, shown_as="community"),
    Tool("my_reviews", "The reader's own reviews (book, score 0–10, recommend, text).", _obj({}), my_reviews, shown_as="reviews"),
    Tool("list_notes", "The reader's notes (id, title, book, project, last change, length), newest first, and the "
         "names of their projects (folders on their study computer). `book` or `project` filters.",
         _obj({"book": BOOK, "project": PROJECT}), list_notes, shown_as="notes"),
    Tool("read_note", "One of the reader's notes in full (Markdown). `note`: its id or (part of) its title.",
         _obj({"note": {"type": "string"}}, ["note"]), read_note, shown_as="notes"),
    Tool("save_note", "Save a new note for the reader: a summary, outline, study sheet or diagram they asked to "
         "keep. `markdown`: the whole note (## headings, lists, [n] citations of search_passages sources, diagrams "
         "as ```mermaid blocks). `book`: the book it is about, if one. `project`: one of the reader's projects, when "
         "the note belongs to it (its file then lives in that project's folder). Runs after the reader confirms.",
         _obj({"title": {"type": "string"}, "markdown": {"type": "string"}, "book": BOOK, "project": PROJECT},
              ["title", "markdown"]),
         save_note, changes=True, label=lambda a: f"Save note: {a.get('title', '')}", cites_sources=True, preview="markdown"),
    Tool("send_to_computer", "Send text to the reader's study computer: it arrives as a file in their inbox folder "
         "(Markdown, or a source file for code). `kind`: 'snippet' for code (give `language`, e.g. python), 'note' or "
         "'text'. `project`: into that project's inbox instead (list_notes names the projects). `append`: added to the "
         "end of the inbox's running file (journal.md) instead of a new file, when the reader asks for that. Only when "
         "the reader asks. Runs after the reader confirms.",
         _obj({"title": {"type": "string"}, "text": {"type": "string"}, "kind": {"type": "string", "enum": ["text", "snippet", "note"]},
               "language": {"type": "string"}, "project": PROJECT, "append": {"type": "boolean"}}, ["title", "text"]),
         send_to_computer, changes=True,
         label=lambda a: f"Send to your computer{' (' + a['project'] + ')' if a.get('project') else ''}: {a.get('title', '')}",
         preview="text"),
    Tool("append_to_note", "Add a section to the end of one of the reader's notes (find it with list_notes). "
         "`markdown`: only the new part. Runs after the reader confirms.",
         _obj({"note": {"type": "string"}, "markdown": {"type": "string"}}, ["note", "markdown"]),
         append_to_note, changes=True, label=lambda a: f"Add to note: {a.get('note', '')}", cites_sources=True, preview="markdown"),
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
        inspect.signature(tool.run).bind(ctx, **args)
    except TypeError as e:  # a missing or unknown argument; a TypeError inside the tool is a bug, handled below
        return {"error": f"Bad arguments: {e}"}
    try:
        return tool.run(ctx, **args)
    except Exception as e:  # a bad value from the model, a database error: the model is told and can recover
        ctx.db.rollback()
        logger.warning("Tool %s failed: %s", name, e)
        return {"error": getattr(e, "detail", None) or str(e) or type(e).__name__}
