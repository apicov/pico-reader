"""Book categories: a shared tree (up to 3 levels: Literature › Science fiction › Space opera) and each book's
main and second category. The LLM picks them from the start of a book; it may suggest a new category only when
none fits, and only under an existing one (it then waits for an admin's approval, shown as "new")."""

import logging
import re

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import groq_client

logger = logging.getLogger(__name__)
MAX_DEPTH = 3
SAMPLE_CHARS = 4000
SEP = " > "

SYSTEM = """You file books in a library's category tree. You get a book's title, author, language, headings and
its first pages, and the list of category paths (levels separated by " > "). Choose the most specific path that
fits the book as a whole (its genre or field, not the topic of its first pages). Optionally a second path, only
if the book clearly belongs to two places. Only when no existing category fits at all, propose a new one under an
existing first- or second-level category. Answer with JSON only:
{"category": "<an existing path, or null>", "second": "<an existing path, or null>",
 "new": null or {"parent": "<existing path of level 1 or 2>", "name": "<short English name>"},
 "reason": "<one short sentence>", "confidence": <0 to 1>}"""


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower().replace("&", "and")).strip("-")


def _nodes(db: Session) -> dict[int, dict]:
    rows = db.execute(text("SELECT id, parent_id, name, slug, status, position FROM categories ORDER BY position, name"))
    nodes = {r.id: {"id": r.id, "parent_id": r.parent_id, "name": r.name, "slug": r.slug, "status": r.status,
                    "position": r.position} for r in rows}
    for n in nodes.values():
        parts, cur = [], n
        while cur:
            parts.append(cur["name"])
            cur = nodes.get(cur["parent_id"])
        n["path"] = SEP.join(reversed(parts))
        n["depth"] = len(parts)
    return nodes


def tree(db: Session) -> list[dict]:
    """Every category with its path, depth and how many books are in it or below it (main or second)."""
    nodes = _nodes(db)
    direct: dict[int, set] = {}
    for r in db.execute(text("SELECT id, category_id, category2_id FROM books WHERE status = 'ready'")):
        for c in (r.category_id, r.category2_id):
            if c in nodes:
                cur = c
                while cur is not None:  # a book counts for its category and every one above it
                    direct.setdefault(cur, set()).add(r.id)
                    cur = nodes[cur]["parent_id"]
    return [{**n, "books": len(direct.get(n["id"], ()))} for n in nodes.values()]


def find(db: Session, path: str | None) -> dict | None:
    if not path:
        return None
    wanted = SEP.join(p.strip().lower() for p in re.split(r"\s*[>›/]\s*", path.strip()) if p.strip())
    return next((n for n in _nodes(db).values() if n["path"].lower() == wanted), None)


def check(db: Session, category_id: int | None) -> None:
    if category_id is not None and db.execute(text("SELECT 1 FROM categories WHERE id = :id"), {"id": category_id}).fetchone() is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No category {category_id}")


def set_book(db: Session, book_id: str, main: int | None, second: int | None, source: str | None, reason: str = "") -> None:
    if second == main:
        second = None
    db.execute(text("""UPDATE books SET category_id = :m, category2_id = :s, category_source = :src, category_reason = :r
                       WHERE id = :b"""), {"m": main, "s": second, "src": source if main else None, "r": reason, "b": book_id})


def add(db: Session, parent_id: int | None, name: str, status_: str = "approved", by: str | None = None) -> dict:
    name = name.strip()
    nodes = _nodes(db)
    if parent_id is not None and parent_id not in nodes:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such parent")
    depth = nodes[parent_id]["depth"] + 1 if parent_id is not None else 1
    if depth > MAX_DEPTH:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Categories go 3 levels deep at most")
    same = next((n for n in nodes.values() if n["parent_id"] == parent_id and n["name"].lower() == name.lower()), None)
    if same:
        return same
    new_id = db.execute(text("""INSERT INTO categories (parent_id, name, slug, status, suggested_by, position)
                                VALUES (:p, :n, :s, :st, :by, 1000) RETURNING id"""),
                        {"p": parent_id, "n": name, "s": slug(name), "st": status_, "by": by}).scalar()
    return _nodes(db)[new_id]


def merge(db: Session, source_id: int, target_id: int) -> None:
    """Move the books and subcategories of `source` into `target`, then delete it."""
    nodes = _nodes(db)
    if source_id not in nodes or target_id not in nodes:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such category")
    cur = target_id
    while cur is not None:
        if cur == source_id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Can't merge a category into one below it")
        cur = nodes[cur]["parent_id"]
    for col in ("category_id", "category2_id"):
        db.execute(text(f"UPDATE books SET {col} = :t WHERE {col} = :s"), {"t": target_id, "s": source_id})
    for child in [n for n in nodes.values() if n["parent_id"] == source_id]:
        if nodes[target_id]["depth"] + 1 > MAX_DEPTH:  # too deep under the target: its books move up instead
            merge(db, child["id"], target_id)
            continue
        twin = next((n for n in nodes.values() if n["parent_id"] == target_id and n["name"].lower() == child["name"].lower()), None)
        if twin:
            merge(db, child["id"], twin["id"])
        else:
            db.execute(text("UPDATE categories SET parent_id = :t WHERE id = :c"), {"t": target_id, "c": child["id"]})
    db.execute(text("UPDATE books SET category2_id = NULL WHERE category2_id = category_id"))
    db.execute(text("DELETE FROM categories WHERE id = :s"), {"s": source_id})
    db.commit()


# --- the LLM's choice ---

def _sample(db: Session, book_id: str) -> tuple[list[str], str]:
    rows = db.execute(text("SELECT heading, text FROM book_chunks WHERE book_id = :b ORDER BY seq LIMIT 60"), {"b": book_id}).fetchall()
    headings = list(dict.fromkeys(r.heading for r in rows if r.heading))[:30]
    sample, total = [], 0
    for r in rows:
        if total >= SAMPLE_CHARS:
            break
        sample.append(r.text[:SAMPLE_CHARS - total])
        total += len(sample[-1])
    return headings, "\n\n".join(sample)


def _who(db: Session, uploaded_by: str | None) -> tuple[str, str] | None:
    """Whose AI use this is: the uploader, or (books from before uploads were recorded) the first admin."""
    email = uploaded_by or db.execute(text("SELECT email FROM readers WHERE is_admin ORDER BY created_at LIMIT 1")).scalar()
    return (email, "categorize") if email else None


def classify(db: Session, book_id: str, force: bool = False) -> dict | None:
    """Ask the LLM for the book's categories and save them. Never overwrites a reader's choice; with
    force=False only books without a category. Returns what was saved, None when nothing was."""
    book = db.execute(text("SELECT id, title, author, language, uploaded_by, category_id, category_source FROM books WHERE id = :b"),
                      {"b": book_id}).fetchone()
    if book is None or book.category_source == "reader" or (book.category_id and not force):
        return None
    headings, sample = _sample(db, book_id)
    nodes = _nodes(db)
    paths = "\n".join(n["path"] + (" (new)" if n["status"] == "suggested" else "") for n in nodes.values())
    user = (f"Title: {book.title}\nAuthor: {book.author or 'unknown'}\nLanguage: {book.language}\n"
            f"Headings: {'; '.join(headings) or 'none'}\n\nFirst pages:\n{sample or '(no text)'}\n\nCategories:\n{paths}")
    reply, _ = groq_client.chat_json(SYSTEM, user, max_tokens=600, who=_who(db, book.uploaded_by))
    main, second = find(db, reply.get("category")), find(db, reply.get("second"))
    new = reply.get("new")
    if main is None and isinstance(new, dict) and str(new.get("name") or "").strip():
        parent = find(db, new.get("parent"))
        if parent is not None and parent["depth"] < MAX_DEPTH:
            main = add(db, parent["id"], str(new["name"])[:60], "suggested", "llm")
        else:
            logger.info("Category for %s: rejected new %r", book_id, new)
    if main is None:
        logger.info("Category for %s: no usable answer %r", book_id, reply)
        return None
    reason = str(reply.get("reason") or "")[:300]
    set_book(db, book_id, main["id"], second["id"] if second else None, "llm", reason)
    db.commit()
    return {"category": main["path"], "second": second["path"] if second else None, "reason": reason}


def classify_quietly(db: Session, book_id: str) -> None:
    """After indexing: a failure here must not fail the job."""
    try:
        result = classify(db, book_id)
        if result:
            logger.info("Category for %s: %s", book_id, result["category"])
    except Exception:
        db.rollback()
        logger.exception("Categorizing %s failed", book_id)
