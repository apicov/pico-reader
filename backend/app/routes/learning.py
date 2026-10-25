"""Learning aids: words marked as known, the words looked up (to mark them in the text), and review cards
for spaced repetition (scheduled on the device with FSRS, synced here)."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import AwareDatetime, BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import Reader, get_current_reader
from app.db import get_db
from app.routes.annotations import OVERLAP

router = APIRouter(prefix="/api", tags=["learning"])


class KnownWord(BaseModel):
    language: str = Field(min_length=2, max_length=3)
    word: str = Field(min_length=1, max_length=100)
    known: bool = True


@router.get("/known-words")
def known_words(language: str | None = None, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    rows = db.execute(text("""SELECT language, word FROM known_words WHERE reader_email = :e
                              AND (CAST(:l AS text) IS NULL OR language = :l) ORDER BY word"""),
                      {"e": reader.email, "l": language})
    return [{"language": r.language, "word": r.word} for r in rows]


@router.put("/known-words")
def set_known(body: KnownWord, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    params = {"e": reader.email, "l": body.language, "w": body.word.strip().lower()}
    if body.known:
        db.execute(text("""INSERT INTO known_words (reader_email, language, word) VALUES (:e, :l, :w)
                           ON CONFLICT DO NOTHING"""), params)
    else:
        db.execute(text("DELETE FROM known_words WHERE reader_email = :e AND language = :l AND word = :w"), params)
    db.commit()
    return {"word": params["w"], "known": body.known}


@router.get("/looked-up-words")
def looked_up_words(language: str, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    """The words (as selected, and the dictionary forms found) looked up in a language and not marked known."""
    rows = db.execute(text("""
        SELECT DISTINCT lower(w) AS word FROM lookups l,
               LATERAL (VALUES (l.word), (nullif(l.matched, ''))) AS forms(w)
        WHERE l.reader_email = :e AND l.language = :l AND l.found AND w IS NOT NULL
          AND lower(l.word) NOT IN (SELECT word FROM known_words k WHERE k.reader_email = :e AND k.language = :l)
          AND lower(coalesce(nullif(l.matched, ''), l.word)) NOT IN
              (SELECT word FROM known_words k WHERE k.reader_email = :e AND k.language = :l)"""),
        {"e": reader.email, "l": language})
    return [r.word for r in rows]


# --- review cards (synced like annotations) ---

class CardIn(BaseModel):
    language: str = Field(min_length=2, max_length=3)
    term: str = Field(min_length=1, max_length=200)
    meaning: str = Field(default="", max_length=2000)
    example: str = Field(default="", max_length=2000)
    source: str = Field(default="lookup", pattern="^(lookup|translation|manual)$")
    book_id: str | None = None
    state: dict = {}
    due: AwareDatetime
    deleted: bool = False
    client_updated_at: AwareDatetime


class Card(CardIn):
    id: str
    updated_at: datetime


_COLUMNS = "id, language, term, meaning, example, source, book_id, state, due, deleted, client_updated_at, updated_at"


@router.get("/review-cards")
def card_changes(since: datetime | None = None, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    rows = db.execute(text(f"""SELECT {_COLUMNS} FROM review_cards WHERE reader_email = :e
                               AND (CAST(:since AS timestamptz) IS NULL OR updated_at > CAST(:since AS timestamptz) - {OVERLAP})
                               ORDER BY updated_at"""),
                      {"e": reader.email, "since": since}).fetchall()
    return {"cards": [Card(**r._mapping) for r in rows], "cursor": rows[-1].updated_at if rows else since}


@router.put("/review-cards/{card_id}", response_model=Card)
def save_card(card_id: str, body: CardIn, reader: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    import json

    if not 8 <= len(card_id) <= 64:
        raise HTTPException(422, "Bad id")
    owner = db.execute(text("SELECT reader_email FROM review_cards WHERE id = :id"), {"id": card_id}).scalar()
    if owner and owner != reader.email:
        raise HTTPException(404, "Not found")
    db.execute(text("""
        INSERT INTO review_cards (id, reader_email, language, term, meaning, example, source, book_id, state, due,
                                  deleted, client_updated_at)
        VALUES (:id, :e, :language, :term, :meaning, :example, :source, :book_id, CAST(:state AS jsonb), :due,
                :deleted, least(CAST(:client_updated_at AS timestamptz), now()))
        ON CONFLICT (id) DO UPDATE SET language = EXCLUDED.language, term = EXCLUDED.term,
            meaning = EXCLUDED.meaning, example = EXCLUDED.example, state = EXCLUDED.state, due = EXCLUDED.due,
            deleted = EXCLUDED.deleted, client_updated_at = EXCLUDED.client_updated_at, updated_at = clock_timestamp()
            WHERE review_cards.client_updated_at < EXCLUDED.client_updated_at
    """), {"id": card_id, "e": reader.email, **body.model_dump(), "state": json.dumps(body.state)})
    row = db.execute(text(f"SELECT {_COLUMNS} FROM review_cards WHERE id = :id"), {"id": card_id}).fetchone()
    db.commit()
    return Card(**row._mapping)
