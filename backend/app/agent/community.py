"""Tools about the readers' community: opinions of a book, lists, posts, the reader's reviews."""

import re
import uuid

from sqlalchemy import text

from app import community
from app.agent.registry import Context, book_or_error
from app.search_service import fold_accents


def book_opinions(ctx: Context, book: str) -> dict:
    found, error = book_or_error(ctx, book)
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
    return {"lists": [{"title": lst["title"], "by": lst["author"]["display_name"],
                       "books": [i["book"]["title"] for i in lst["items"] if i["book"]["available"]]}
                      for lst in community.lists(ctx.db, ctx.reader, owner_email=owner) if not lst["hidden"]][:20]}

def _no_spoilers(text_: str) -> str:
    """`||…||` marks a spoiler in community texts: the agent doesn't pass them on."""
    return re.sub(r"\|\|[^|\n]+?\|\|", "(spoiler hidden)", text_)

def _reader_named(ctx: Context, name: str) -> str | None:
    return ctx.db.execute(text("SELECT reader_email FROM profiles WHERE handle = :h OR lower(display_name) = :h"),
                          {"h": name.lower().lstrip("@")}).scalar()

def community_posts(ctx: Context, book: str | None = None, author: str | None = None, mine: bool = False) -> dict:
    found, error = book_or_error(ctx, book)
    if error:
        return error
    email = ctx.reader.email if mine else None
    if author and not mine:
        email = _reader_named(ctx, author)
        if email is None:
            return {"error": f"No reader called {author!r}"}
    posts = community.list_posts(ctx.db, ctx.reader, book_id=found["id"] if found else None, author_email=email, limit=15)
    return {"posts": [{"id": p["id"], "title": p["title"], "by": p["author"]["display_name"], "date": p["created_at"][:10],
                       "books": [b["title"] for b in p["books"]], "text": _no_spoilers(p["body"])[:600],
                       "comments": p["comment_count"], "likes": p["likes"]}
                      for p in posts if not p["hidden"]]}

def read_post(ctx: Context, post: str) -> dict:
    """One post in full with its comments; `post` is an id from community_posts or (part of) a title."""

    try:
        post_id = str(uuid.UUID(post))
    except ValueError:
        wanted = fold_accents(post)
        match = next((p for p in community.list_posts(ctx.db, ctx.reader, limit=100)
                      if not p["hidden"] and wanted in fold_accents(p["title"])), None)
        if match is None:
            return {"error": f"No post {post!r}; community_posts lists them"}
        post_id = match["id"]
    p = community.get_post(ctx.db, ctx.reader, post_id)
    if p["hidden"]:
        return {"error": "That post is hidden"}
    return {"title": p["title"], "by": p["author"]["display_name"], "date": p["created_at"][:10],
            "books": [b["title"] for b in p["books"]], "text": _no_spoilers(p["body"]),
            "quotes": [{"book": q["book"]["title"], "text": q["text"]} for q in p["quotes"]],
            "comments": [{"by": c["author"]["display_name"], "text": "(spoiler hidden)" if c["spoiler"] else _no_spoilers(c["body"]),
                          "reply": bool(c["parent_id"])}
                         for c in p["comments"] if c["author"] and not c["hidden"]][:40]}

def my_reviews(ctx: Context) -> dict:
    return {"reviews": [{"book": r["book"]["title"], "score": r["score"], "recommend": r["recommend"], "text": r["body"],
                         "date": r["updated_at"][:10]}
                        for r in community.reviews(ctx.db, ctx.reader, author_email=ctx.reader.email, limit=100)]}
