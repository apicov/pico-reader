"""The community: profiles, reviews, posts, comments, likes and top lists (queries in app/community.py).
Every signed-in reader sees everything; only the author changes their things, admins may delete and hide."""

import base64
import secrets
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import community as c
from app.auth import Reader, get_current_admin, get_current_reader
from app.db import get_db

router = APIRouter(prefix="/api", tags=["community"])

AVATAR_MAX_BYTES = 150_000


def get_member(reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)) -> Reader:
    c.ensure_profile(db, reader)
    return reader


# --- profiles ---

class ProfileIn(BaseModel):
    handle: str
    display_name: str = Field(max_length=60)
    bio: str = Field(default="", max_length=1000)
    show_reading: bool = True


class AvatarIn(BaseModel):
    jpeg_base64: str | None  # None removes the avatar


def _me(db: Session, reader: Reader) -> dict:
    r = db.execute(text("""SELECT handle, display_name, bio, show_reading, chosen, avatar_key FROM profiles
                           WHERE reader_email = :e"""), {"e": reader.email}).fetchone()
    return {**c.author(r), "bio": r.bio, "show_reading": r.show_reading, "chosen": r.chosen}


@router.get("/profiles/me")
def my_profile(reader: Reader = Depends(get_member), db: Session = Depends(get_db)):
    return _me(db, reader)


@router.put("/profiles/me")
def save_profile(body: ProfileIn, reader: Reader = Depends(get_member), db: Session = Depends(get_db)):
    handle = c.normalize_handle(body.handle)
    taken = db.execute(text("SELECT 1 FROM profiles WHERE handle = :h AND reader_email <> :e"),
                       {"h": handle, "e": reader.email}).fetchone()
    if taken:
        raise HTTPException(status.HTTP_409_CONFLICT, "That handle is taken")
    db.execute(text("""UPDATE profiles SET handle = :h, display_name = :n, bio = :b, show_reading = :s, chosen = true
                       WHERE reader_email = :e"""),
               {"h": handle, "n": body.display_name.strip() or handle, "b": body.bio, "s": body.show_reading,
                "e": reader.email})
    db.commit()
    return _me(db, reader)


@router.put("/profiles/me/avatar")
def save_avatar(body: AvatarIn, reader: Reader = Depends(get_member), db: Session = Depends(get_db)):
    """A small JPEG made on the device; a new key each time so caches never show the old one."""
    data, key = None, None
    if body.jpeg_base64:
        try:
            data = base64.b64decode(body.jpeg_base64, validate=True)
        except ValueError:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Not base64")
        if not data.startswith(b"\xff\xd8") or len(data) > AVATAR_MAX_BYTES:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The avatar must be a JPEG under 150 KB")
        key = secrets.token_urlsafe(16)
    db.execute(text("UPDATE profiles SET avatar = :d, avatar_key = :k WHERE reader_email = :e"),
               {"d": data, "k": key, "e": reader.email})
    db.commit()
    return _me(db, reader)


@router.get("/avatars/{key}.jpg")
def avatar(key: str, db: Session = Depends(get_db)):
    """No sign-in, so <img> can load it: the key is random and changes with every new picture."""
    data = db.execute(text("SELECT avatar FROM profiles WHERE avatar_key = :k"), {"k": key}).scalar()
    if data is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return Response(bytes(data), media_type="image/jpeg",
                    headers={"Cache-Control": "public, max-age=31536000, immutable"})


@router.get("/profiles/{handle}")
def profile(handle: str, reader: Reader = Depends(get_member), db: Session = Depends(get_db)):
    email = c.email_for(db, handle)
    r = db.execute(text("SELECT handle, display_name, bio, show_reading, avatar_key FROM profiles WHERE reader_email = :e"),
                   {"e": email}).fetchone()
    shelf = db.execute(text("""SELECT book_id, status FROM shelf WHERE reader_email = :e AND status <> 'removed'
                               ORDER BY updated_at DESC"""), {"e": email}).fetchall()
    reading = [s.book_id for s in shelf if s.status == "reading"] if r.show_reading else []
    books = c.book_stubs(db, reading)
    return {**c.author(r), "bio": r.bio, "mine": email == reader.email,
            "finished_count": sum(1 for s in shelf if s.status == "finished"),
            "reading": [books[b] for b in reading if books[b]["available"]],
            "reviews": c.reviews(db, reader, author_email=email),
            "posts": c.list_posts(db, reader, author_email=email, limit=100),
            "lists": c.lists(db, reader, owner_email=email)}


@router.get("/members")
def members(reader: Reader = Depends(get_member), db: Session = Depends(get_db)):
    rows = db.execute(text(f"SELECT {c.author_cols('p')} FROM profiles p ORDER BY lower(p.display_name)")).fetchall()
    return [c.author(r) for r in rows]


# --- reviews and a book's page ---

class ReviewIn(BaseModel):
    score: int = Field(ge=0, le=10)
    recommend: bool = False
    body: str = Field(default="", max_length=20_000)
    spoiler: bool = False


@router.get("/books/{book_id}/community")
def book_community(book_id: str, reader: Reader = Depends(get_member), db: Session = Depends(get_db)):
    reviews = c.reviews(db, reader, book_id=book_id)
    return {"book": c.book_stubs(db, [book_id])[book_id],
            "summary": c.rating_summary(db, [book_id]).get(book_id, {"avg_score": None, "review_count": 0,
                                                                      "recommend_count": 0}),
            "my_review": next((r for r in reviews if r["mine"]), None),
            "reviews": reviews,
            "posts": c.list_posts(db, reader, book_id=book_id, limit=100)}


@router.put("/books/{book_id}/review")
def save_review(book_id: str, body: ReviewIn, reader: Reader = Depends(get_member), db: Session = Depends(get_db)):
    c.check_books(db, [book_id])
    db.execute(text("""
        INSERT INTO reviews (book_id, reader_email, score, recommend, body, spoiler) VALUES (:b, :e, :s, :r, :t, :sp)
        ON CONFLICT (book_id, reader_email) DO UPDATE SET score = EXCLUDED.score, recommend = EXCLUDED.recommend,
            body = EXCLUDED.body, spoiler = EXCLUDED.spoiler, updated_at = now()"""),
               {"b": book_id, "e": reader.email, "s": body.score, "r": body.recommend, "t": body.body.strip(),
                "sp": body.spoiler})
    db.commit()
    return next(r for r in c.reviews(db, reader, book_id=book_id) if r["mine"])


@router.delete("/books/{book_id}/review", status_code=204)
def delete_review(book_id: str, reader: Reader = Depends(get_member), db: Session = Depends(get_db)):
    db.execute(text("DELETE FROM reviews WHERE book_id = :b AND reader_email = :e"), {"b": book_id, "e": reader.email})
    db.commit()


@router.get("/ratings")
def ratings(reader: Reader = Depends(get_member), db: Session = Depends(get_db)):
    """Every book's average, for the library cards."""
    return c.rating_summary(db)


# --- posts ---

class QuoteIn(BaseModel):
    book_id: str
    text: str = Field(min_length=1, max_length=3000)
    format: Literal["reflow", "epub", "pdf"]
    location: str = Field(default="", max_length=2000)
    progress: float = Field(default=0, ge=0, le=1)


class PostIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(default="", max_length=20_000)
    book_ids: list[str] = Field(default=[], max_length=20)
    quotes: list[QuoteIn] = Field(default=[], max_length=10)


@router.get("/posts")
def posts(book: str | None = None, author: str | None = None, mine_books: bool = False,
          before: str | None = None, limit: int = Query(30, ge=1, le=100),
          reader: Reader = Depends(get_member), db: Session = Depends(get_db)):
    """mine_books: only posts about books on the reader's shelf (reading or finished)."""
    book_ids = None
    if mine_books:
        book_ids = [r.book_id for r in db.execute(text(
            "SELECT book_id FROM shelf WHERE reader_email = :e AND status <> 'removed'"), {"e": reader.email})]
    return c.list_posts(db, reader, book_id=book, author_email=c.email_for(db, author) if author else None,
                        book_ids=book_ids, before=before, limit=limit)


@router.get("/posts/{post_id}")
def post(post_id: UUID, reader: Reader = Depends(get_member), db: Session = Depends(get_db)):
    return c.get_post(db, reader, str(post_id))


@router.post("/posts", status_code=201)
def create_post(body: PostIn, reader: Reader = Depends(get_member), db: Session = Depends(get_db)):
    post_id = str(db.execute(text("INSERT INTO posts (author_email, title, body) VALUES (:e, :t, :b) RETURNING id"),
                             {"e": reader.email, "t": body.title.strip(), "b": body.body}).scalar())
    c.save_post_parts(db, post_id, body.book_ids, [q.model_dump() for q in body.quotes])
    db.commit()
    return c.get_post(db, reader, post_id)


@router.put("/posts/{post_id}")
def edit_post(post_id: UUID, body: PostIn, reader: Reader = Depends(get_member), db: Session = Depends(get_db)):
    c.own(db, reader, "posts", "author_email", str(post_id), admin_may=False)
    db.execute(text("UPDATE posts SET title = :t, body = :b, edited = true, updated_at = now() WHERE id = :id"),
               {"t": body.title.strip(), "b": body.body, "id": post_id})
    c.save_post_parts(db, str(post_id), body.book_ids, [q.model_dump() for q in body.quotes])
    db.commit()
    return c.get_post(db, reader, str(post_id))


@router.delete("/posts/{post_id}", status_code=204)
def delete_post(post_id: UUID, reader: Reader = Depends(get_member), db: Session = Depends(get_db)):
    c.own(db, reader, "posts", "author_email", str(post_id))
    db.execute(text("DELETE FROM likes WHERE target_type = 'comment' AND target_id IN "
                    "(SELECT id FROM comments WHERE post_id = :id)"), {"id": post_id})
    db.execute(text("DELETE FROM likes WHERE target_type = 'post' AND target_id = :id"), {"id": post_id})
    db.execute(text("DELETE FROM posts WHERE id = :id"), {"id": post_id})
    db.commit()


# --- comments ---

class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=5000)
    spoiler: bool = False
    parent_id: UUID | None = None


@router.post("/posts/{post_id}/comments", status_code=201)
def add_comment(post_id: UUID, body: CommentIn, reader: Reader = Depends(get_member), db: Session = Depends(get_db)):
    c.get_post(db, reader, str(post_id))  # 404 for a missing or hidden post
    parent = body.parent_id
    if parent is not None:
        row = db.execute(text("SELECT parent_id FROM comments WHERE id = :p AND post_id = :id"),
                         {"p": parent, "id": post_id}).fetchone()
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "No such comment")
        parent = row.parent_id or parent  # one level of replies: a reply to a reply joins the same thread
    db.execute(text("""INSERT INTO comments (post_id, parent_id, author_email, body, spoiler)
                       VALUES (:id, :p, :e, :b, :s)"""),
               {"id": post_id, "p": parent, "e": reader.email, "b": body.body.strip(), "s": body.spoiler})
    db.commit()
    return c.comments(db, reader, str(post_id))


@router.put("/comments/{comment_id}")
def edit_comment(comment_id: UUID, body: CommentIn, reader: Reader = Depends(get_member), db: Session = Depends(get_db)):
    c.own(db, reader, "comments", "author_email", str(comment_id), admin_may=False)
    post_id = db.execute(text("""UPDATE comments SET body = :b, spoiler = :s, edited = true, updated_at = now()
                                 WHERE id = :id AND NOT deleted RETURNING post_id"""),
                         {"b": body.body.strip(), "s": body.spoiler, "id": comment_id}).scalar()
    if post_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Comment deleted")
    db.commit()
    return c.comments(db, reader, str(post_id))


@router.delete("/comments/{comment_id}", status_code=204)
def delete_comment(comment_id: UUID, reader: Reader = Depends(get_member), db: Session = Depends(get_db)):
    c.own(db, reader, "comments", "author_email", str(comment_id))
    db.execute(text("UPDATE comments SET deleted = true, body = '', updated_at = now() WHERE id = :id"), {"id": comment_id})
    db.execute(text("DELETE FROM likes WHERE target_type = 'comment' AND target_id = :id"), {"id": comment_id})
    db.commit()


# --- likes ---

@router.put("/likes/{kind}/{target_id}", status_code=204)
def like(kind: str, target_id: UUID, reader: Reader = Depends(get_member), db: Session = Depends(get_db)):
    c.set_like(db, reader, kind, str(target_id), True)


@router.delete("/likes/{kind}/{target_id}", status_code=204)
def unlike(kind: str, target_id: UUID, reader: Reader = Depends(get_member), db: Session = Depends(get_db)):
    c.set_like(db, reader, kind, str(target_id), False)


# --- top lists ---

class ListItemIn(BaseModel):
    book_id: str
    note: str = Field(default="", max_length=1000)


class ListIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=5000)
    items: list[ListItemIn] = Field(default=[], max_length=50)


@router.get("/lists")
def all_lists(owner: str | None = None, reader: Reader = Depends(get_member), db: Session = Depends(get_db)):
    return c.lists(db, reader, owner_email=c.email_for(db, owner) if owner else None)


def _one_list(db: Session, reader: Reader, list_id: str) -> dict:
    found = c.lists(db, reader, list_id=list_id)
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such list")
    return found[0]


@router.get("/lists/{list_id}")
def one_list(list_id: UUID, reader: Reader = Depends(get_member), db: Session = Depends(get_db)):
    return _one_list(db, reader, str(list_id))


@router.post("/lists", status_code=201)
def create_list(body: ListIn, reader: Reader = Depends(get_member), db: Session = Depends(get_db)):
    list_id = str(db.execute(text("INSERT INTO lists (owner_email, title, description) VALUES (:e, :t, :d) RETURNING id"),
                             {"e": reader.email, "t": body.title.strip(), "d": body.description}).scalar())
    c.save_list_items(db, list_id, [i.model_dump() for i in body.items])
    db.commit()
    return _one_list(db, reader, list_id)


@router.put("/lists/{list_id}")
def edit_list(list_id: UUID, body: ListIn, reader: Reader = Depends(get_member), db: Session = Depends(get_db)):
    c.own(db, reader, "lists", "owner_email", str(list_id), admin_may=False)
    db.execute(text("UPDATE lists SET title = :t, description = :d, updated_at = now() WHERE id = :id"),
               {"t": body.title.strip(), "d": body.description, "id": list_id})
    c.save_list_items(db, str(list_id), [i.model_dump() for i in body.items])
    db.commit()
    return _one_list(db, reader, str(list_id))


@router.delete("/lists/{list_id}", status_code=204)
def delete_list(list_id: UUID, reader: Reader = Depends(get_member), db: Session = Depends(get_db)):
    c.own(db, reader, "lists", "owner_email", str(list_id))
    db.execute(text("DELETE FROM lists WHERE id = :id"), {"id": list_id})
    db.commit()


# --- moderation (admins) ---

@router.post("/admin/hide/{kind}/{item_id}", status_code=204)
def hide(kind: str, item_id: UUID, _: Reader = Depends(get_current_admin), db: Session = Depends(get_db)):
    c.set_hidden(db, kind, str(item_id), True)


@router.delete("/admin/hide/{kind}/{item_id}", status_code=204)
def unhide(kind: str, item_id: UUID, _: Reader = Depends(get_current_admin), db: Session = Depends(get_db)):
    c.set_hidden(db, kind, str(item_id), False)
