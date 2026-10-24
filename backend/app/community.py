"""What readers share with each other: profiles, reviews, posts (linked to books, with quotes), comments, likes
and top lists. Everyone signed in sees everything, except what an admin hid. Other readers are only ever shown
by their profile (handle, name, avatar), never by email."""

import re
import secrets
import unicodedata

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import Reader

HANDLE = re.compile(r"[a-z0-9_]{3,20}")
LIKE_TARGETS = {"post": "posts", "comment": "comments", "review": "reviews"}


# --- profiles ---

def generated_handle(email: str) -> str:
    """Same as migration 0012: the part before the @, plus 4 characters so two readers never clash."""
    local = re.sub(r"[^a-z0-9_]", "_", email.split("@")[0].lower())[:14]
    return f"{local}_{secrets.token_hex(2)}"


def ensure_profile(db: Session, reader: Reader) -> None:
    """Readers added after the migration get their profile the first time they use the community."""
    if db.execute(text("SELECT 1 FROM profiles WHERE reader_email = :e"), {"e": reader.email}).fetchone():
        return
    db.execute(text("""INSERT INTO profiles (reader_email, handle, display_name) VALUES (:e, :h, :n)
                       ON CONFLICT DO NOTHING"""),
               {"e": reader.email, "h": generated_handle(reader.email), "n": reader.name})
    db.commit()


def normalize_handle(handle: str) -> str:
    handle = unicodedata.normalize("NFKD", handle).encode("ascii", "ignore").decode().lower().strip()
    if not HANDLE.fullmatch(handle):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "A handle is 3–20 letters, digits or underscores")
    return handle


def author(row, prefix: str = "") -> dict:
    """The public face of a reader, from the columns AUTHOR_COLS selected (with the same prefix)."""
    key = getattr(row, f"{prefix}avatar_key")
    return {"handle": getattr(row, f"{prefix}handle"), "display_name": getattr(row, f"{prefix}display_name"),
            "avatar_url": f"/api/avatars/{key}.jpg" if key else None}


def author_cols(alias: str, prefix: str = "") -> str:
    return f"{alias}.handle AS {prefix}handle, {alias}.display_name AS {prefix}display_name, {alias}.avatar_key AS {prefix}avatar_key"


def email_for(db: Session, handle: str) -> str:
    email = db.execute(text("SELECT reader_email FROM profiles WHERE handle = :h"), {"h": handle.lower()}).scalar()
    if email is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such reader")
    return email


# --- books, as posts and lists refer to them (a book may have been deleted since) ---

def book_stubs(db: Session, ids: list[str]) -> dict[str, dict]:
    found = {r.id: {"id": r.id, "title": r.title, "author": r.author, "available": True}
             for r in db.execute(text("SELECT id, title, author FROM books WHERE id = ANY(:ids)"), {"ids": list(ids)})}
    return {i: found.get(i, {"id": i, "title": "", "author": "", "available": False}) for i in ids}


def check_books(db: Session, ids: list[str]) -> None:
    missing = set(ids) - {r.id for r in db.execute(text("SELECT id FROM books WHERE id = ANY(:ids)"), {"ids": list(ids)})}
    if missing:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No such book: {', '.join(sorted(missing))}")


# --- likes ---

def like_counts(db: Session, reader: Reader, target_type: str, ids: list) -> dict[str, tuple[int, bool]]:
    rows = db.execute(text("""SELECT target_id, count(*) AS n, bool_or(reader_email = :e) AS mine FROM likes
                              WHERE target_type = :t AND target_id = ANY(CAST(:ids AS uuid[])) GROUP BY target_id"""),
                      {"t": target_type, "ids": [str(i) for i in ids], "e": reader.email})
    return {str(r.target_id): (r.n, r.mine) for r in rows}


def with_likes(item: dict, counts: dict) -> dict:
    n, mine = counts.get(str(item["id"]), (0, False))
    return {**item, "likes": n, "liked_by_me": mine}


def set_like(db: Session, reader: Reader, target_type: str, target_id: str, on: bool) -> None:
    table = LIKE_TARGETS.get(target_type)
    if table is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown kind")
    if db.execute(text(f"SELECT 1 FROM {table} WHERE id = CAST(:id AS uuid)"), {"id": target_id}).fetchone() is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    if on:
        db.execute(text("""INSERT INTO likes (target_type, target_id, reader_email) VALUES (:t, CAST(:id AS uuid), :e)
                           ON CONFLICT DO NOTHING"""), {"t": target_type, "id": target_id, "e": reader.email})
    else:
        db.execute(text("DELETE FROM likes WHERE target_type = :t AND target_id = CAST(:id AS uuid) AND reader_email = :e"),
                   {"t": target_type, "id": target_id, "e": reader.email})
    db.commit()


# --- reviews ---

def reviews(db: Session, reader: Reader, book_id: str | None = None, author_email: str | None = None,
            limit: int = 200) -> list[dict]:
    rows = db.execute(text(f"""
        SELECT r.id, r.book_id, r.score, r.recommend, r.body, r.spoiler, r.hidden_by_admin, r.created_at, r.updated_at,
               r.reader_email = :e AS mine, {author_cols('p')}
        FROM reviews r JOIN profiles p ON p.reader_email = r.reader_email
        WHERE (CAST(:b AS text) IS NULL OR r.book_id = :b) AND (CAST(:a AS text) IS NULL OR r.reader_email = :a)
          AND (NOT r.hidden_by_admin OR :admin)
        ORDER BY r.updated_at DESC LIMIT :n"""),
                      {"e": reader.email, "b": book_id, "a": author_email, "admin": reader.is_admin, "n": limit}).fetchall()
    counts = like_counts(db, reader, "review", [r.id for r in rows])
    books = book_stubs(db, list({r.book_id for r in rows}))
    return [with_likes({"id": str(r.id), "book": books[r.book_id], "score": r.score, "recommend": r.recommend,
                        "body": r.body, "spoiler": r.spoiler, "hidden": r.hidden_by_admin, "mine": r.mine,
                        "created_at": r.created_at.isoformat(), "updated_at": r.updated_at.isoformat(),
                        "author": author(r)}, counts) for r in rows]


def rating_summary(db: Session, book_ids: list[str] | None = None) -> dict[str, dict]:
    rows = db.execute(text("""
        SELECT book_id, round(avg(score)::numeric, 1) AS avg, count(*) AS n, count(*) FILTER (WHERE recommend) AS rec
        FROM reviews WHERE NOT hidden_by_admin AND (CAST(:ids AS text[]) IS NULL OR book_id = ANY(:ids))
        GROUP BY book_id"""), {"ids": book_ids})
    return {r.book_id: {"avg_score": float(r.avg), "review_count": r.n, "recommend_count": r.rec} for r in rows}


# --- posts ---

def _post_rows(db: Session, reader: Reader, where: str, params: dict, limit: int):
    return db.execute(text(f"""
        SELECT x.id, x.title, x.body, x.edited, x.hidden_by_admin, x.created_at, x.updated_at,
               x.author_email = :e AS mine, {author_cols('p')},
               (SELECT count(*) FROM comments c WHERE c.post_id = x.id AND NOT c.deleted
                   AND (NOT c.hidden_by_admin OR :admin)) AS comment_count,
               coalesce((SELECT array_agg(book_id ORDER BY book_id) FROM post_books pb WHERE pb.post_id = x.id), '{{}}') AS book_ids
        FROM posts x JOIN profiles p ON p.reader_email = x.author_email
        WHERE (NOT x.hidden_by_admin OR :admin) {where}
        ORDER BY x.created_at DESC LIMIT :n"""), {"e": reader.email, "admin": reader.is_admin, "n": limit, **params}).fetchall()


def _post(r, books: dict, counts: dict, full: bool) -> dict:
    body = r.body if full else (r.body[:400] + ("…" if len(r.body) > 400 else ""))
    return with_likes({"id": str(r.id), "title": r.title, "body": body, "edited": r.edited, "hidden": r.hidden_by_admin,
                       "mine": r.mine, "created_at": r.created_at.isoformat(), "updated_at": r.updated_at.isoformat(),
                       "author": author(r), "comment_count": r.comment_count,
                       "books": [books[b] for b in r.book_ids]}, counts)


def list_posts(db: Session, reader: Reader, book_id: str | None = None, author_email: str | None = None,
               book_ids: list[str] | None = None, before: str | None = None, limit: int = 30) -> list[dict]:
    where, params = "", {}
    if book_id:
        where += " AND EXISTS (SELECT 1 FROM post_books pb WHERE pb.post_id = x.id AND pb.book_id = :b)"
        params["b"] = book_id
    if book_ids is not None:
        where += " AND EXISTS (SELECT 1 FROM post_books pb WHERE pb.post_id = x.id AND pb.book_id = ANY(:bs))"
        params["bs"] = book_ids
    if author_email:
        where += " AND x.author_email = :a"
        params["a"] = author_email
    if before:
        where += " AND x.created_at < CAST(:before AS timestamptz)"
        params["before"] = before
    rows = _post_rows(db, reader, where, params, limit)
    books = book_stubs(db, list({b for r in rows for b in r.book_ids}))
    counts = like_counts(db, reader, "post", [r.id for r in rows])
    return [_post(r, books, counts, full=False) for r in rows]


def get_post(db: Session, reader: Reader, post_id: str) -> dict:
    rows = _post_rows(db, reader, "AND x.id = CAST(:id AS uuid)", {"id": post_id}, 1)
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such post")
    r = rows[0]
    quotes = db.execute(text("""SELECT position, book_id, text, format, location, progress FROM post_quotes
                                WHERE post_id = CAST(:id AS uuid) ORDER BY position"""), {"id": post_id}).fetchall()
    books = book_stubs(db, list(set(r.book_ids) | {q.book_id for q in quotes}))
    post = _post(r, books, like_counts(db, reader, "post", [r.id]), full=True)
    post["quotes"] = [{"book": books[q.book_id], "text": q.text, "format": q.format, "location": q.location,
                       "progress": q.progress} for q in quotes]
    post["comments"] = comments(db, reader, post_id)
    return post


def own(db: Session, reader: Reader, table: str, owner_col: str, item_id: str, admin_may: bool = True):
    row = db.execute(text(f"SELECT {owner_col} AS owner FROM {table} WHERE id = CAST(:id AS uuid)"), {"id": item_id}).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    if row.owner != reader.email and not (admin_may and reader.is_admin):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the author can change this")


def save_post_parts(db: Session, post_id: str, book_ids: list[str], quotes: list[dict]) -> None:
    check_books(db, list(set(book_ids) | {q["book_id"] for q in quotes}))
    db.execute(text("DELETE FROM post_books WHERE post_id = CAST(:id AS uuid)"), {"id": post_id})
    db.execute(text("DELETE FROM post_quotes WHERE post_id = CAST(:id AS uuid)"), {"id": post_id})
    # a quoted book counts as one the post is about
    for b in sorted(set(book_ids) | {q["book_id"] for q in quotes}):
        db.execute(text("INSERT INTO post_books (post_id, book_id) VALUES (CAST(:id AS uuid), :b)"), {"id": post_id, "b": b})
    for i, q in enumerate(quotes):
        db.execute(text("""INSERT INTO post_quotes (post_id, position, book_id, text, format, location, progress)
                           VALUES (CAST(:id AS uuid), :i, :b, :t, :f, :l, :p)"""),
                   {"id": post_id, "i": i, "b": q["book_id"], "t": q["text"], "f": q["format"],
                    "l": q["location"], "p": q["progress"]})


# --- comments ---

def comments(db: Session, reader: Reader, post_id: str) -> list[dict]:
    rows = db.execute(text(f"""
        SELECT c.id, c.parent_id, c.body, c.spoiler, c.edited, c.deleted, c.hidden_by_admin, c.created_at,
               c.author_email = :e AS mine, {author_cols('p')}
        FROM comments c JOIN profiles p ON p.reader_email = c.author_email
        WHERE c.post_id = CAST(:id AS uuid) ORDER BY c.created_at"""), {"e": reader.email, "id": post_id}).fetchall()
    counts = like_counts(db, reader, "comment", [r.id for r in rows])
    out = []
    for r in rows:
        gone = r.deleted or (r.hidden_by_admin and not reader.is_admin)
        out.append(with_likes({
            "id": str(r.id), "parent_id": str(r.parent_id) if r.parent_id else None,
            "body": "" if gone else r.body, "spoiler": r.spoiler, "edited": r.edited, "deleted": r.deleted,
            "hidden": r.hidden_by_admin, "mine": r.mine and not r.deleted, "created_at": r.created_at.isoformat(),
            "author": None if gone else author(r)}, counts))
    return out


# --- lists ---

def lists(db: Session, reader: Reader, owner_email: str | None = None, list_id: str | None = None) -> list[dict]:
    rows = db.execute(text(f"""
        SELECT l.id, l.title, l.description, l.hidden_by_admin, l.created_at, l.updated_at, l.owner_email = :e AS mine,
               {author_cols('p')}
        FROM lists l JOIN profiles p ON p.reader_email = l.owner_email
        WHERE (NOT l.hidden_by_admin OR :admin) AND (CAST(:o AS text) IS NULL OR l.owner_email = :o)
          AND (CAST(:id AS uuid) IS NULL OR l.id = CAST(:id AS uuid))
        ORDER BY l.updated_at DESC"""),
                      {"e": reader.email, "admin": reader.is_admin, "o": owner_email, "id": list_id}).fetchall()
    items = db.execute(text("""SELECT list_id, rank, book_id, note FROM list_items WHERE list_id = ANY(:ids)
                               ORDER BY list_id, rank"""), {"ids": [r.id for r in rows]}).fetchall()
    books = book_stubs(db, list({i.book_id for i in items}))
    by_list: dict[str, list] = {}
    for i in items:
        by_list.setdefault(str(i.list_id), []).append({"book": books[i.book_id], "note": i.note})
    return [{"id": str(r.id), "title": r.title, "description": r.description, "hidden": r.hidden_by_admin,
             "mine": r.mine, "created_at": r.created_at.isoformat(), "updated_at": r.updated_at.isoformat(),
             "author": author(r), "items": by_list.get(str(r.id), [])} for r in rows]


def save_list_items(db: Session, list_id: str, items: list[dict]) -> None:
    check_books(db, [i["book_id"] for i in items])
    if len({i["book_id"] for i in items}) != len(items):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "A book can be in a list only once")
    db.execute(text("DELETE FROM list_items WHERE list_id = CAST(:id AS uuid)"), {"id": list_id})
    for rank, i in enumerate(items):
        db.execute(text("""INSERT INTO list_items (list_id, rank, book_id, note) VALUES (CAST(:id AS uuid), :r, :b, :n)"""),
                   {"id": list_id, "r": rank, "b": i["book_id"], "n": i["note"]})


# --- moderation ---

HIDEABLE = {"post": "posts", "comment": "comments", "review": "reviews", "list": "lists"}


def set_hidden(db: Session, kind: str, item_id: str, hidden: bool) -> None:
    table = HIDEABLE.get(kind)
    if table is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown kind")
    if db.execute(text(f"UPDATE {table} SET hidden_by_admin = :h WHERE id = CAST(:id AS uuid)"),
                  {"h": hidden, "id": item_id}).rowcount == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    db.commit()
