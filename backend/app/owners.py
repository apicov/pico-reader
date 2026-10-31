"""Who may change what. Items are of two kinds:
- private (a conversation, a collection): only its reader sees it, so someone else's is NotFound, and an id tells
  nothing about whether it exists;
- shared (a book, a post, a comment, a list): everyone sees it, so someone else's is Forbidden."""

from sqlalchemy import Row, text
from sqlalchemy.orm import Session

from app.auth import Reader
from app.errors import Forbidden, NotFound


def mine(db: Session, table: str, item_id: str, reader: Reader, columns: str = "id", missing: str = "Not found") -> Row:
    """A private item of the reader's (`columns` of it)."""
    row = db.execute(text(f"SELECT {columns} FROM {table} WHERE id = :id AND reader_email = :e"),
                     {"id": item_id, "e": reader.email}).fetchone()
    if row is None:
        raise NotFound(missing)
    return row


def changeable(db: Session, table: str, item_id: str, reader: Reader, owner: str, columns: str = "id",
               admin_may: bool = True, missing: str = "Not found",
               forbidden: str = "Only the author can change this") -> Row:
    """A shared item the reader may change: theirs (column `owner`), or any when they're an admin and `admin_may`."""
    row = db.execute(text(f"SELECT {columns}, {owner} AS owner FROM {table} WHERE id = :id"), {"id": item_id}).fetchone()
    if row is None:
        raise NotFound(missing)
    if row.owner != reader.email and not (admin_may and reader.is_admin):
        raise Forbidden(forbidden)
    return row
